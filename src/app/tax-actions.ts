"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { assertAdmin, assertCanRead, assertCanWrite, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { assertBooksOpen } from "@/lib/closing";
import { paymentAccountType } from "@/lib/payment-accounts";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { revalidatePath } from "@/lib/revalidate";
import { countryPacks, isCountryCode, type CountryCode, type PackAccount } from "@/lib/tax-packs";

type StoredRow = typeof bookkeepingRecord.$inferSelect;

function toRecord(row: StoredRow): BookkeepingRecord {
  return { id: row.id, kind: row.kind as RecordKind, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function rows(userId: string, kinds: string[]) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, kinds)));
}

export interface TaxSetupState {
  settings: Record<string, string>;
  taxes: BookkeepingRecord[];
  canChange: boolean;
}

export async function getTaxSetup(): Promise<TaxSetupState> {
  const me = await requireUser();
  assertCanRead(me, "taxes");
  const found = await rows(me.id, ["settings", "taxes"]);
  return {
    settings: found.find((row) => row.kind === "settings")?.data ?? {},
    taxes: found.filter((row) => row.kind === "taxes").map(toRecord),
    canChange: me.role === "Admin",
  };
}

function chartAccount(account: PackAccount) {
  if (account.type === "Asset") return { type: "Asset", accountType: "Current assets", detailType: "Other current assets" };
  const salesTax = /tax payable \(output|vat output|sales tax|services payable/i.test(account.name);
  const payroll = /withholding|eobi|gosi/i.test(account.name);
  return { type: "Liability", accountType: "Current liabilities", detailType: salesTax ? "Sales tax payable" : payroll ? "Payroll tax payable" : "Other current liabilities" };
}

export interface ApplyPackOptions {
  /** Also set the business's currency, fiscal year start and time zone to the country's. */
  updateSettings: boolean;
}

/**
 * Installs a country's tax rates and tax accounts, leaving anything the business
 * already has alone, and records the country for tax returns and payroll.
 */
export async function applyCountryPack(code: CountryCode, options: ApplyPackOptions): Promise<{ taxesAdded: number; accountsAdded: number }> {
  const me = await requireUser();
  assertAdmin(me);
  if (!isCountryCode(code)) throw new ActionError("Choose a country.");
  const pack = countryPacks[code];
  return db.transaction(async (transaction) => {
    const existing = await transaction.select().from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["settings", "taxes", "accounts"])));
    const taxes = existing.filter((row) => row.kind === "taxes");
    const accounts = existing.filter((row) => row.kind === "accounts");
    const hasDefault = taxes.some((row) => row.data.isDefault === "true" && row.data.enabled !== "false");
    const taxNames = new Set(taxes.map((row) => row.data.name?.trim().toLowerCase()));
    const newTaxes = pack.taxes.filter((tax) => !taxNames.has(tax.name.toLowerCase())).map((tax) => ({
      userId: me.id,
      kind: "taxes",
      data: {
        name: tax.name,
        rate: String(tax.rate),
        type: tax.type,
        appliesTo: tax.appliesTo,
        component: tax.type === "Withholding" ? "WHT" : code === "PK" ? (tax.type === "Provincial services" ? "PST" : "GST") : "VAT",
        jurisdiction: tax.jurisdiction,
        isDefault: tax.isDefault && !hasDefault ? "true" : "false",
        enabled: "true",
        note: tax.note ?? "",
        countryPack: code,
      },
    }));
    if (newTaxes.length) await transaction.insert(bookkeepingRecord).values(newTaxes);

    const accountNames = new Set(accounts.map((row) => row.data.name?.trim().toLowerCase()));
    const accountCodes = new Set(accounts.map((row) => row.data.code?.trim().toLowerCase()));
    const newAccounts = pack.accounts.filter((account) => !accountNames.has(account.name.toLowerCase())).map((account) => {
      // Keep the pack's number unless it is already used by another account.
      let accountCode = account.code;
      while (accountCodes.has(accountCode.toLowerCase())) accountCode = String(Number(accountCode) + 1);
      accountCodes.add(accountCode.toLowerCase());
      return { userId: me.id, kind: "accounts", data: { code: accountCode, name: account.name, description: account.description, ...chartAccount(account) } };
    });
    if (newAccounts.length) await transaction.insert(bookkeepingRecord).values(newAccounts);

    const settings = existing.find((row) => row.kind === "settings");
    const settingsData: Record<string, string> = {
      ...(settings?.data ?? { companyName: me.workspaceName }),
      taxCountry: code,
      ...(options.updateSettings ? { currency: pack.currency, fiscalYear: pack.fiscalYear, timeZone: pack.timeZone } : {}),
    };
    if (settings) await transaction.update(bookkeepingRecord).set({ data: settingsData, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, settings.id));
    else await transaction.insert(bookkeepingRecord).values({ userId: me.id, kind: "settings", data: settingsData });

    revalidatePath("/app", "layout");
    return { taxesAdded: newTaxes.length, accountsAdded: newAccounts.length };
  });
}

/** Saves the business's tax registration numbers (NTN, STRN, TRN…), printed on its invoices. */
export async function saveTaxRegistrations(values: Record<string, string>): Promise<void> {
  const me = await requireUser();
  assertAdmin(me);
  const allowed = ["ntn", "strn", "trn", "cr", "utr"];
  const clean = Object.fromEntries(allowed.map((key) => [key, String(values[key] ?? "").trim().slice(0, 40)]));
  for (const [key, value] of Object.entries(clean)) {
    if (value && !/^[A-Za-z0-9 -]+$/.test(value)) throw new ActionError(`Use only letters, numbers and dashes in the ${key.toUpperCase()}.`);
  }
  const [settings] = await rows(me.id, ["settings"]);
  if (settings) await db.update(bookkeepingRecord).set({ data: { ...settings.data, ...clean }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, settings.id));
  else await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "settings", data: { companyName: me.workspaceName, ...clean } });
  revalidatePath("/app", "layout");
}

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const amountOf = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

/** Records a tax return as filed for its period, with the tax collected and paid in it (QuickBooks' "Record return"). */
export async function fileTaxReturn(input: { from: string; to: string; returnName: string; outputTax: number; inputTax: number; boxes: string }): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "tax-filings");
  if (!isDate(input?.from) || !isDate(input?.to) || input.from > input.to) throw new ActionError("Choose the return period.");
  const filings = await rows(me.id, ["tax-filings"]);
  const overlap = filings.find((row) => row.data.from <= input.to && row.data.to >= input.from);
  if (overlap) throw new ActionError(`A return is already filed for ${overlap.data.from} to ${overlap.data.to}. Remove it first to file this period again.`);
  const outputTax = amountOf(input.outputTax);
  const inputTax = amountOf(input.inputTax);
  const data = {
    from: input.from,
    to: input.to,
    returnName: String(input.returnName ?? "Tax return").slice(0, 120),
    outputTax: outputTax.toFixed(2),
    inputTax: inputTax.toFixed(2),
    netTax: (outputTax - inputTax).toFixed(2),
    boxes: String(input.boxes ?? "").slice(0, 20000),
    filedAt: new Date().toISOString(),
    filedBy: me.name ?? "",
    status: "Filed",
  };
  const [created] = await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "tax-filings", data }).returning();
  await recordAudit(me, "Filed", "tax-filings", created.id, { ...data, description: `${data.returnName} ${data.from} to ${data.to}`, amount: data.netTax });
  revalidatePath("/app", "layout");
}

/** Records paying the tax due on a filed return from a bank or cash account. */
export async function recordTaxPayment(id: string, paymentDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "tax-filings");
  if (!isDate(paymentDate)) throw new ActionError("Choose the payment date.");
  await assertBooksOpen(me.id, paymentDate);
  const [filing] = (await rows(me.id, ["tax-filings"])).filter((row) => row.id === id);
  if (!filing) throw new ActionError("We couldn’t find that return. Refresh and try again.");
  if (filing.data.status === "Paid") throw new ActionError("This return is already paid.");
  const [account] = (await rows(me.id, ["accounts"])).filter((row) => row.id === accountId);
  const type = account ? paymentAccountType({ kind: "accounts", data: account.data }) : null;
  if (!account || !type) throw new ActionError("Choose the Cash, Bank or Credit card account the tax was paid from.");
  const data: Record<string, string> = { ...filing.data, status: "Paid", paymentDate, paymentAccountId: account.id, paymentAccountName: account.data.name || "Account", paidAmount: filing.data.netTax ?? "0" };
  await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, filing.id));
  await recordAudit(me, "Tax paid", "tax-filings", filing.id, { ...data, description: `${data.returnName} ${data.from} to ${data.to}`, amount: data.netTax });
  revalidatePath("/app", "layout");
}

/** Removes a filed return (and its payment), to file the period again. */
export async function deleteTaxFiling(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "tax-filings");
  const [filing] = (await rows(me.id, ["tax-filings"])).filter((row) => row.id === id);
  if (!filing) throw new ActionError("We couldn’t find that return. Refresh and try again.");
  if (filing.data.paymentDate) await assertBooksOpen(me.id, filing.data.paymentDate);
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, filing.id));
  await recordAudit(me, "Deleted", "tax-filings", filing.id, { ...filing.data, description: `${filing.data.returnName} ${filing.data.from} to ${filing.data.to}` });
  revalidatePath("/app", "layout");
}
