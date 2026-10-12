"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { assertAdmin, assertCanRead, requireUser } from "@/lib/auth";
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
