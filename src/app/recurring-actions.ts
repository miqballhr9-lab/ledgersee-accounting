"use server";

import { and, eq } from "drizzle-orm";

import { recordExpensePayment, saveBookkeepingRecord } from "@/app/actions";
import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { assertCanWrite, requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { dueDateForTerms } from "@/lib/invoice-utils";
import { advanceDate, recurringKindLabels, recurringKinds, templatePayload, type RecurringKind } from "@/lib/recurring";
import { revalidatePath } from "@/lib/revalidate";

type StoredRow = typeof bookkeepingRecord.$inferSelect;

/** Fields that belong to one saved transaction, not to the pattern it repeats. */
const perTransactionKeys = ["paidAmount", "paymentAccountId", "paymentAccountName", "paymentDate", "paymentAccount", "creditApplied", "shareToken", "sentAt", "reminderSentAt", "viewedAt", "receivedAt", "payNowAccountId", "docType", "amountPaid", "sourcePurchaseOrderId", "convertedFrom", "convertedFromKind", "convertedFromId", "awaitingApproval", "openingBalanceFor"];

async function rows(userId: string, kind: string) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind)));
}

/** The next number after the highest one using this prefix, e.g. INV-0012 → INV-0013. */
function nextNumber(existing: StoredRow[], key: string, prefix: string) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  const highest = existing.reduce((max, row) => Math.max(max, Number(pattern.exec(row.data[key] ?? "")?.[1] ?? 0)), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/** Builds the transaction a template creates for `date`. */
async function transactionFor(userId: string, kind: RecurringKind, payload: Record<string, string>, date: string) {
  const data = Object.fromEntries(Object.entries(payload).filter(([key]) => !perTransactionKeys.includes(key)));
  if (kind === "invoices") {
    const [settings] = await rows(userId, "settings");
    const prefix = settings?.data.invoicePrefix || "INV-";
    const status = ["Paid", "Partially Paid", "Void"].includes(data.status ?? "") ? "Sent" : data.status || "Sent";
    return { ...data, invoiceNumber: nextNumber(await rows(userId, "invoices"), "invoiceNumber", prefix), issueDate: date, paymentMethod: "Credit", status };
  }
  if (kind === "bills") {
    return { ...data, billNumber: nextNumber(await rows(userId, "bills"), "billNumber", "BILL-"), billDate: date, dueDate: dueDateForTerms(date, data.paymentTerms || "") || date, paymentMethod: "Credit", status: "Open" };
  }
  if (kind === "expenses") {
    const rest = { ...data };
    delete rest.status;
    return { ...rest, expenseDate: date, ...(payload.docType === "Check" ? { docType: "Check" } : {}) };
  }
  return { ...data, date, reference: nextNumber(await rows(userId, "journals"), "reference", "JRN-") };
}

async function createFromTemplate(userId: string, template: StoredRow, date: string): Promise<BookkeepingRecord> {
  const kind = template.data.rtKind as RecurringKind;
  if (!recurringKinds.includes(kind)) throw new ActionError("This template can’t be used.");
  const payload = templatePayload(template.data);
  const saved = await saveBookkeepingRecord(kind, await transactionFor(userId, kind, payload, date));
  if (kind === "expenses" && payload.payNowAccountId) await recordExpensePayment(saved.id, date, payload.payNowAccountId);
  return saved;
}

/** Moves a template on past the date it just created a transaction for, ending it when its schedule is done. */
function afterUse(data: Record<string, string>, date: string) {
  const count = (Number(data.rtCount) || 0) + 1;
  const next = data.rtType === "Unscheduled" ? "" : advanceDate(data.rtNext || date, data.rtInterval, Number(data.rtEvery) || 1);
  const ended = data.rtType !== "Unscheduled" && ((data.rtEndType === "After" && count >= Number(data.rtOccurrences)) || (data.rtEndType === "By" && next > data.rtEndDate));
  return { ...data, rtCount: String(count), rtLast: date, rtNext: ended ? "" : next, rtStatus: ended ? "Ended" : data.rtStatus || "Active" };
}

async function findTemplate(userId: string, id: string) {
  const [template] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "recurring-transactions"))).limit(1);
  if (!template) throw new ActionError("We couldn’t find that recurring template. Refresh and try again.");
  return template;
}

/** "Use" in QuickBooks: creates the template's transaction now, dated today or on its due date. */
export async function createFromRecurringTemplate(id: string): Promise<{ kind: string; id: string; label: string }> {
  const me = await requireUser();
  assertCanWrite(me, "recurring-transactions");
  const template = await findTemplate(me.id, id);
  assertCanWrite(me, template.data.rtKind);
  if (template.data.rtStatus === "Ended") throw new ActionError("This schedule has ended. Edit it to start again.");
  const today = new Date().toISOString().slice(0, 10);
  // A due scheduled or reminder template is used for the date it was due; otherwise for today.
  const date = template.data.rtType !== "Unscheduled" && template.data.rtNext && template.data.rtNext <= today ? template.data.rtNext : today;
  const saved = await createFromTemplate(me.id, template, date);
  const data = template.data.rtType !== "Unscheduled" && date === template.data.rtNext ? afterUse(template.data, date) : { ...template.data, rtCount: String((Number(template.data.rtCount) || 0) + 1), rtLast: date };
  await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
  const kind = template.data.rtKind as RecurringKind;
  const number = saved.data.invoiceNumber || saved.data.billNumber || saved.data.reference || saved.data.referenceNumber || "";
  return { kind, id: saved.id, label: `${recurringKindLabels[kind]}${number ? ` ${number}` : ""}` };
}

export async function setRecurringTemplateStatus(id: string, status: "Active" | "Paused"): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "recurring-transactions");
  if (status !== "Active" && status !== "Paused") throw new ActionError("Choose Active or Paused.");
  const template = await findTemplate(me.id, id);
  await db.update(bookkeepingRecord).set({ data: { ...template.data, rtStatus: status }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

/**
 * Creates every scheduled transaction that has come due, catching up missed dates.
 * Runs from automation (Automation mode); in Manual mode the Recurring transactions page lists what is due.
 */
export async function runDueRecurringTransactions(): Promise<{ created: Array<{ kind: string; id: string; label: string }>; errors: string[] }> {
  const me = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const templates = (await rows(me.id, "recurring-transactions")).filter((row) => row.data.rtType === "Scheduled" && row.data.rtStatus === "Active" && row.data.rtNext && row.data.rtNext <= today);
  const created: Array<{ kind: string; id: string; label: string }> = [];
  const errors: string[] = [];
  for (const template of templates) {
    let data = template.data;
    try {
      assertCanWrite(me, data.rtKind);
      for (let guard = 0; guard < 36 && data.rtStatus === "Active" && data.rtNext && data.rtNext <= today; guard += 1) {
        const saved = await createFromTemplate(me.id, { ...template, data }, data.rtNext);
        const kind = data.rtKind as RecurringKind;
        created.push({ kind, id: saved.id, label: `${recurringKindLabels[kind]} ${saved.data.invoiceNumber || saved.data.billNumber || saved.data.reference || ""} · ${data.rtName}`.trim() });
        data = afterUse(data, data.rtNext);
      }
    } catch (error) {
      errors.push(`${template.data.rtName || "Template"}: ${error instanceof Error ? error.message : "couldn’t be created"}`);
    } finally {
      await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, template.id), eq(bookkeepingRecord.userId, me.id)));
    }
  }
  if (created.length) revalidatePath("/app", "layout");
  return { created, errors };
}
