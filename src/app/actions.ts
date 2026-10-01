"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { sendEmailOrThrow } from "@/lib/email";
import { createUploadUrl } from "@/lib/storage";
import { isRecordKind, type BookkeepingRecord, type RecordKind } from "@/lib/bookkeeping-types";

const convertTargets: Partial<Record<RecordKind, RecordKind>> = {
  estimates: "invoices",
  "sales-orders": "invoices",
  "purchase-orders": "bills",
};

type StoredRow = typeof bookkeepingRecord.$inferSelect;

function serializeRow(row: StoredRow): BookkeepingRecord {
  let data = row.data;
  const today = new Date().toISOString().slice(0, 10);
  if (
    row.kind === "invoices" &&
    data.dueDate &&
    data.dueDate < today &&
    !["Draft", "Paid", "Cancelled"].includes(data.status ?? "") &&
    Number(data.amount || 0) - Number(data.paidAmount || 0) - Number(data.creditApplied || 0) > 0
  ) {
    data = { ...data, status: "Overdue" };
  }
  return {
    id: row.id,
    kind: row.kind as RecordKind,
    data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sanitizePayload(input: Record<string, string>): Record<string, string> {
  const entries = Object.entries(input);
  if (entries.length > 60) throw new Error("This record has too many fields.");

  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof value !== "string") {
        throw new Error("One of the values needs to be checked.");
      }
      return [key, value.trim().slice(0, key === "emailTemplate" ? 12000 : key === "lines" ? 30000 : 4000)];
    }),
  );
}

function amountFromLineItems(data: Record<string, string>): Record<string, string> {
  if (!data.lineItems?.trim()) return data;

  const lines = data.lineItems
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));
  if (lines.length === 0 || lines.some((parts) => {
    const quantity = Number(parts[1]?.trim());
    const rate = Number(parts[2]?.trim());
    return !parts[0]?.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0;
  })) {
    throw new Error("Enter each line item as description | quantity | rate.");
  }

  const subtotal = lines.reduce((total, parts) => {
      const quantity = Number(parts[1]?.trim());
      const rate = Number(parts[2]?.trim());
      return total + quantity * rate;
    }, 0);
  const taxRate = Math.max(0, Number(data.taxRate) || 0);
  const discount = Math.max(0, Number(data.discount) || 0);
  if (taxRate > 100) throw new Error("Tax rate can’t be greater than 100%.");
  if (Number(data.taxRate) < 0 || Number(data.discount) < 0) throw new Error("Tax and discount values can’t be negative.");
  const taxAmount = subtotal * (taxRate / 100);

  return {
    ...data,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    amount: Math.max(0, subtotal + taxAmount - discount).toFixed(2),
  };
}

export async function listBookkeepingRecords(kind: string): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  if (!isRecordKind(kind)) throw new Error("That section isn’t available.");

  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  return rows.map(serializeRow);
}

export async function listAllBookkeepingRecords(): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(eq(bookkeepingRecord.userId, me.id))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  return rows.map(serializeRow);
}

export async function saveBookkeepingRecord(
  kind: string,
  input: Record<string, string>,
  id?: string,
): Promise<BookkeepingRecord> {
  const me = await requireUser();
  if (!isRecordKind(kind)) throw new Error("That section isn’t available.");
  if (kind === "reconciliations") throw new Error("Completed reconciliations can only be created from the reconciliation screen.");
  let data = amountFromLineItems(sanitizePayload(input));
  if (["invoices", "estimates", "sales-orders", "recurring-invoices", "purchase-orders"].includes(kind) && !data.lineItems?.trim()) {
    throw new Error("Add at least one line item as description | quantity | rate.");
  }
  if (kind === "journals" && data.lines) {
    if (!data.date || !data.reference) throw new Error("Enter the journal date and number.");

    let submittedLines: unknown;
    try {
      submittedLines = JSON.parse(data.lines);
    } catch {
      throw new Error("Check the journal lines and try again.");
    }
    if (!Array.isArray(submittedLines) || submittedLines.length > 50) throw new Error("A journal can include up to 50 lines.");

    const accountRows = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
    const accountsById = new Map(accountRows.map((account) => [account.id, account]));
    const journalLines: {
      accountId: string;
      account: string;
      accountCode: string;
      debit: string;
      credit: string;
      description: string;
      name: string;
    }[] = [];
    let debitTotalCents = 0;
    let creditTotalCents = 0;

    for (const [index, entry] of submittedLines.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Check journal line ${index + 1}.`);
      const line = entry as Record<string, unknown>;
      const accountId = typeof line.accountId === "string" ? line.accountId.trim() : "";
      const debitText = typeof line.debit === "string" ? line.debit.trim() : "";
      const creditText = typeof line.credit === "string" ? line.credit.trim() : "";
      const description = typeof line.description === "string" ? line.description.trim().slice(0, 300) : "";
      const name = typeof line.name === "string" ? line.name.trim().slice(0, 160) : "";
      if (!accountId && !debitText && !creditText && !description && !name) continue;
      if (!accountId) throw new Error(`Choose a chart account for journal line ${index + 1}.`);

      const account = accountsById.get(accountId);
      if (!account) throw new Error(`The account on journal line ${index + 1} is no longer available.`);

      const debit = Number(debitText || 0);
      const credit = Number(creditText || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new Error(`Journal line ${index + 1} must use non-negative amounts.`);
      }
      const debitCents = Math.round(debit * 100);
      const creditCents = Math.round(credit * 100);
      if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents)) throw new Error("Journal amounts are too large.");
      if (debitCents === 0 && creditCents === 0) throw new Error(`Enter a debit or credit for journal line ${index + 1}.`);
      if (debitCents > 0 && creditCents > 0) throw new Error(`Use either debit or credit on journal line ${index + 1}, not both.`);

      const accountName = account.data.name || account.data.code || "Account";
      const accountCode = account.data.code || "";
      journalLines.push({
        accountId,
        account: accountName,
        accountCode,
        debit: (debitCents / 100).toFixed(2),
        credit: (creditCents / 100).toFixed(2),
        description,
        name,
      });
      debitTotalCents += debitCents;
      creditTotalCents += creditCents;
    }

    if (journalLines.length < 2) throw new Error("Add at least two journal lines.");
    if (debitTotalCents === 0 || debitTotalCents !== creditTotalCents) throw new Error("Total debits and credits must match.");

    const firstDebit = journalLines.find((line) => Number(line.debit) > 0);
    const firstCredit = journalLines.find((line) => Number(line.credit) > 0);
    data = {
      ...data,
      lines: JSON.stringify(journalLines),
      debitAccount: firstDebit?.account ?? "",
      creditAccount: firstCredit?.account ?? "",
      amount: (debitTotalCents / 100).toFixed(2),
      memo: journalLines.map((line) => line.description).filter(Boolean).join(" · ").slice(0, 4000),
    };
  } else if (kind === "journals") {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Journal amounts must be greater than zero.");
    if (data.debitAccount && data.debitAccount === data.creditAccount) throw new Error("Choose different debit and credit accounts.");
  }

  if (id && kind === "transactions") {
    const [existing] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
      .limit(1);
    if (existing?.data.reconciled === "true") throw new Error("This transaction is part of a completed reconciliation and can’t be edited.");
  }

  if (kind === "transactions" && data.description) {
    const rules = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-rules")));
    const matchedRule = rules.find((rule) =>
      rule.data.enabled !== "false" &&
      rule.data.contains &&
      data.description.toLowerCase().includes(rule.data.contains.toLowerCase()),
    );
    if (matchedRule) {
      data = {
        ...data,
        category: data.category || matchedRule.data.category || "",
        account: data.account || matchedRule.data.account || "",
        ruleApplied: matchedRule.data.name || "Bank rule",
      };
    }
  }

  if (id) {
    const [updated] = await db
      .update(bookkeepingRecord)
      .set({ data, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
      .returning();
    if (!updated) throw new Error("We couldn’t find that record. Refresh and try again.");
    revalidatePath("/app", "layout");
    return serializeRow(updated);
  }

  const [created] = await db
    .insert(bookkeepingRecord)
    .values({ userId: me.id, kind, data })
    .returning();
  if (kind === "invoices" && data.invoiceNumber) {
    const [settings] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
      .orderBy(desc(bookkeepingRecord.updatedAt))
      .limit(1);
    if (settings) {
      const invoiceSequence = Number(data.invoiceNumber.replace(/\D/g, ""));
      if (Number.isFinite(invoiceSequence) && invoiceSequence >= Number(settings.data.nextInvoiceNumber || 1)) {
        await db
          .update(bookkeepingRecord)
          .set({ data: { ...settings.data, nextInvoiceNumber: String(invoiceSequence + 1) }, updatedAt: new Date() })
          .where(and(eq(bookkeepingRecord.id, settings.id), eq(bookkeepingRecord.userId, me.id)));
      }
    }
  }
  revalidatePath("/app", "layout");
  return serializeRow(created);
}

export async function deleteBookkeepingRecord(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  if (!isRecordKind(kind)) throw new Error("That section isn’t available.");
  if (kind === "reconciliations") throw new Error("Completed reconciliations can’t be deleted.");
  if (kind === "transactions") {
    const [existing] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
      .limit(1);
    if (existing?.data.reconciled === "true") throw new Error("This transaction is part of a completed reconciliation and can’t be deleted.");
  }
  const [deleted] = await db
    .delete(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .returning({ id: bookkeepingRecord.id });
  if (!deleted) throw new Error("We couldn’t find that record. Refresh and try again.");
  revalidatePath("/app", "layout");
}

export async function recordInvoicePayment(
  id: string,
  amountInput: string,
  paymentDate: string,
  method: string,
): Promise<void> {
  const me = await requireUser();
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than zero.");

  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")))
    .limit(1);
  if (!invoice) throw new Error("We couldn’t find that invoice. Refresh and try again.");

  const data = invoice.data;
  const total = Number(data.amount) || 0;
  const paid = Number(data.paidAmount) || 0;
  const credited = Number(data.creditApplied) || 0;
  if (amount > total - paid - credited + 0.005) throw new Error("That payment is greater than the remaining balance.");

  const updatedPaid = paid + amount;
  const updatedData = {
    ...data,
    paidAmount: updatedPaid.toFixed(2),
    status: updatedPaid + credited >= total ? "Paid" : "Partially Paid",
  };
  await db
    .update(bookkeepingRecord)
    .set({ data: updatedData, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "payments",
    data: {
      invoiceId: id,
      invoiceNumber: data.invoiceNumber ?? "Invoice",
      customer: data.customer ?? "",
      amount: amount.toFixed(2),
      paymentDate,
      method,
    },
  });
  revalidatePath("/app", "layout");
}

export async function markRecordPaid(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  if (kind !== "bills" && kind !== "invoices") throw new Error("That payment action isn’t available here.");
  const [row] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .limit(1);
  if (!row) throw new Error("We couldn’t find that record. Refresh and try again.");
  const data = { ...row.data, paidAmount: row.data.amount ?? "0", status: "Paid" };
  await db
    .update(bookkeepingRecord)
    .set({ data, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function convertBookkeepingRecord(id: string): Promise<void> {
  const me = await requireUser();
  const [source] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)))
    .limit(1);
  if (!source) throw new Error("We couldn’t find that record. Refresh and try again.");
  const sourceKind = source.kind as RecordKind;
  const targetKind = convertTargets[sourceKind];
  if (!targetKind) throw new Error("This record can’t be converted.");

  const today = new Date().toISOString().slice(0, 10);
  const sourceData = source.data;
  const targetData = amountFromLineItems({
    ...sourceData,
    ...(targetKind === "invoices"
      ? {
          invoiceNumber: `INV-${Date.now()}`,
          issueDate: today,
          dueDate: sourceData.expiryDate ?? "",
          paidAmount: "0",
          status: "Draft",
        }
      : {
          billNumber: `BILL-${Date.now()}`,
          billDate: today,
          dueDate: "",
          paidAmount: "0",
          status: "Open",
        }),
  });
  await db.insert(bookkeepingRecord).values({ userId: me.id, kind: targetKind, data: targetData });
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...sourceData, status: "Converted" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, source.id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function toggleTransactionMatch(id: string): Promise<void> {
  const me = await requireUser();
  const [transaction] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
    .limit(1);
  if (!transaction) throw new Error("We couldn’t find that transaction. Refresh and try again.");
  await db
    .update(bookkeepingRecord)
    .set({
      data: { ...transaction.data, matched: transaction.data.matched === "true" ? "false" : "true" },
      updatedAt: new Date(),
    })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function completeBankReconciliation(
  bankAccountId: string,
  statementDate: string,
  endingBalanceInput: string,
  transactionIds: string[],
): Promise<BookkeepingRecord> {
  const me = await requireUser();
  const endingBalance = Number(endingBalanceInput);
  const parsedStatementDate = new Date(`${statementDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDate) || Number.isNaN(parsedStatementDate.getTime()) || parsedStatementDate.toISOString().slice(0, 10) !== statementDate) {
    throw new Error("Choose a valid statement ending date.");
  }
  if (!Number.isFinite(endingBalance)) throw new Error("Enter the ending balance shown on your bank statement.");
  if (!Array.isArray(transactionIds) || transactionIds.length > 500) throw new Error("Select up to 500 transactions at a time.");
  const uniqueTransactionIds = [...new Set(transactionIds)];
  if (uniqueTransactionIds.length !== transactionIds.length) throw new Error("A transaction was selected more than once.");

  const created = await db.transaction(async (tx) => {
    const [bankAccount] = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, bankAccountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-accounts")))
      .for("update")
      .limit(1);
    if (!bankAccount || !bankAccount.data.name) throw new Error("Choose a bank account from your Banking section.");

    const bankAccounts = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-accounts")));
    if (bankAccounts.filter((record) => record.data.name === bankAccount.data.name).length > 1) {
      throw new Error("Bank account names must be unique before they can be reconciled.");
    }

    const reconciliationRows = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "reconciliations")));
    const accountReconciliations = reconciliationRows.filter((record) => record.data.bankAccountId === bankAccount.id);
    if (accountReconciliations.some((record) => record.data.statementDate === statementDate)) {
      throw new Error("This statement date has already been reconciled for that account.");
    }
    if (accountReconciliations.some((record) => record.data.statementDate > statementDate)) {
      throw new Error("Reconcile this account’s statements in date order, starting with the earliest one.");
    }
    const priorReconciliation = accountReconciliations
      .filter((record) => record.data.statementDate < statementDate)
      .sort((first, second) => second.data.statementDate.localeCompare(first.data.statementDate))[0];
    const openingBalanceInput = priorReconciliation?.data.endingBalance ?? bankAccount.data.openingBalance ?? "0";
    const openingBalance = Number(openingBalanceInput);
    if (!Number.isFinite(openingBalance)) throw new Error("Update this account’s opening balance before reconciling.");

    const transactionRows = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
      .for("update");
    const selectedRows = uniqueTransactionIds.map((id) => transactionRows.find((record) => record.id === id));
    if (selectedRows.some((record) => !record)) throw new Error("One or more selected transactions aren’t available in this account.");

    const selectedTransactions = selectedRows.filter((record): record is (typeof transactionRows)[number] => Boolean(record));
    const openingCents = Math.round(openingBalance * 100);
    const endingCents = Math.round(endingBalance * 100);
    let netClearedCents = 0;
    let depositCents = 0;
    let withdrawalCents = 0;

    for (const transaction of selectedTransactions) {
      const amount = Number(transaction.data.amount);
      if (transaction.data.account !== bankAccount.data.name) throw new Error("Each selected transaction must belong to the chosen bank account.");
      if (transaction.data.reconciled === "true") throw new Error("A selected transaction is already part of a completed reconciliation.");
      if (!transaction.data.date || transaction.data.date > statementDate || (priorReconciliation && transaction.data.date <= priorReconciliation.data.statementDate)) {
        throw new Error("Selected transactions must fall within this statement period.");
      }
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Every selected transaction needs a valid amount greater than zero.");
      const amountCents = Math.round(amount * 100);
      if (transaction.data.type === "Withdrawal") {
        netClearedCents -= amountCents;
        withdrawalCents += amountCents;
      } else if (transaction.data.type === "Deposit") {
        netClearedCents += amountCents;
        depositCents += amountCents;
      } else {
        throw new Error("Choose Deposit or Withdrawal for each selected transaction.");
      }
    }

    const differenceCents = endingCents - openingCents - netClearedCents;
    if (differenceCents !== 0) throw new Error("The selected transactions don’t balance to the statement ending balance yet.");

    const [reconciliation] = await tx
      .insert(bookkeepingRecord)
      .values({
        userId: me.id,
        kind: "reconciliations",
        data: {
          bankAccountId: bankAccount.id,
          bankAccountName: bankAccount.data.name,
          currency: bankAccount.data.currency || "USD",
          statementDate,
          openingBalance: (openingCents / 100).toFixed(2),
          endingBalance: (endingCents / 100).toFixed(2),
          clearedDeposits: (depositCents / 100).toFixed(2),
          clearedWithdrawals: (withdrawalCents / 100).toFixed(2),
          clearedCount: String(selectedTransactions.length),
          difference: "0.00",
        },
      })
      .returning();

    for (const transaction of selectedTransactions) {
      await tx
        .update(bookkeepingRecord)
        .set({
          data: { ...transaction.data, reconciled: "true", reconciliationId: reconciliation.id },
          updatedAt: new Date(),
        })
        .where(and(eq(bookkeepingRecord.id, transaction.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")));
    }

    return reconciliation;
  });

  revalidatePath("/app", "layout");
  return serializeRow(created);
}

export async function applyCreditNote(id: string): Promise<void> {
  const me = await requireUser();
  const [creditNote] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "credit-notes")))
    .limit(1);
  if (!creditNote) throw new Error("We couldn’t find that credit note. Refresh and try again.");
  if (creditNote.data.status === "Applied" || creditNote.data.status === "Refunded") throw new Error("This credit note has already been used.");
  if (!creditNote.data.invoiceNumber) throw new Error("Add an invoice number to this credit note first.");

  const invoices = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")));
  const invoice = invoices.find((item) => item.data.invoiceNumber === creditNote.data.invoiceNumber);
  if (!invoice) throw new Error("We couldn’t find an invoice with that number in this account.");

  const creditAmount = Number(creditNote.data.amount) || 0;
  const paid = Number(invoice.data.paidAmount) || 0;
  const alreadyCredited = Number(invoice.data.creditApplied) || 0;
  const remaining = Number(invoice.data.amount) - paid - alreadyCredited;
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) throw new Error("Enter a credit amount greater than zero.");
  if (creditAmount > remaining + 0.005) throw new Error("The credit is greater than this invoice’s remaining balance.");

  const newCredit = alreadyCredited + creditAmount;
  await db
    .update(bookkeepingRecord)
    .set({
      data: { ...invoice.data, creditApplied: newCredit.toFixed(2), status: paid + newCredit >= Number(invoice.data.amount) ? "Paid" : invoice.data.status },
      updatedAt: new Date(),
    })
    .where(and(eq(bookkeepingRecord.id, invoice.id), eq(bookkeepingRecord.userId, me.id)));
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...creditNote.data, appliedAmount: creditAmount.toFixed(2), status: "Applied" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function generateRecurringInvoice(id: string): Promise<void> {
  const me = await requireUser();
  const [schedule] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "recurring-invoices")))
    .limit(1);
  if (!schedule) throw new Error("We couldn’t find that recurring invoice. Refresh and try again.");
  if (schedule.data.status === "Paused") throw new Error("Resume this schedule before generating its invoice.");

  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt))
    .limit(1);
  const sequence = Math.max(1, Number(settings?.data.nextInvoiceNumber) || 1);
  const prefix = settings?.data.invoicePrefix || "INV-";
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(`${today}T12:00:00`);
  dueDate.setDate(dueDate.getDate() + 30);
  const invoiceData = amountFromLineItems({
    ...schedule.data,
    invoiceNumber: `${prefix}${String(sequence).padStart(4, "0")}`,
    issueDate: today,
    dueDate: dueDate.toISOString().slice(0, 10),
    currency: settings?.data.currency || "USD",
    exchangeRate: "1",
    paidAmount: "0",
    status: "Draft",
  });
  await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "invoices", data: invoiceData });

  const nextDate = new Date(`${schedule.data.nextDate || today}T12:00:00`);
  if (nextDate < new Date(`${today}T12:00:00`)) nextDate.setTime(new Date(`${today}T12:00:00`).getTime());
  if (schedule.data.frequency === "Weekly") nextDate.setDate(nextDate.getDate() + 7);
  else if (schedule.data.frequency === "Quarterly") nextDate.setMonth(nextDate.getMonth() + 3);
  else if (schedule.data.frequency === "Yearly") nextDate.setFullYear(nextDate.getFullYear() + 1);
  else nextDate.setMonth(nextDate.getMonth() + 1);
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...schedule.data, nextDate: nextDate.toISOString().slice(0, 10) }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  if (settings) {
    await db
      .update(bookkeepingRecord)
      .set({ data: { ...settings.data, nextInvoiceNumber: String(sequence + 1) }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, settings.id), eq(bookkeepingRecord.userId, me.id)));
  }
  revalidatePath("/app", "layout");
}

export async function sendInvoiceRecord(id: string): Promise<void> {
  const me = await requireUser();
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")));
  const invoice = rows.find((row) => row.id === id);
  if (!invoice) throw new Error("We couldn’t find that invoice. Refresh and try again.");
  const customerName = invoice.data.customer?.toLowerCase();
  const customers = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "customers")));
  const customer = customers.find((row) => row.data.name?.toLowerCase() === customerName);
  if (!customer?.data.email) throw new Error("Add an email address to this customer before sending the invoice.");

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });
  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt))
    .limit(1);
  const company = settings?.data.companyName || me.name;
  const template = settings?.data.emailTemplate?.trim();
  const body = template
    ? template
        .replaceAll("{{customer}}", customer.data.name ?? "there")
        .replaceAll("{{invoice}}", invoice.data.invoiceNumber ?? "")
        .replaceAll("{{amount}}", invoice.data.amount ?? "0")
        .replaceAll("{{company}}", company)
    : `Hello ${customer.data.name ?? "there"}, your invoice ${invoice.data.invoiceNumber ?? ""} for ${invoice.data.amount ?? "0"} ${invoice.data.currency ?? ""} is ready.`;
  await sendEmailOrThrow({
    to: customer.data.email,
    subject: `Invoice ${invoice.data.invoiceNumber ?? ""} from ${company}`,
    html: `<p>${escapeHtml(body)}</p>`,
    fromName: company,
  });
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...invoice.data, status: "Sent" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function getAttachmentUploadTarget(
  filename: string,
  contentType: string,
  size: number,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  await requireUser();
  if (size > 10 * 1024 * 1024) throw new Error("Attachments must be 10 MB or smaller.");
  const target = await createUploadUrl({ filename, contentType, size });
  return { uploadUrl: target.uploadUrl, publicUrl: target.publicUrl };
}
