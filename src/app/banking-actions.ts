"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { recordAudit } from "@/lib/audit";
import { assertCanWrite, requireUser } from "@/lib/auth";
import { assertBooksOpen } from "@/lib/closing";
import { parseCsv } from "@/lib/budget-utils";
import { isUndepositedFunds, paymentAccountType } from "@/lib/payment-accounts";
import { revalidatePath } from "@/lib/revalidate";
import { supplierCategoryForBankLine } from "@/lib/supplier-memory";

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

function money(value: unknown) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

async function account(userId: string, id: string) {
  const [row] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "accounts"))).limit(1);
  return row;
}

export interface DepositInput {
  date: string;
  accountId: string;
  memo?: string;
  /** Customer payments waiting in Undeposited funds. */
  paymentIds: string[];
  /** Other money deposited, each credited to an account (income, a loan, owner's investment…). */
  lines: Array<{ accountId: string; description?: string; amount: string }>;
}

/** QuickBooks' Bank deposit: moves payments from Undeposited funds, plus any other money, into a bank account. */
export async function saveBankDeposit(input: DepositInput): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "deposits");
  if (!isDate(input?.date)) throw new ActionError("Choose the deposit date.");
  await assertBooksOpen(me.id, input.date);
  const bank = await account(me.id, String(input.accountId ?? ""));
  const bankType = bank ? paymentAccountType({ kind: "accounts", data: bank.data }) : null;
  if (!bank || !bankType || bankType === "Credit card") throw new ActionError("Choose the bank or cash account the money went into.");
  const paymentIds = Array.isArray(input.paymentIds) ? [...new Set(input.paymentIds.map(String))].slice(0, 500) : [];
  const payments = paymentIds.length
    ? await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), inArray(bookkeepingRecord.id, paymentIds)))
    : [];
  if (payments.length !== paymentIds.length) throw new ActionError("One of the payments is no longer there. Refresh and try again.");
  const accounts = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
  for (const payment of payments) {
    const target = accounts.find((row) => row.id === payment.data.paymentAccountId);
    if (payment.data.depositId) throw new ActionError(`${payment.data.invoiceNumber || "A payment"} has already been deposited.`);
    if (!target || !isUndepositedFunds({ kind: "accounts", data: target.data })) throw new ActionError(`${payment.data.invoiceNumber || "A payment"} isn’t waiting in Undeposited funds.`);
  }
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 100).flatMap((line) => {
    if (!line?.accountId && !money(line?.amount)) return [];
    const amount = money(line.amount);
    const target = accounts.find((row) => row.id === line.accountId && row.data.locked !== "true");
    if (!target) throw new ActionError("Choose the account each other deposit line is from.");
    if (!(amount > 0)) throw new ActionError("Each other deposit line needs an amount greater than zero.");
    return [{ accountId: target.id, account: target.data.name || target.data.code || "Account", description: String(line.description ?? "").slice(0, 200), amount: amount.toFixed(2) }];
  });
  const paymentTotal = payments.reduce((sum, payment) => sum + (Number(payment.data.amount) || 0), 0);
  const total = Math.round((paymentTotal + lines.reduce((sum, line) => sum + Number(line.amount), 0)) * 100) / 100;
  if (total <= 0) throw new ActionError("Choose payments to deposit or add another deposit line.");
  const [deposit] = await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "deposits",
    data: {
      date: input.date,
      accountId: bank.id,
      accountName: bank.data.name || "Bank",
      memo: String(input.memo ?? "").slice(0, 500),
      paymentIds: JSON.stringify(payments.map((payment) => payment.id)),
      paymentTotal: paymentTotal.toFixed(2),
      lines: JSON.stringify(lines),
      amount: total.toFixed(2),
      reference: `DEP-${input.date.replace(/-/g, "")}`,
    },
  }).returning();
  for (const payment of payments) {
    await db.update(bookkeepingRecord).set({ data: { ...payment.data, depositId: deposit.id }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, payment.id));
  }
  await recordAudit(me, "Added", "deposits", deposit.id, deposit.data);
  revalidatePath("/app", "layout");
}

/** Takes a deposit back: its payments wait in Undeposited funds again. */
export async function deleteBankDeposit(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "deposits");
  const [deposit] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "deposits"))).limit(1);
  if (!deposit) throw new ActionError("We couldn’t find that deposit. Refresh and try again.");
  await assertBooksOpen(me.id, deposit.data.date);
  const payments = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments")));
  for (const payment of payments.filter((row) => row.data.depositId === id)) {
    const rest = { ...payment.data };
    delete rest.depositId;
    await db.update(bookkeepingRecord).set({ data: rest, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, payment.id));
  }
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, id));
  await recordAudit(me, "Deleted", "deposits", deposit.id, deposit.data);
  revalidatePath("/app", "layout");
}

/** QuickBooks' Transfer: moves money between two bank, cash or card accounts. */
export async function saveTransfer(input: { date: string; fromAccountId: string; toAccountId: string; amount: string; memo?: string }): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "transactions");
  if (!isDate(input?.date)) throw new ActionError("Choose the transfer date.");
  await assertBooksOpen(me.id, input.date);
  const from = await account(me.id, String(input.fromAccountId ?? ""));
  const to = await account(me.id, String(input.toAccountId ?? ""));
  if (!from || !paymentAccountType({ kind: "accounts", data: from.data })) throw new ActionError("Choose the account the money came from.");
  if (!to || !paymentAccountType({ kind: "accounts", data: to.data })) throw new ActionError("Choose the account the money went to.");
  if (from.id === to.id) throw new ActionError("Choose two different accounts.");
  const amount = money(input.amount);
  if (!(amount > 0)) throw new ActionError("Enter an amount greater than zero.");
  const [created] = await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "transactions",
    data: {
      date: input.date,
      type: "Transfer",
      description: String(input.memo ?? "").slice(0, 300) || `Transfer to ${to.data.name}`,
      account: from.data.name || "",
      accountId: from.id,
      toAccount: to.data.name || "",
      toAccountId: to.id,
      amount: amount.toFixed(2),
      matched: "false",
    },
  }).returning();
  await recordAudit(me, "Added", "transactions", created.id, created.data);
  revalidatePath("/app", "layout");
}

/**
 * Imports a bank statement saved as CSV (Date, Description, Amount; or Date, Description, Debit, Credit),
 * as QuickBooks' "Upload from file". Lines already imported (same date, description and amount) are skipped.
 */
export async function importBankStatement(accountName: string, csv: string): Promise<{ imported: number; skipped: number }> {
  const me = await requireUser();
  assertCanWrite(me, "transactions");
  const name = String(accountName ?? "").trim();
  if (!name) throw new ActionError("Choose the bank account this statement is for.");
  if (typeof csv !== "string" || csv.length > 2_000_000) throw new ActionError("Choose a CSV file up to 2 MB.");
  const [headers, ...rows] = parseCsv(csv);
  if (!headers || !rows.length) throw new ActionError("The statement needs a header row and at least one line.");
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header.replace(/^﻿/, "").trim().toLowerCase()));
  const dateAt = column("date", "transaction date", "posting date", "value date");
  const descriptionAt = column("description", "details", "narration", "memo", "payee", "particulars");
  const amountAt = column("amount");
  const debitAt = column("debit", "withdrawal", "withdrawals", "money out", "paid out");
  const creditAt = column("credit", "deposit", "deposits", "money in", "paid in");
  if (dateAt < 0 || descriptionAt < 0 || (amountAt < 0 && debitAt < 0 && creditAt < 0)) {
    throw new ActionError("The CSV needs Date, Description and Amount columns (or Debit and Credit columns).");
  }
  if (rows.length > 2000) throw new ActionError("Import up to 2,000 lines at a time.");
  const existing = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")));
  const seen = new Set(existing.map((row) => `${row.data.account}|${row.data.date}|${row.data.description}|${row.data.amount}|${row.data.type}`));
  const rules = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-rules"))))
    .filter((rule) => rule.data.enabled !== "false" && rule.data.contains?.trim());
  const [suppliers, accounts] = await Promise.all(["vendors", "accounts"].map((kind) => db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))));
  let imported = 0;
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    if (row.every((cell) => !cell?.trim())) continue;
    const date = readDate(row[dateAt] ?? "");
    if (!date) throw new ActionError(`Line ${index + 2}: the date “${row[dateAt] ?? ""}” isn’t one we can read. Use YYYY-MM-DD or DD/MM/YYYY.`);
    const description = (row[descriptionAt] ?? "").trim().slice(0, 300) || "Bank transaction";
    let value = amountAt >= 0 ? money(row[amountAt]) : money(row[creditAt] || 0) - money(row[debitAt] || 0);
    if (amountAt < 0 && Number.isNaN(value)) value = money(row[creditAt] || 0) || -money(row[debitAt] || 0);
    if (Number.isNaN(value)) throw new ActionError(`Line ${index + 2}: the amount isn’t a number.`);
    if (!value) continue;
    const type = value > 0 ? "Deposit" : "Withdrawal";
    const amount = Math.abs(value).toFixed(2);
    const key = `${name}|${date}|${description}|${amount}|${type}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    // Bank rules categorise the new lines, as they do when lines are entered by hand.
    const rule = rules.find((candidate) => description.toLowerCase().includes(candidate.data.contains.trim().toLowerCase()));
    // No bank rule fits: money paid to a supplier named in the line goes to their default category.
    const fromSupplier = !rule && type === "Withdrawal" ? supplierCategoryForBankLine(description, suppliers, accounts) : null;
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "transactions",
      data: { date, description, account: name, type, amount, category: rule?.data.category || fromSupplier?.category || "", matched: "false", imported: "true", ...(rule ? { ruleApplied: rule.data.name || "Bank rule" } : fromSupplier ? { ruleApplied: `Supplier: ${fromSupplier.supplier}` } : {}) },
    });
    imported += 1;
  }
  await recordAudit(me, "Imported", "transactions", "", { description: `${imported} statement lines into ${name}` });
  revalidatePath("/app", "layout");
  return { imported, skipped };
}

function readDate(text: string) {
  const value = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const [day, month] = [Number(dmy[1]), Number(dmy[2])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** Undoes the latest reconciliation of a bank account, as QuickBooks lets an accountant do. */
export async function undoBankReconciliation(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "transactions");
  const all = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "reconciliations")));
  const target = all.find((row) => row.id === id);
  if (!target) throw new ActionError("We couldn’t find that reconciliation. Refresh and try again.");
  const later = all.some((row) => row.id !== id && row.data.bankAccountId === target.data.bankAccountId && (row.data.statementDate ?? "") > (target.data.statementDate ?? ""));
  if (later) throw new ActionError("Undo the later reconciliations of this account first.");
  const transactions = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")));
  for (const transaction of transactions.filter((row) => row.data.reconciliationId === id)) {
    const rest: Record<string, string> = { ...transaction.data, reconciled: "false" };
    delete rest.reconciliationId;
    await db.update(bookkeepingRecord).set({ data: rest, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, transaction.id));
  }
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, id));
  await recordAudit(me, "Undone", "reconciliations", id, target.data);
  revalidatePath("/app", "layout");
}
