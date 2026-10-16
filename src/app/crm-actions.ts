"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "@/lib/revalidate";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { saveBookkeepingRecord } from "@/app/actions";
import { ActionError } from "@/lib/action-error";
import { assertCanWrite, requireUser } from "@/lib/auth";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";
import { recordAudit } from "@/lib/audit";
import { afterHrSave, applyHrRules } from "@/lib/hr-rules";
import {
  crmKinds,
  hrKinds,
  crmModuleByKind,
  crmTitle,
  fullName,
  isClosedStage,
  parseHistory,
  relatedKind,
  relatedTypes,
  stageProbability,
  type CrmField,
  type CrmHistoryEntry,
  type CrmModule,
  type RelatedType,
} from "@/lib/crm-config";

type StoredRow = typeof bookkeepingRecord.$inferSelect;

const MAX_IMPORT_ROWS = 1000;

function toRecord(row: StoredRow): BookkeepingRecord {
  return { id: row.id, kind: row.kind as RecordKind, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function crmModuleFor(kind: string): CrmModule {
  const mod = crmModuleByKind(kind);
  if (!mod) throw new ActionError("That CRM section isn’t available.");
  return mod;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function withHistory(data: Record<string, string>, entries: CrmHistoryEntry[]) {
  if (!entries.length) return data;
  return { ...data, history: JSON.stringify([...entries.reverse(), ...parseHistory(data.history)].slice(0, 40)) };
}

function money(value: string | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

/** Every record a lookup can point at, loaded once per action. */
async function lookupContext(userId: string) {
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, [
      "customers", "crm-leads", "crm-contacts", "crm-deals", "crm-campaigns", "crm-cases",
      "employees", "hr-departments", "hr-leave-types", "hr-jobs", "hr-leaves", "hr-allocations", "hr-holidays", "hr-loans", "hr-attendance", "accounts",
    ])));
  const byKind = (kind: string) => rows.filter((row) => row.kind === kind);
  return { rows, byKind };
}
type LookupContext = Awaited<ReturnType<typeof lookupContext>>;

function lookupName(kind: string, data: Record<string, string>) {
  if (kind === "customers") return data.name?.trim() || data.company?.trim() || "Customer";
  if (kind === "employees") return data.name?.trim() || "Employee";
  if (kind === "accounts") return paymentAccountLabel({ kind: "accounts", data } as BookkeepingRecord);
  const mod = crmModuleByKind(kind);
  return mod ? crmTitle(mod, data) : "Record";
}

const lookupKinds: Partial<Record<NonNullable<CrmField["type"]>, string>> = {
  account: "customers",
  contact: "crm-contacts",
  deal: "crm-deals",
  campaign: "crm-campaigns",
  employee: "employees",
  department: "hr-departments",
  leaveType: "hr-leave-types",
  job: "hr-jobs",
  paymentAccount: "accounts",
};

/** Resolves one lookup to an id and name that belong to this business, by id first and then by name (for imports). */
function resolveLookup(context: LookupContext, kind: string, id: string | undefined, name: string | undefined) {
  // Only Cash, Bank and Credit card accounts can pay or receive money.
  const candidates = kind === "accounts" ? context.byKind(kind).filter((row) => paymentAccountType({ kind: "accounts", data: row.data })) : context.byKind(kind);
  const byId = id ? candidates.find((row) => row.id === id) : undefined;
  if (byId) return { id: byId.id, name: lookupName(kind, byId.data) };
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return { id: "", name: "" };
  const byName = candidates.find((row) => lookupName(kind, row.data).toLowerCase() === wanted);
  if (byName) return { id: byName.id, name: lookupName(kind, byName.data) };
  if (id) throw new ActionError("One of the linked records no longer exists. Pick it again.");
  return { id: "", name: name?.trim() ?? "" };
}

function cleanValue(field: CrmField, raw: string | undefined) {
  const value = (raw ?? "").trim().slice(0, field.type === "textarea" ? 8000 : 500);
  if (!value) return "";
  switch (field.type) {
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ActionError(`Enter a valid email address for ${field.label.toLowerCase()}.`);
      return value;
    case "number":
    case "currency":
    case "percent": {
      const number = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(number) || number < 0) throw new ActionError(`${field.label} must be a number of zero or more.`);
      if (field.type === "percent" && number > 100) throw new ActionError(`${field.label} can’t be more than 100.`);
      return field.type === "currency" ? number.toFixed(2) : String(number);
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ActionError(`Enter ${field.label.toLowerCase()} as a date.`);
      return value;
    case "datetime": {
      const normalized = value.replace(" ", "T").slice(0, 16);
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(normalized)) throw new ActionError(`Enter ${field.label.toLowerCase()} as a date and time.`);
      return normalized;
    }
    case "checkbox":
      return ["true", "yes", "1", "on"].includes(value.toLowerCase()) ? "true" : "false";
    case "select":
      if (field.options && !field.options.includes(value)) {
        const match = field.options.find((option) => option.toLowerCase() === value.toLowerCase());
        if (!match) throw new ActionError(`“${value}” isn’t one of the choices for ${field.label.toLowerCase()}.`);
        return match;
      }
      return value;
    default:
      return value;
  }
}

/** Checks and tidies a CRM record before it is stored. */
function buildData(mod: CrmModule, input: Record<string, string>, context: LookupContext, existing: Record<string, string> | undefined, ownerName: string, id?: string) {
  const data: Record<string, string> = { ...(existing ?? {}) };
  for (const field of mod.fields) {
    if (field.readOnly) continue;
    if (field.type === "related") {
      const type = input.relatedType?.trim() ?? "";
      if (!type || !(input.relatedId || input.related)) {
        data.relatedType = "";
        data.relatedId = "";
        data.related = "";
        continue;
      }
      if (!relatedTypes.includes(type as RelatedType)) throw new ActionError("Choose what this is related to.");
      const resolved = resolveLookup(context, relatedKind[type as RelatedType], input.relatedId, input.related);
      data.relatedType = resolved.id ? type : "";
      data.relatedId = resolved.id;
      data.related = resolved.id ? resolved.name : "";
      continue;
    }
    const lookupKind = field.type ? lookupKinds[field.type] : undefined;
    if (lookupKind) {
      const resolved = resolveLookup(context, lookupKind, input[`${field.key}Id`], input[field.key]);
      data[`${field.key}Id`] = resolved.id;
      data[field.key] = resolved.name;
      continue;
    }
    if (!(field.key in input) && existing) continue;
    data[field.key] = cleanValue(field, input[field.key]);
    if (field.type === "file") {
      if (data[field.key] && !/^(https?:\/\/|\/)/.test(data[field.key])) throw new ActionError(`Upload the ${field.label.toLowerCase()} again.`);
      data[`${field.key}Name`] = data[field.key] ? (input[`${field.key}Name`] ?? existing?.[`${field.key}Name`] ?? "").slice(0, 200) : "";
    }
  }
  if (!data.owner) data.owner = ownerName;
  for (const field of mod.fields) {
    if (field.required && !field.readOnly && !data[field.key]?.trim()) throw new ActionError(`${field.label} is required.`);
  }
  if (mod.titleKey === "fullName") data.fullName = fullName(data);
  if (mod.kind === "crm-deals") {
    const stageChanged = existing?.stage !== data.stage;
    if (!data.probability || (stageChanged && !("probability" in input && input.probability !== existing?.probability))) {
      data.probability = String(stageProbability(data.stage) ?? 0);
    }
    data.expectedRevenue = ((money(data.amount) * money(data.probability)) / 100).toFixed(2);
    if (isClosedStage(data.stage) && !isClosedStage(existing?.stage)) data.closedOn = new Date().toISOString().slice(0, 10);
    if (!isClosedStage(data.stage)) data.closedOn = "";
  }
  if ((mod.kind === "crm-tasks") && data.status === "Completed" && existing?.status !== "Completed") data.completedOn = new Date().toISOString().slice(0, 10);
  if (mod.section === "hr") applyHrRules(mod.kind, data, existing, { byKind: context.byKind, actor: ownerName }, id);
  return data;
}

function changeEntries(mod: CrmModule, before: Record<string, string> | undefined, after: Record<string, string>, by: string): CrmHistoryEntry[] {
  const at = nowStamp();
  if (!before) return [{ at, by, text: `${mod.label} created` }];
  const tracked = [mod.statusKey, "owner", "amount", "closingDate", "dueDate", "priority", "account"].filter((key): key is string => Boolean(key));
  return tracked.flatMap((key) => {
    if ((before[key] ?? "") === (after[key] ?? "")) return [];
    const label = mod.fields.find((field) => field.key === key)?.label ?? key;
    return [{ at, by, text: `${label} changed from “${before[key] || "—"}” to “${after[key] || "—"}”` }];
  });
}

async function nextNumber(userId: string, kind: string, key: string, prefix: string) {
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind)));
  const highest = rows.reduce((max, row) => Math.max(max, Number((row.data[key] ?? "").replace(/\D/g, "")) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export async function saveCrmRecord(kind: string, input: Record<string, string>, id?: string): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const mod = crmModuleFor(kind);
  const context = await lookupContext(me.id);
  let existing: StoredRow | undefined;
  if (id) {
    [existing] = await db.select().from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind))).limit(1);
    if (!existing) throw new ActionError(`We couldn’t find that ${mod.label.toLowerCase()}. Refresh and try again.`);
  }
  let data = buildData(mod, input, context, existing?.data, me.name, existing?.id);
  data = withHistory(data, changeEntries(mod, existing?.data, data, me.name));
  if (existing) {
    const [saved] = await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, existing.id), eq(bookkeepingRecord.userId, me.id))).returning();
    if (mod.section === "hr") await afterHrSave(me.id, kind, existing.data, saved);
    await recordAudit(me, "Edited", kind, saved.id, saved.data);
    revalidatePath("/app", "layout");
    return toRecord(saved);
  }
  if (mod.numbering) data[mod.numbering.key] = await nextNumber(me.id, kind, mod.numbering.key, mod.numbering.prefix);
  const [created] = await db.insert(bookkeepingRecord).values({ userId: me.id, kind, data }).returning();
  if (mod.section === "hr") await afterHrSave(me.id, kind, undefined, created);
  await recordAudit(me, "Added", kind, created.id, created.data);
  revalidatePath("/app", "layout");
  return toRecord(created);
}

/** Changes one field on several records at once: mass update, and moving cards on the Kanban board. */
export async function updateCrmField(kind: string, ids: string[], key: string, value: string): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const mod = crmModuleFor(kind);
  const field = mod.fields.find((item) => item.key === key);
  if (!field || field.readOnly || !["select", "owner", "date", "checkbox"].includes(field.type ?? "text")) throw new ActionError("That field can’t be changed in bulk.");
  if (!ids.length) return [];
  const rows = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), inArray(bookkeepingRecord.id, ids.slice(0, 500))));
  const context = await lookupContext(me.id);
  const saved: BookkeepingRecord[] = [];
  for (const row of rows) {
    const input = { ...row.data, [key]: value, ...(key === "stage" ? { probability: "" } : {}) };
    let data = buildData(mod, input, context, row.data, me.name, row.id);
    data = withHistory(data, changeEntries(mod, row.data, data, me.name));
    const [updated] = await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, row.id), eq(bookkeepingRecord.userId, me.id))).returning();
    if (mod.section === "hr") await afterHrSave(me.id, kind, row.data, updated);
    await recordAudit(me, "Edited", kind, updated.id, updated.data);
    saved.push(toRecord(updated));
  }
  revalidatePath("/app", "layout");
  return saved;
}

export async function deleteCrmRecords(kind: string, ids: string[]): Promise<void> {
  const me = await requireUser();
  if (!ids.length) return;
  const rows = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), inArray(bookkeepingRecord.id, ids)));
  if (kind === "crm-notes") {
    // A note belongs to its record: whoever may change the record may remove its notes.
    for (const note of rows) assertCanWrite(me, note.data.parentKind || "crm-notes");
  } else {
    crmModuleFor(kind);
    assertCanWrite(me, kind);
  }
  await db.transaction(async (transaction) => {
    await transaction.delete(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), inArray(bookkeepingRecord.id, ids)));
    if (kind !== "crm-notes") {
      const notes = await transaction.select().from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "crm-notes")));
      const orphaned = notes.filter((note) => ids.includes(note.data.parentId ?? "")).map((note) => note.id);
      if (orphaned.length) await transaction.delete(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.id, orphaned)));
    }
  });
  if (kind !== "crm-notes") for (const row of rows) await recordAudit(me, "Deleted", kind, row.id, row.data);
  revalidatePath("/app", "layout");
}

export async function addCrmNote(parentKind: string, parentId: string, title: string, content: string): Promise<BookkeepingRecord> {
  const me = await requireUser();
  if (parentKind !== "customers" && !crmKinds.includes(parentKind as RecordKind) && !hrKinds.includes(parentKind as RecordKind)) throw new ActionError("Notes can’t be added here.");
  const text = content.trim().slice(0, 8000);
  if (!text) throw new ActionError("Write the note first.");
  const [parent] = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, parentId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, parentKind))).limit(1);
  if (!parent) throw new ActionError("We couldn’t find that record. Refresh and try again.");
  // Notes go with the record they are on, so HR notes need HR rights and CRM notes CRM rights.
  assertCanWrite(me, parentKind);
  const [created] = await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "crm-notes",
    data: { parentKind, parentId, title: title.trim().slice(0, 200), content: text, author: me.name, createdOn: nowStamp() },
  }).returning();
  revalidatePath("/app", "layout");
  return toRecord(created);
}

export interface ConvertLeadInput {
  /** Use an existing account (customer) instead of creating one from the lead's company. */
  accountId?: string;
  createDeal: boolean;
  dealName?: string;
  amount?: string;
  closingDate?: string;
  stage?: string;
  owner?: string;
}

/** Converts a lead into an account (customer), a contact and, if asked, a deal, as Zoho CRM does. */
export async function convertLead(leadId: string, input: ConvertLeadInput): Promise<{ accountId: string; contactId: string; dealId: string }> {
  const me = await requireUser();
  assertCanWrite(me, "crm-leads");
  assertCanWrite(me, "customers");
  const [lead] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, leadId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "crm-leads"))).limit(1);
  if (!lead) throw new ActionError("We couldn’t find that lead. Refresh and try again.");
  if (lead.data.leadStatus === "Converted") throw new ActionError("This lead has already been converted.");
  const l = lead.data;
  const owner = input.owner?.trim() || l.owner || me.name;
  const by = me.name;

  const result = await db.transaction(async (transaction) => {
    let accountId = "";
    let accountName = "";
    if (input.accountId) {
      const [account] = await transaction.select().from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, input.accountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "customers"))).limit(1);
      if (!account) throw new ActionError("That account no longer exists. Pick another one.");
      accountId = account.id;
      accountName = account.data.name || "Customer";
    } else {
      const name = l.company?.trim() || fullName(l) || "New customer";
      const customers = await transaction.select().from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "customers")));
      const sameName = customers.find((customer) => customer.data.name?.trim().toLowerCase() === name.toLowerCase());
      if (sameName) {
        accountId = sameName.id;
        accountName = sameName.data.name;
      } else {
        const [account] = await transaction.insert(bookkeepingRecord).values({
          userId: me.id,
          kind: "customers",
          data: {
            name,
            customerType: l.company ? "Business" : "Individual",
            firstName: l.firstName ?? "",
            lastName: l.lastName ?? "",
            company: l.company ?? "",
            email: l.email ?? "",
            phone: l.phone ?? "",
            mobile: l.mobile ?? "",
            website: l.website ?? "",
            address: l.addressStreet ?? "",
            city: l.addressCity ?? "",
            state: l.addressState ?? "",
            postalCode: l.addressZip ?? "",
            country: l.addressCountry ?? "",
            paymentTerms: "30 days",
            notes: l.description ?? "",
            crmSource: "Converted lead",
          },
        }).returning();
        accountId = account.id;
        accountName = name;
      }
    }

    const contactData: Record<string, string> = {
      owner,
      salutation: l.salutation ?? "",
      firstName: l.firstName ?? "",
      lastName: l.lastName || l.company || "Contact",
      accountId,
      account: accountName,
      title: l.title ?? "",
      email: l.email ?? "",
      secondaryEmail: l.secondaryEmail ?? "",
      phone: l.phone ?? "",
      mobile: l.mobile ?? "",
      leadSource: l.leadSource ?? "",
      campaignId: l.campaignId ?? "",
      campaign: l.campaign ?? "",
      emailOptOut: l.emailOptOut ?? "false",
      skypeId: l.skypeId ?? "",
      twitter: l.twitter ?? "",
      mailingStreet: l.addressStreet ?? "",
      mailingCity: l.addressCity ?? "",
      mailingState: l.addressState ?? "",
      mailingZip: l.addressZip ?? "",
      mailingCountry: l.addressCountry ?? "",
      description: l.description ?? "",
      convertedFromLeadId: lead.id,
    };
    contactData.fullName = fullName(contactData);
    const [contact] = await transaction.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "crm-contacts",
      data: withHistory(contactData, [{ at: nowStamp(), by, text: `Created by converting lead ${fullName(l) || l.company}` }]),
    }).returning();

    let dealId = "";
    if (input.createDeal) {
      const dealName = input.dealName?.trim();
      if (!dealName) throw new ActionError("Enter a deal name, or untick “Create a new deal”.");
      const stage = input.stage?.trim() || "Qualification";
      if (stageProbability(stage) === undefined) throw new ActionError("Choose a deal stage.");
      const closingDate = input.closingDate?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) throw new ActionError("Choose the deal’s closing date.");
      const amount = money(input.amount);
      if (amount < 0) throw new ActionError("The deal amount can’t be negative.");
      const probability = stageProbability(stage) ?? 0;
      const [deal] = await transaction.insert(bookkeepingRecord).values({
        userId: me.id,
        kind: "crm-deals",
        data: withHistory({
          owner,
          dealName,
          accountId,
          account: accountName,
          contactId: contact.id,
          contact: contactData.fullName,
          type: "New Business",
          amount: amount.toFixed(2),
          closingDate,
          stage,
          probability: String(probability),
          expectedRevenue: ((amount * probability) / 100).toFixed(2),
          leadSource: l.leadSource ?? "",
          campaignId: l.campaignId ?? "",
          campaign: l.campaign ?? "",
          convertedFromLeadId: lead.id,
        }, [{ at: nowStamp(), by, text: `Created by converting lead ${fullName(l) || l.company}` }]),
      }).returning();
      dealId = deal.id;
    }

    // Activities and notes on the lead now belong to the new contact, as in Zoho CRM.
    const others = await transaction.select().from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["crm-tasks", "crm-meetings", "crm-calls", "crm-notes"])));
    for (const row of others) {
      if (row.kind === "crm-notes" ? row.data.parentId !== lead.id : !(row.data.relatedType === "Lead" && row.data.relatedId === lead.id)) continue;
      const data = row.kind === "crm-notes"
        ? { ...row.data, parentKind: "crm-contacts", parentId: contact.id }
        : { ...row.data, relatedType: "Contact", relatedId: contact.id, related: contactData.fullName, contactId: contact.id, contact: contactData.fullName };
      await transaction.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
    }

    await transaction.update(bookkeepingRecord).set({
      data: withHistory({
        ...l,
        leadStatus: "Converted",
        convertedAccountId: accountId,
        convertedAccount: accountName,
        convertedContactId: contact.id,
        convertedDealId: dealId,
        convertedOn: new Date().toISOString().slice(0, 10),
      }, [{ at: nowStamp(), by, text: `Converted to account ${accountName}${dealId ? " with a deal" : ""}` }]),
      updatedAt: new Date(),
    }).where(eq(bookkeepingRecord.id, lead.id));

    return { accountId, contactId: contact.id, dealId };
  });
  await recordAudit(me, "Converted", "crm-leads", leadId, lead.data);
  revalidatePath("/app", "layout");
  return result;
}

/** Creates a draft quote (estimate) or invoice in Sales for a deal's account, so nothing is typed twice. */
export async function createDocumentFromDeal(dealId: string, target: "estimates" | "invoices"): Promise<{ id: string; number: string; href: string }> {
  const me = await requireUser();
  assertCanWrite(me, "crm-deals");
  assertCanWrite(me, target);
  const [deal] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, dealId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "crm-deals"))).limit(1);
  if (!deal) throw new ActionError("We couldn’t find that deal. Refresh and try again.");
  if (!deal.data.account) throw new ActionError("Choose the deal’s account first.");
  const amount = money(deal.data.amount);
  const rows = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, [target, "settings", "customers"])));
  const settings = rows.find((row) => row.kind === "settings")?.data;
  const customer = rows.find((row) => row.kind === "customers" && row.id === deal.data.accountId);
  const today = new Date().toISOString().slice(0, 10);
  const lineItems = JSON.stringify([{ itemId: "", name: deal.data.dealName || "Deal", description: deal.data.description?.slice(0, 500) ?? "", quantity: "1", rate: amount.toFixed(2) }]);
  const existing = rows.filter((row) => row.kind === target);
  const common = {
    customer: customer?.data.name || deal.data.account,
    customerId: customer?.id ?? "",
    currency: settings?.currency || "USD",
    exchangeRate: "1",
    lineItems,
    taxRate: "",
    discount: "",
    status: "Draft",
    crmDealId: deal.id,
    crmDeal: deal.data.dealName ?? "",
  };
  let number: string;
  let created: BookkeepingRecord;
  if (target === "estimates") {
    const highest = existing.reduce((max, row) => Math.max(max, Number((row.data.estimateNumber ?? "").replace(/\D/g, "")) || 0), 0);
    number = `EST-${String(highest + 1).padStart(4, "0")}`;
    created = await saveBookkeepingRecord("estimates", { ...common, estimateNumber: number, date: today, expiryDate: "" });
  } else {
    const prefix = settings?.invoicePrefix || "INV-";
    const highest = existing.reduce((max, row) => Math.max(max, Number((row.data.invoiceNumber ?? "").replace(/\D/g, "")) || 0), 0);
    const sequence = Math.max(highest + 1, Number(settings?.nextInvoiceNumber) || 1);
    number = `${prefix}${String(sequence).padStart(4, "0")}`;
    created = await saveBookkeepingRecord("invoices", { ...common, invoiceNumber: number, issueDate: today, paymentTerms: customer?.data.paymentTerms || "30 days", paymentMethod: "Credit", paidAmount: "0" });
  }
  const label = target === "estimates" ? "Quote" : "Invoice";
  const documents = deal.data.documents ? `${deal.data.documents}, ${number}` : number;
  await db.update(bookkeepingRecord).set({
    data: withHistory({ ...deal.data, documents }, [{ at: nowStamp(), by: me.name, text: `${label} ${number} created in Sales` }]),
    updatedAt: new Date(),
  }).where(eq(bookkeepingRecord.id, deal.id));
  revalidatePath("/app", "layout");
  return { id: created.id, number, href: target === "estimates" ? "/app/estimates" : "/app/invoices" };
}

/** Imports rows from a CSV file; each row is checked like a record typed by hand. */
export async function importCrmRecords(kind: string, rows: Record<string, string>[]): Promise<{ created: number; failed: { row: number; message: string }[] }> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const mod = crmModuleFor(kind);
  if (!rows.length) throw new ActionError("The file has no rows to import.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ActionError(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
  const context = await lookupContext(me.id);
  const failed: { row: number; message: string }[] = [];
  let created = 0;
  let sequence = mod.numbering ? Number((await nextNumber(me.id, kind, mod.numbering.key, "")).replace(/\D/g, "")) : 0;
  for (const [index, row] of rows.entries()) {
    try {
      let data = buildData(mod, row, context, undefined, me.name);
      data = withHistory(data, [{ at: nowStamp(), by: me.name, text: `${mod.label} imported` }]);
      if (mod.numbering) {
        data[mod.numbering.key] = `${mod.numbering.prefix}${String(sequence).padStart(4, "0")}`;
        sequence += 1;
      }
      await db.insert(bookkeepingRecord).values({ userId: me.id, kind, data });
      created += 1;
    } catch (error) {
      failed.push({ row: index + 2, message: error instanceof ActionError ? error.message : "This row couldn’t be saved." });
    }
  }
  revalidatePath("/app", "layout");
  return { created, failed: failed.slice(0, 50) };
}
