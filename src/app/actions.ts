"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "@/lib/revalidate";

import { db } from "@/db";
import { ActionError } from "@/lib/action-error";
import { bookkeepingRecord, user } from "@/db/schema";
import { assertCanRead, assertCanWrite, requireUser } from "@/lib/auth";
import { canReadKind } from "@/lib/permissions";
import { applyLoanRepayment } from "@/lib/hr-rules";
import { sendEmailOrThrow } from "@/lib/email";
import { createUploadUrl } from "@/lib/storage";
import { dueDateForTerms, parseInvoiceLines } from "@/lib/invoice-utils";
import { siteUrl } from "@/lib/site";
import { isRecordKind, type BookkeepingRecord, type RecordKind } from "@/lib/bookkeeping-types";
import { paymentAccountType } from "@/lib/payment-accounts";
import { accountCategoryForType, accountDetailsForType } from "@/lib/account-types";
import { standardAccounts } from "@/lib/standard-accounts";
import { budgetActual, budgetExpectedTotal, payrollBudgetHead, budgetVariance, parseBudgetLines, parseCsv, recordsWithinBudgetDates, type BudgetCategory, type BudgetLine, type BudgetLineType, type BudgetPeriod } from "@/lib/budget-utils";
import { calculatePayroll, payrollCsvFields, serializePayroll, type PayrollValues, type SalaryTaxRule } from "@/lib/payroll-utils";
import { packFor } from "@/lib/tax-packs";
import { MAX_ITEM_IMPORT_ROWS, type ItemImportData, type ItemImportRow } from "@/lib/item-import";
import { MAX_INVENTORY_COUNT_ROWS, type InventoryCountRow } from "@/lib/inventory-import";

const convertTargets: Partial<Record<RecordKind, RecordKind>> = {
  estimates: "invoices",
  "sales-orders": "invoices",
  "purchase-orders": "bills",
};
/** Other targets a record can be converted to on request, besides its default. */
const optionalConvertTargets: Partial<Record<RecordKind, RecordKind[]>> = {
  "sales-orders": ["estimates"],
  estimates: ["sales-orders"],
};

export async function updateProfileName(input: string): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const me = await requireUser();
  const name = input.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, message: "Enter a name between 2 and 80 characters." };
  }

  await db
    .update(user)
    .set({ name, updatedAt: new Date() })
    .where(eq(user.id, me.actorId));
  revalidatePath("/app", "layout");
  return { ok: true, name };
}

export async function exportMyAccountData() {
  const me = await requireUser();
  const records = await db
    .select({ id: bookkeepingRecord.id, kind: bookkeepingRecord.kind, data: bookkeepingRecord.data, createdAt: bookkeepingRecord.createdAt, updatedAt: bookkeepingRecord.updatedAt })
    .from(bookkeepingRecord)
    .where(eq(bookkeepingRecord.userId, me.id))
    .orderBy(desc(bookkeepingRecord.updatedAt));
  // A team member exports only their own profile; the business's records are the owner's to export.
  const exportable = me.role === "Admin" ? records : [];

  return {
    exportedAt: new Date().toISOString(),
    account: { name: me.name, email: me.email },
    records: exportable.map((record) => ({
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
  };
}

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
  if (entries.length > 60) throw new ActionError("This record has too many fields.");

  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof value !== "string") {
        throw new ActionError("One of the values needs to be checked.");
      }
      return [key, value.trim().slice(0, key === "emailTemplate" ? 12000 : key === "lines" || key === "lineItems" ? 30000 : 4000)];
    }),
  );
}

function amountFromLineItems(data: Record<string, string>, kind: string): Record<string, string> {
  const categoryLines = kind === "expenses" || kind === "bills" || kind === "supplier-credits";
  if (categoryLines && !data.lineItems?.trim()) throw new ActionError(`Add at least one ${kind === "bills" ? "bill" : kind === "supplier-credits" ? "credit" : "expense"} line with a category and amount.`);
  if (!data.lineItems?.trim()) return data;

  const lines = parseInvoiceLines(data.lineItems);
  if (lines.length === 0 || lines.some((line) => {
    const quantity = Number(line.quantity);
    const rate = Number(line.rate);
    return !line.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < (categoryLines ? Number.EPSILON : 0);
  })) {
    throw new ActionError(categoryLines ? "Each line needs a category and an amount greater than zero." : "Check that each item has a name, quantity, and non-negative rate.");
  }

  const subtotal = lines.reduce((total, line) => total + Number(line.quantity) * Number(line.rate), 0);
  const taxRate = Math.max(0, Number(data.taxRate) || 0);
  const discount = Math.max(0, Number(data.discount) || 0);
  if (taxRate > 100) throw new ActionError("Tax rate can’t be greater than 100%.");
  if (Number(data.taxRate) < 0 || Number(data.discount) < 0) throw new ActionError("Tax and discount values can’t be negative.");
  const taxAmount = subtotal * (taxRate / 100);

  return {
    ...data,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    amount: Math.max(0, subtotal + taxAmount - discount).toFixed(2),
  };
}

/** The salary tax rule of the business's country (Tax setup); Pakistan slabs until a country is chosen. */
async function salaryTaxRule(userId: string): Promise<SalaryTaxRule> {
  const [settings] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  return packFor(settings?.data.taxCountry)?.payroll.incomeTax ?? "pakistan-slabs";
}

function normalizePayrollData(data: Record<string, string>, taxRule: SalaryTaxRule = "pakistan-slabs"): Record<string, string> {
  const values: PayrollValues = {
    reference: (data.reference || "").slice(0, 60),
    employeeId: data.employeeId || "",
    employeeName: data.employeeName || "",
    employeeEmail: data.employeeEmail || "",
    cnic: data.cnic || "",
    designation: data.designation || "",
    joiningDate: data.joiningDate || "",
    month: data.month || "",
    paymentAccountId: data.paymentAccountId || "",
    paymentAccountName: data.paymentAccountName || "",
    paymentMethod: data.paymentMethod || "",
    baseSalary: data.baseSalary || "",
    increment: data.increment || "0",
    workingDays: data.workingDays || "",
    workedDays: data.workedDays || "",
    incentive: data.incentive || "0",
    overtimeAllowance: data.overtimeAllowance || "0",
    gymAllowance: data.gymAllowance || "0",
    medicalAllowance: data.medicalAllowance || "0",
    otherAllowance: data.otherAllowance || "0",
    taxDeduction: data.taxDeduction || "",
    advanceDeduction: data.advanceDeduction || "0",
    loanDeduction: data.loanDeduction || "0",
    fineDeduction: data.fineDeduction || "0",
    adjustment: data.adjustment || "0",
    description: data.description || "",
  };

  if (!values.employeeId || !values.employeeName || !values.cnic || !values.designation || !values.baseSalary) {
    throw new ActionError("Enter the employee ID, name, CNIC, designation, and base salary.");
  }
  if (!/^\d{5}-?\d{7}-?\d$/.test(values.cnic)) throw new ActionError("Enter a valid 13-digit CNIC.");
  if (values.employeeEmail && (values.employeeEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.employeeEmail))) {
    throw new ActionError("Enter a valid employee email address.");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)) throw new ActionError("Choose a valid payroll month.");
  if (values.joiningDate) {
    const joiningDate = new Date(`${values.joiningDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.joiningDate) || !Number.isFinite(joiningDate.getTime()) || joiningDate.toISOString().slice(0, 10) !== values.joiningDate) {
      throw new ActionError("Choose a valid employee joining date.");
    }
  }

  const numericFields: (keyof PayrollValues)[] = [
    "baseSalary", "increment", "workingDays", "workedDays", "incentive", "overtimeAllowance", "gymAllowance",
    "medicalAllowance", "otherAllowance", "taxDeduction", "advanceDeduction", "loanDeduction", "fineDeduction", "adjustment",
  ];
  for (const key of numericFields) {
    const value = values[key].trim();
    if (!value) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) throw new ActionError("Enter valid salary amounts and working days.");
    if (key !== "adjustment" && number < 0) throw new ActionError("Salary, allowances, days, tax, and deductions can’t be negative.");
  }

  const workingDays = Number(values.workingDays);
  const workedDays = Number(values.workedDays);
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) throw new ActionError("Total working days must be from 1 to 31.");
  if (!Number.isInteger(workedDays) || workedDays < 0 || workedDays > workingDays) throw new ActionError("Worked days can’t exceed total working days.");
  if (calculatePayroll(values, taxRule).payableSalary < 0) throw new ActionError("Deductions exceed the gross salary. Adjust the deductions or adjustment.");

  return serializePayroll(values, taxRule);
}

export async function listBookkeepingRecords(kind: string): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  assertCanRead(me, kind);
  if (!isRecordKind(kind)) throw new ActionError("That section isn’t available.");

  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  return rows.map(serializeRow);
}

export async function listBookkeepingRecordGroups(
  kinds: string[],
): Promise<Partial<Record<RecordKind, BookkeepingRecord[]>>> {
  const uniqueKinds = [...new Set(kinds)];
  if (uniqueKinds.some((kind) => !isRecordKind(kind))) throw new ActionError("That section isn’t available.");
  if (!uniqueKinds.length) return {};

  const me = await requireUser();
  // Kinds this role can't open come back empty, so a page still renders what it may show.
  const readable = uniqueKinds.filter((kind) => canReadKind(me.role, kind));
  if (!readable.length) return {};
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, readable)))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  return rows.reduce<Partial<Record<RecordKind, BookkeepingRecord[]>>>((groups, row) => {
    const kind = row.kind as RecordKind;
    (groups[kind] ??= []).push(serializeRow(row));
    return groups;
  }, {});
}

export async function listAllBookkeepingRecords(): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(eq(bookkeepingRecord.userId, me.id))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  return rows.filter((row) => canReadKind(me.role, row.kind)).map(serializeRow);
}

export async function saveBookkeepingRecord(
  kind: string,
  input: Record<string, string>,
  id?: string,
): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (!isRecordKind(kind)) throw new ActionError("That section isn’t available.");
  if (kind === "reconciliations") throw new ActionError("Completed reconciliations can only be created from the reconciliation screen.");
  if (kind === "team-members") throw new ActionError("Add and change team members from Users & roles.");
  let data = amountFromLineItems(sanitizePayload(input), kind);
  if (kind === "purchase-orders" && !id) data = { ...data, status: "Draft" };
  if (kind === "payroll") {
    data = normalizePayrollData(data, await salaryTaxRule(me.id));
    if (data.paymentAccountId) {
      const [paymentAccount] = await db
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"), eq(bookkeepingRecord.id, data.paymentAccountId)))
        .limit(1);
      const accountType = paymentAccount ? paymentAccountType({ kind: "accounts", data: paymentAccount.data }) : null;
      if (!paymentAccount || !accountType) throw new ActionError("Choose an available Cash, Bank, or Credit card account from Chart of Accounts.");
      data = {
        ...data,
        paymentAccountId: paymentAccount.id,
        paymentAccountName: paymentAccount.data.name || paymentAccount.data.code || "Account",
        paymentMethod: accountType,
      };
    } else {
      data = { ...data, paymentAccountName: "", paymentMethod: "" };
    }
    const payrollRows = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")));
    if (id && !payrollRows.some((row) => row.id === id)) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
    const duplicate = payrollRows.some((row) =>
      row.id !== id &&
      row.data.month === data.month &&
      row.data.employeeId?.toLowerCase() === data.employeeId.toLowerCase(),
    );
    if (duplicate) throw new ActionError("That employee already has a payroll entry for this month.");
    // Editing a paid salary keeps its payment; Undo payment is how it becomes unpaid again.
    const existing = id ? payrollRows.find((row) => row.id === id) : undefined;
    if (existing?.data.status === "Paid") {
      data = {
        ...data,
        status: "Paid",
        paidDate: existing.data.paidDate || "",
        paymentAccountId: existing.data.paymentAccountId || "",
        paymentAccountName: existing.data.paymentAccountName || "",
        paymentMethod: existing.data.paymentMethod || "",
      };
    }
  }
  if (kind === "invoices") {
    const paymentTerms = data.paymentTerms || "30 days";
    if (!["Due on receipt", "15 days", "30 days", "60 days"].includes(paymentTerms)) throw new ActionError("Choose one of the available payment terms.");
    const calculatedDueDate = dueDateForTerms(data.issueDate ?? "", paymentTerms);
    if (!calculatedDueDate) throw new ActionError("Choose an issue date and valid payment terms.");
    data = { ...data, paymentTerms, dueDate: calculatedDueDate };
  }
  if (!id && (kind === "bills" || kind === "supplier-credits") && !data.status) data = { ...data, status: "Open" };
  if (!id && (kind === "invoices" || kind === "bills")) {
    const selectedAccountId = data.paymentMethod || "Credit";
    let paymentMethod = "Credit";
    if (selectedAccountId !== "Credit") {
      const [paymentAccount] = await db
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"), eq(bookkeepingRecord.id, selectedAccountId)))
        .limit(1);
      const accountType = paymentAccount ? paymentAccountType({ kind: "accounts", data: paymentAccount.data }) : null;
      if (!paymentAccount || !accountType) throw new ActionError("Choose a Cash, Bank, or Credit card account from Chart of Accounts.");
      paymentMethod = accountType;
      data = { ...data, paymentAccountId: paymentAccount.id, paymentAccountName: paymentAccount.data.name || paymentAccount.data.code || "Account" };
    } else {
      data = { ...data, paymentAccountId: "", paymentAccountName: "" };
    }
    data = { ...data, paymentMethod };
    if (paymentMethod !== "Credit") {
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Enter an amount greater than zero for a paid transaction.");
      data = { ...data, paidAmount: amount.toFixed(2), status: "Paid" };
    }
  }
  if (kind === "accounts") {
    const accountRows = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
    const existing = id ? accountRows.find((account) => account.id === id) : undefined;
    if (id && !existing) throw new ActionError("We couldn’t find that account. Refresh and try again.");

    if (existing?.data.locked === "true") {
      if (data.locked !== "false") throw new ActionError("This account is locked. Unlock it before changing its details.");
      data = { ...existing.data, locked: "false" };
    } else {
      const allowedFields = new Set(["code", "name", "type", "accountType", "detailType", "subAccount", "parentAccount", "openingBalance", "openingBalanceDate", "description", "locked"]);
      data = Object.fromEntries(Object.entries(data).filter(([key]) => allowedFields.has(key)));
      const category = accountCategoryForType(data.accountType ?? "");
      if (!data.name?.trim()) throw new ActionError("Enter an account name.");
      if (!category) throw new ActionError("Choose an account type.");
      if (!accountDetailsForType(data.accountType ?? "").some((detailType) => detailType === data.detailType)) {
        throw new ActionError("Choose a detail type that matches this account type.");
      }
      data.name = data.name.trim();
      data.code = data.code?.trim() ?? "";
      data.type = category;
      if (!data.openingBalance) data.openingBalanceDate = "";
      if (data.openingBalance && !Number.isFinite(Number(data.openingBalance))) throw new ActionError("Enter a valid opening balance.");
      if (data.openingBalance && !data.openingBalanceDate) throw new ActionError("Choose an opening balance date.");
      if (data.openingBalanceDate) {
        const parsedOpeningDate = new Date(`${data.openingBalanceDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.openingBalanceDate) || Number.isNaN(parsedOpeningDate.getTime()) || parsedOpeningDate.toISOString().slice(0, 10) !== data.openingBalanceDate) {
          throw new ActionError("Choose a valid opening balance date.");
        }
      }
      if (data.code && accountRows.some((account) => account.id !== id && account.data.code?.trim().toLowerCase() === data.code.toLowerCase())) {
        throw new ActionError("That account number is already in use.");
      }
      if (data.subAccount === "true") {
        const parent = accountRows.find((account) => account.id === data.parentAccount);
        if (!parent || parent.id === id) throw new ActionError("Choose a valid parent account.");
        if (parent.data.type !== category || parent.data.subAccount === "true") throw new ActionError("Choose a parent account with the same account type.");
      } else {
        data.parentAccount = "";
      }
      data.locked = data.locked === "true" ? "true" : "false";
    }
  }
  if (["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices", "purchase-orders"].includes(kind) && !data.lineItems?.trim()) {
    throw new ActionError("Add at least one item or service before saving.");
  }
  if (kind === "journals" && data.lines) {
    if (!data.date || !data.reference) throw new ActionError("Enter the journal date and number.");

    let submittedLines: unknown;
    try {
      submittedLines = JSON.parse(data.lines);
    } catch {
      throw new ActionError("Check the journal lines and try again.");
    }
    if (!Array.isArray(submittedLines) || submittedLines.length > 50) throw new ActionError("A journal can include up to 50 lines.");

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
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ActionError(`Check journal line ${index + 1}.`);
      const line = entry as Record<string, unknown>;
      const accountId = typeof line.accountId === "string" ? line.accountId.trim() : "";
      const debitText = typeof line.debit === "string" ? line.debit.trim() : "";
      const creditText = typeof line.credit === "string" ? line.credit.trim() : "";
      const description = typeof line.description === "string" ? line.description.trim().slice(0, 300) : "";
      const name = typeof line.name === "string" ? line.name.trim().slice(0, 160) : "";
      if (!accountId && !debitText && !creditText && !description && !name) continue;
      if (!accountId) throw new ActionError(`Choose a chart account for journal line ${index + 1}.`);

      const account = accountsById.get(accountId);
      if (!account) throw new ActionError(`The account on journal line ${index + 1} is no longer available.`);

      const debit = Number(debitText || 0);
      const credit = Number(creditText || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new ActionError(`Journal line ${index + 1} must use non-negative amounts.`);
      }
      const debitCents = Math.round(debit * 100);
      const creditCents = Math.round(credit * 100);
      if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents)) throw new ActionError("Journal amounts are too large.");
      if (debitCents === 0 && creditCents === 0) throw new ActionError(`Enter a debit or credit for journal line ${index + 1}.`);
      if (debitCents > 0 && creditCents > 0) throw new ActionError(`Use either debit or credit on journal line ${index + 1}, not both.`);

      const accountName = account.data.name || account.data.code || "Account";
      const accountCode = account.data.code || "";
      journalLines.push({
        accountId,
        account: accountName,
        accountCode,
        debit: debitCents ? (debitCents / 100).toFixed(2) : "",
        credit: creditCents ? (creditCents / 100).toFixed(2) : "",
        description,
        name,
      });
      debitTotalCents += debitCents;
      creditTotalCents += creditCents;
    }

    if (journalLines.length < 2) throw new ActionError("Add at least two journal lines.");
    if (debitTotalCents === 0 || debitTotalCents !== creditTotalCents) throw new ActionError("Total debits and credits must match.");

    const firstDebit = journalLines.find((line) => Number(line.debit) > 0);
    const firstCredit = journalLines.find((line) => Number(line.credit) > 0);
    data = {
      ...data,
      lines: JSON.stringify(journalLines),
      debitAccount: firstDebit?.account ?? "",
      creditAccount: firstCredit?.account ?? "",
      amount: (debitTotalCents / 100).toFixed(2),
      memo: data.memo || journalLines.map((line) => line.description).filter(Boolean).join(" · ").slice(0, 4000),
    };
  } else if (kind === "journals") {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Journal amounts must be greater than zero.");
    if (data.debitAccount && data.debitAccount === data.creditAccount) throw new ActionError("Choose different debit and credit accounts.");
  }

  if (id && kind === "transactions") {
    const [existing] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
      .limit(1);
    if (existing?.data.reconciled === "true") throw new ActionError("This transaction is part of a completed reconciliation and can’t be edited.");
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
    if (kind === "purchase-orders") {
      const updated = await db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
          .for("update")
          .limit(1);
        if (!existing) throw new ActionError("We couldn’t find that purchase order. Refresh and try again.");
        const status = existing.data.status === "Sent" ? "RFQ Sent" : existing.data.status || "Draft";
        const [saved] = await transaction
          .update(bookkeepingRecord)
          .set({ data: { ...existing.data, ...data, status }, updatedAt: new Date() })
          .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
          .returning();
        return saved;
      });
      revalidatePath("/app", "layout");
      return serializeRow(updated);
    }

    let updatedData = data;
    if (kind === "invoices") {
      const [existing] = await db
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")))
        .limit(1);
      if (!existing) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");
      updatedData = { ...existing.data, ...data };
      if (!data.shareToken && existing.data.shareToken) updatedData.shareToken = existing.data.shareToken;
    }
    const [updated] = await db
      .update(bookkeepingRecord)
      .set({ data: updatedData, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
      .returning();
    if (!updated) throw new ActionError("We couldn’t find that record. Refresh and try again.");
    revalidatePath("/app", "layout");
    return serializeRow(updated);
  }

  const [created] = await db
    .insert(bookkeepingRecord)
    .values({ userId: me.id, kind, data })
    .returning();
  if (kind === "invoices" && data.paymentMethod && data.paymentMethod !== "Credit") {
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "payments",
      data: {
        invoiceId: created.id,
        invoiceNumber: data.invoiceNumber ?? "Invoice",
        customer: data.customer ?? "",
        amount: data.amount ?? "0",
        paymentDate: data.issueDate || new Date().toISOString().slice(0, 10),
        method: data.paymentMethod,
        paymentAccountId: data.paymentAccountId ?? "",
        paymentAccountName: data.paymentAccountName ?? "",
      },
    });
  }
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

export async function importBookkeepingItems(input: ItemImportRow[]): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  assertCanWrite(me, "items");
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ITEM_IMPORT_ROWS) {
    throw new ActionError(`Choose between 1 and ${MAX_ITEM_IMPORT_ROWS} item rows to import.`);
  }

  const rows: ItemImportRow[] = [];
  const uploadedSkus = new Set<string>();
  const numericFields: (keyof Pick<ItemImportData, "rate" | "taxRate" | "cost" | "reorderPoint">)[] = ["rate", "taxRate", "cost", "reorderPoint"];

  for (const [index, entry] of input.entries()) {
    if (!entry || typeof entry !== "object" || !Number.isInteger(entry.rowNumber) || entry.rowNumber < 2 || !entry.data || typeof entry.data !== "object") {
      throw new ActionError(`Check the item details on import row ${index + 2}.`);
    }

    const data = {} as ItemImportData;
    for (const key of ["name", "sku", "itemType", "rate", "unit", "taxRate", "cost", "reorderPoint"] as const) {
      const value = entry.data[key];
      if (typeof value !== "string") throw new ActionError(`Check ${key} on spreadsheet row ${entry.rowNumber}.`);
      data[key] = value.trim();
      if (data[key].length > 250) throw new ActionError(`${key} is too long on spreadsheet row ${entry.rowNumber}.`);
    }

    data.itemType = data.itemType || "Product";
    if (!data.name) throw new ActionError(`Add a name on spreadsheet row ${entry.rowNumber}.`);
    if (!["Product", "Service"].includes(data.itemType)) throw new ActionError(`Choose Product or Service on spreadsheet row ${entry.rowNumber}.`);
    for (const key of numericFields) {
      const value = data[key];
      if (!value && key !== "rate") continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
        throw new ActionError(`Enter a valid non-negative ${key === "rate" ? "rate" : key === "taxRate" ? "tax rate" : key === "cost" ? "unit cost" : "reorder point"} on spreadsheet row ${entry.rowNumber}.`);
      }
    }

    const skuKey = data.sku.toLocaleLowerCase();
    if (skuKey && uploadedSkus.has(skuKey)) throw new ActionError(`The SKU ${data.sku} appears more than once in the spreadsheet.`);
    if (skuKey) uploadedSkus.add(skuKey);
    rows.push({ rowNumber: entry.rowNumber, data });
  }

  const created = await db.transaction(async (transaction) => {
    if (uploadedSkus.size > 0) {
      const existingItems = await transaction
        .select({ data: bookkeepingRecord.data })
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items")));
      const existingSkus = new Set(existingItems.map((item) => item.data.sku?.trim().toLocaleLowerCase()).filter(Boolean));
      const duplicate = rows.find((row) => row.data.sku && existingSkus.has(row.data.sku.toLocaleLowerCase()));
      if (duplicate) throw new ActionError(`SKU ${duplicate.data.sku} on spreadsheet row ${duplicate.rowNumber} already exists in Items & services.`);
    }

    const saved = await transaction
      .insert(bookkeepingRecord)
      .values(rows.map((row) => ({ userId: me.id, kind: "items", data: sanitizePayload({ ...row.data }) })))
      .returning();
    return saved.map(serializeRow);
  });

  revalidatePath("/app", "layout");
  return created;
}

/**
 * Adds the standard small-business chart of accounts. Accounts whose name or
 * number is already in use are skipped, so this is safe to run more than once.
 */
export async function addStandardAccounts(): Promise<{ added: number; records: BookkeepingRecord[] }> {
  const me = await requireUser();
  assertCanWrite(me, "accounts");

  return db.transaction(async (transaction) => {
    const existing = await transaction
      .select({ data: bookkeepingRecord.data })
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
    const usedNames = new Set(existing.map((account) => account.data.name?.trim().toLowerCase()).filter(Boolean));
    const usedCodes = new Set(existing.map((account) => account.data.code?.trim().toLowerCase()).filter(Boolean));

    const missing = standardAccounts.filter((account) => !usedNames.has(account.name.toLowerCase()) && !usedCodes.has(account.code.toLowerCase()));
    if (!missing.length) return { added: 0, records: [] };

    const rows = missing.map((account) => {
      const category = accountCategoryForType(account.accountType);
      if (!category || !accountDetailsForType(account.accountType).some((detailType) => detailType === account.detailType)) {
        throw new ActionError(`The standard account ${account.name} has an invalid type.`);
      }
      return {
        userId: me.id,
        kind: "accounts",
        data: sanitizePayload({ code: account.code, name: account.name, type: category, accountType: account.accountType, detailType: account.detailType }),
      };
    });
    const saved = await transaction.insert(bookkeepingRecord).values(rows).returning();
    revalidatePath("/app", "layout");
    return { added: saved.length, records: saved.map(serializeRow) };
  });
}

function isBudgetDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function saveBudgetPlan(input: unknown, id?: string): Promise<BookkeepingRecord> {
  assertCanWrite(await requireUser(), "budgets");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ActionError("Check the budget details and try again.");
  const form = input as Record<string, unknown>;
  const name = typeof form.name === "string" ? form.name.trim().slice(0, 100) : "";
  const description = typeof form.description === "string" ? form.description.trim().slice(0, 1000) : "";
  const period = form.period;
  const startDate = form.startDate;
  const endDate = form.endDate;
  const currency = typeof form.currency === "string" ? form.currency.trim().slice(0, 3).toUpperCase() : "USD";
  if (!name) throw new ActionError("Give this budget a name.");
  if (!(period === "Monthly" || period === "Quarterly" || period === "Annual" || period === "Custom")) throw new ActionError("Choose a budget period.");
  if (!isBudgetDate(startDate) || !isBudgetDate(endDate) || startDate > endDate) throw new ActionError("Choose a valid start and end date.");
  if (!/^[A-Z]{3}$/.test(currency)) throw new ActionError("Choose a valid currency.");
  if (!Array.isArray(form.lines) || form.lines.length < 1 || form.lines.length > 50) throw new ActionError("Add between 1 and 50 budget lines.");

  const lines: BudgetLine[] = form.lines.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ActionError(`Check budget line ${index + 1}.`);
    const line = value as Record<string, unknown>;
    const legacyBudgetHead = typeof line.category === "string" && line.category !== "Sales" && line.category !== "Expenses" && line.category !== "Payroll" ? line.category.trim().slice(0, 120) : "";
    const budgetHead = typeof line.budgetHead === "string" ? line.budgetHead.trim().slice(0, 120) : legacyBudgetHead;
    const descriptionText = typeof line.description === "string" ? line.description.trim().slice(0, 300) : "";
    const suppliedType: BudgetLineType = line.type === "Income" ? "Income" : line.type === "Expense" ? "Expense" : (() => { throw new ActionError(`Choose income or expense for line ${index + 1}.`); })();
    const category: BudgetCategory = line.category === "Sales" || line.category === "Expenses" || line.category === "Payroll"
      ? line.category
      : line.category === undefined || (typeof line.category === "string" && line.category !== "Sales" && line.category !== "Expenses" && line.category !== "Payroll")
        ? suppliedType === "Income" ? "Sales" : "Expenses"
        : (() => { throw new ActionError(`Choose Sales or Expenses for line ${index + 1}.`); })();
    const type: BudgetLineType = category === "Sales" ? "Income" : "Expense";
    const amount = typeof line.expected === "string" || typeof line.expected === "number" ? Number(line.expected) : Number.NaN;
    if (!budgetHead) throw new ActionError(`Choose a budget head for line ${index + 1}.`);
    if (category === "Payroll" && !payrollBudgetHead(budgetHead)) throw new ActionError(`Choose one of the payroll heads for line ${index + 1}.`);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) throw new ActionError(`Enter a valid expected amount for line ${index + 1}.`);
    return { category, budgetHead, type, expected: (Math.round(amount * 100) / 100).toFixed(2), description: descriptionText };
  });

  return saveBookkeepingRecord("budgets", {
    name,
    period: period as BudgetPeriod,
    startDate,
    endDate,
    currency,
    description,
    lines: JSON.stringify(lines),
  }, id);
}

export async function importPayrollCsv(input: string): Promise<{ created: number; updated: number; records: BookkeepingRecord[] }> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  const taxRule = await salaryTaxRule(me.id);
  if (input.length > 2_000_000) throw new ActionError("The payroll CSV is too large. Keep it under 2 MB.");
  const [rawHeaders, ...rows] = parseCsv(input);
  if (!rawHeaders || !rows.length) throw new ActionError("The payroll CSV needs a header row and at least one employee.");
  if (rows.length > 500) throw new ActionError("Import up to 500 payroll rows at a time.");

  const headerIndexes = new Map(rawHeaders.map((header, index) => [header.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""), index]));
  const requiredFields: (keyof PayrollValues)[] = ["employeeId", "employeeName", "cnic", "designation", "month", "baseSalary", "workingDays", "workedDays"];
  const missingFields = requiredFields.filter((fieldName) => !headerIndexes.has(fieldName.toLowerCase()));
  if (missingFields.length) throw new ActionError(`The payroll CSV is missing these columns: ${missingFields.join(", ")}.`);

  const imported = rows.map((row, index) => {
    const payload: Record<string, string> = {};
    for (const fieldName of payrollCsvFields) {
      const columnIndex = headerIndexes.get(fieldName.toLowerCase());
      if (columnIndex !== undefined) payload[fieldName] = row[columnIndex] ?? "";
    }
    try {
      return normalizePayrollData(payload, taxRule);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check this row’s payroll details.";
      throw new ActionError(`CSV row ${index + 2}: ${message}`);
    }
  });

  const accountRows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
  for (const [index, data] of imported.entries()) {
    if (!data.paymentAccountName && !data.paymentMethod) continue;
    if (!data.paymentAccountName) throw new ActionError(`CSV row ${index + 2}: add the payment account name, not just its type.`);
    const accountName = data.paymentAccountName.trim().toLowerCase();
    const matches = accountRows.filter((account) =>
      [account.data.name, account.data.code].some((value) => value?.trim().toLowerCase() === accountName),
    );
    if (matches.length !== 1) throw new ActionError(`CSV row ${index + 2}: the payment account must match one account in Chart of Accounts.`);
    const paymentAccount = matches[0];
    const accountType = paymentAccountType({ kind: "accounts", data: paymentAccount.data });
    if (!accountType || (data.paymentMethod && data.paymentMethod !== accountType)) {
      throw new ActionError(`CSV row ${index + 2}: choose a matching Cash, Bank, or Credit card account.`);
    }
    data.paymentAccountId = paymentAccount.id;
    data.paymentAccountName = paymentAccount.data.name || paymentAccount.data.code || "Account";
    data.paymentMethod = accountType;
  }

  const seenEmployees = new Set<string>();
  for (const data of imported) {
    const key = `${data.month}:${data.employeeId.toLowerCase()}`;
    if (seenEmployees.has(key)) throw new ActionError(`The payroll CSV repeats employee ${data.employeeId} for ${data.month}.`);
    seenEmployees.add(key);
  }

  const payrollRows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")));
  let created = 0;
  let updated = 0;

  for (let data of imported) {
    const existing = payrollRows.find((row) =>
      row.data.month === data.month && row.data.employeeId?.toLowerCase() === data.employeeId.toLowerCase(),
    );
    if (existing) {
      // A re-imported salary that was already paid keeps its payment.
      if (existing.data.status === "Paid") {
        data = { ...data, status: "Paid", paidDate: existing.data.paidDate || "", paymentAccountId: existing.data.paymentAccountId || "", paymentAccountName: existing.data.paymentAccountName || "", paymentMethod: existing.data.paymentMethod || "" };
      }
      await db
        .update(bookkeepingRecord)
        .set({ data, updatedAt: new Date() })
        .where(and(eq(bookkeepingRecord.id, existing.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")));
      existing.data = data;
      updated += 1;
    } else {
      const [record] = await db
        .insert(bookkeepingRecord)
        .values({ userId: me.id, kind: "payroll", data })
        .returning();
      payrollRows.push(record);
      created += 1;
    }
  }

  revalidatePath("/app", "layout");
  const savedRows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .orderBy(desc(bookkeepingRecord.updatedAt));
  return { created, updated, records: savedRows.map(serializeRow) };
}

export async function sendPayrollSlip(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  const [record] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .limit(1);
  if (!record) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
  const data = record.data;
  const recipient = data.employeeEmail?.trim().toLowerCase();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new ActionError("Add a valid employee email in the payroll details before sending the salary slip.");
  }

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });
  const formatAmount = (value: string | undefined) => `PKR ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subject = `Salary slip · ${data.month || "Payroll"}`;
  const salaryLines = [
    ["Employee", data.employeeName || "Employee"],
    ["Employee ID", data.employeeId || "—"],
    ["Pay period", data.month || "—"],
    ["Payment account", data.paymentAccountName ? `${data.paymentMethod || "Account"} · ${data.paymentAccountName}` : "Not set"],
    ["Base salary", formatAmount(data.baseSalary)],
    ["After increment", formatAmount(data.afterIncrement)],
    ["Gross salary", formatAmount(data.grossSalary)],
    ["Income tax", formatAmount(data.taxDeduction)],
    ["Other deductions", formatAmount(String(Math.max(0, Number(data.totalDeductions || 0) - Number(data.taxDeduction || 0))))],
    ["Final payable", formatAmount(data.payableSalary)],
  ];
  const tableRows = salaryLines.map(([label, value]) => `<tr><th align="left" style="padding:10px;border-bottom:1px solid #d8e2ea">${escapeHtml(label)}</th><td align="right" style="padding:10px;border-bottom:1px solid #d8e2ea">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#1d2c3b;max-width:640px;margin:0 auto"><h1>Salary slip</h1><p>${escapeHtml(data.designation || "")} · ${escapeHtml(data.month || "")}</p><table style="width:100%;border-collapse:collapse"><tbody>${tableRows}</tbody></table>${data.description ? `<p>Note: ${escapeHtml(data.description)}</p>` : ""}</div>`;
  await sendEmailOrThrow({ to: recipient, subject, html, fromName: "MIKLEDGER" });
}

function escapeBudgetHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export async function sendBudgetSummary(id: string, recipient: string): Promise<void> {
  const me = await requireUser();
  assertCanRead(me, "budgets");
  const email = recipient.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("Enter a valid recipient email address.");
  const [budgetRow] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "budgets")))
    .limit(1);
  if (!budgetRow) throw new ActionError("That budget wasn’t found. Save it and try again.");

  const budget = serializeRow(budgetRow);
  const sourceRows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["invoices", "bills", "expenses", "payroll", "settings"])));
  const records = sourceRows.map(serializeRow);
  const budgetData = recordsWithinBudgetDates(records, budget.data.startDate ?? "", budget.data.endDate ?? "");
  const lines = parseBudgetLines(budget.data.lines);
  const currency = budget.data.currency || records.find((record) => record.kind === "settings")?.data.currency || "USD";
  const formatAmount = (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };
  const rows = lines.map((line) => {
    const actual = budgetActual(line, budgetData);
    const variance = budgetVariance(line, actual);
    return `<tr><td>${escapeBudgetHtml(line.category)}</td><td>${escapeBudgetHtml(line.budgetHead)}</td><td>${formatAmount(Number(line.expected) || 0)}</td><td>${formatAmount(actual)}</td><td>${formatAmount(variance)}</td><td>${escapeBudgetHtml(line.description)}</td></tr>`;
  }).join("");
  const subject = `Budget: ${budget.data.name || "Budget"}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#13263b;max-width:900px;margin:0 auto"><h1>${escapeBudgetHtml(subject)}</h1><p>${escapeBudgetHtml(budget.data.period || "Custom")} · ${escapeBudgetHtml(budget.data.startDate || "")} to ${escapeBudgetHtml(budget.data.endDate || "")}</p><p>${escapeBudgetHtml(budget.data.description || "Budget overview")}</p><p>Positive variance means favorable: under plan for expenses or above plan for income.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Category</th><th align="left">Budget Head</th><th align="right">Expected</th><th align="right">Actual</th><th align="right">Variance</th><th align="left">Description</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th align="left" colspan="2">Totals</th><th align="right">${formatAmount(budgetExpectedTotal(lines))}</th><th align="right">${formatAmount(lines.reduce((sum, line) => sum + budgetActual(line, budgetData), 0))}</th><th align="right">${formatAmount(lines.reduce((sum, line) => sum + budgetVariance(line, budgetActual(line, budgetData)), 0))}</th><td></td></tr></tfoot></table></div>`;
  await sendEmailOrThrow({ to: email, subject, html, fromName: "MIKLEDGER" });
}

export async function deleteBookkeepingRecord(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (!isRecordKind(kind)) throw new ActionError("That section isn’t available.");
  if (kind === "reconciliations") throw new ActionError("Completed reconciliations can’t be deleted.");
  if (kind === "team-members") throw new ActionError("Remove team members from Users & roles.");
  if (kind === "bills" || kind === "expenses") {
    await db.transaction(async (transaction) => {
      const [record] = await transaction
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
        .for("update")
        .limit(1);
      if (!record) throw new ActionError("We couldn’t find that record. Refresh and try again.");

      if (record.data.sourcePurchaseOrderId) {
        const [order] = await transaction
          .select()
          .from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.id, record.data.sourcePurchaseOrderId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")))
          .for("update")
          .limit(1);
        if (order?.data.convertedRecordId === record.id) {
          const { convertedKind: _convertedKind, convertedRecordId: _convertedRecordId, convertedAt: _convertedAt, ...orderData } = order.data;
          await transaction.update(bookkeepingRecord)
            .set({ data: orderData, updatedAt: new Date() })
            .where(and(eq(bookkeepingRecord.id, order.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
        }
      }

      await transaction.delete(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, record.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)));
      // A deleted bill takes its payments with it, so they don't linger in banking and reports.
      if (kind === "bills") {
        await transaction.delete(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'billId' = ${record.id}`));
      }
    });
    revalidatePath("/app", "layout");
    return;
  }
  if (kind === "accounts") {
    const [existing] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
      .limit(1);
    if (!existing) throw new ActionError("We couldn’t find that account. Refresh and try again.");
    if (existing.data.locked === "true") throw new ActionError("Unlock this account before deleting it.");

    const journals = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "journals")));
    const isReferenced = journals.some((journal) => {
      try {
        const lines: unknown = JSON.parse(journal.data.lines || "[]");
        return Array.isArray(lines) && lines.some((line: unknown) => {
          if (!line || typeof line !== "object") return false;
          return (line as Record<string, unknown>).accountId === id;
        });
      } catch {
        return false;
      }
    });
    if (isReferenced) throw new ActionError("This account is used by a journal entry and can’t be deleted.");
  }
  if (kind === "transactions") {
    const [existing] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
      .limit(1);
    if (existing?.data.reconciled === "true") throw new ActionError("This transaction is part of a completed reconciliation and can’t be deleted.");
  }
  const [deleted] = await db
    .delete(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .returning({ id: bookkeepingRecord.id });
  if (!deleted) throw new ActionError("We couldn’t find that record. Refresh and try again.");
  // A deleted invoice takes its payments with it, so they don't linger in banking and reports.
  if (kind === "invoices") {
    await db.delete(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'invoiceId' = ${id}`));
  }
  revalidatePath("/app", "layout");
}

export async function recordInvoicePayment(
  id: string,
  amountInput: string,
  paymentDate: string,
  accountId: string,
): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Enter a payment amount greater than zero.");

  const [paymentAccount] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, accountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")))
    .limit(1);
  const method = paymentAccount ? paymentAccountType({ kind: "accounts", data: paymentAccount.data }) : null;
  if (!paymentAccount || !method) throw new ActionError("Choose a Cash, Bank, or Credit card account from Chart of Accounts.");

  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")))
    .limit(1);
  if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");

  const data = invoice.data;
  const total = Number(data.amount) || 0;
  const paid = Number(data.paidAmount) || 0;
  const credited = Number(data.creditApplied) || 0;
  if (amount > total - paid - credited + 0.005) throw new ActionError("That payment is greater than the remaining balance.");

  const updatedPaid = paid + amount;
  const updatedData = {
    ...data,
    paidAmount: updatedPaid.toFixed(2),
    status: updatedPaid + credited >= total ? "Paid" : "Partially Paid",
    // Show where the latest payment went in the invoice list's payment account column.
    paymentMethod: method,
    paymentAccountId: paymentAccount.id,
    paymentAccountName: paymentAccount.data.name || paymentAccount.data.code || "Account",
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
      paymentAccountId: paymentAccount.id,
      paymentAccountName: paymentAccount.data.name || paymentAccount.data.code || "Account",
    },
  });
  revalidatePath("/app", "layout");
}

/**
 * Removes every payment recorded against an invoice, so a paid invoice can be
 * corrected and paid again (for example into a different account).
 */
export async function undoInvoicePayments(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  await db.transaction(async (transaction) => {
    const [invoice] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")))
      .for("update")
      .limit(1);
    if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");
    if (!(Number(invoice.data.paidAmount) > 0)) throw new ActionError(`${invoice.data.invoiceNumber || "This invoice"} has no payment to undo.`);
    await transaction
      .delete(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'invoiceId' = ${id}`));
    const credited = Number(invoice.data.creditApplied) || 0;
    await transaction
      .update(bookkeepingRecord)
      .set({
        data: {
          ...invoice.data,
          paidAmount: "0",
          paymentMethod: "Credit",
          paymentAccountId: "",
          paymentAccountName: "",
          status: credited > 0 ? "Partially Paid" : "Open",
        },
        updatedAt: new Date(),
      })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  });
  revalidatePath("/app", "layout");
}

async function findPaymentAccount(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, accountId), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "accounts")))
    .limit(1);
  const method = account ? paymentAccountType({ kind: "accounts", data: account.data }) : null;
  if (!account || !method) throw new ActionError("Choose a Cash, Bank, or Credit card account from Chart of Accounts.");
  return { account, method, name: account.data.name || account.data.code || "Account" };
}

function isPaymentDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Pays a bill's remaining balance from a Cash, Bank or Credit card account and records where it came from. */
export async function recordBillPayment(id: string, paymentDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "bills");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  await db.transaction(async (transaction) => {
    const [bill] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bills")))
      .for("update")
      .limit(1);
    if (!bill) throw new ActionError("We couldn’t find that bill. Refresh and try again.");
    if (bill.data.status === "Cancelled") throw new ActionError(`${bill.data.billNumber || "This bill"} is cancelled.`);
    const paid = Number(bill.data.paidAmount) || 0;
    const due = (Number(bill.data.amount) || 0) - paid - (Number(bill.data.creditApplied) || 0);
    if (due <= 0.005) throw new ActionError(`${bill.data.billNumber || "This bill"} is already paid.`);
    await transaction
      .update(bookkeepingRecord)
      .set({
        data: { ...bill.data, paidAmount: (paid + due).toFixed(2), status: "Paid", paymentMethod: method, paymentAccountId: account.id, paymentAccountName: name, paymentDate },
        updatedAt: new Date(),
      })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
    await transaction.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "payments",
      data: { billId: id, billNumber: bill.data.billNumber ?? "Bill", vendor: bill.data.vendor ?? "", amount: due.toFixed(2), paymentDate, method, paymentAccountId: account.id, paymentAccountName: name, direction: "out" },
    });
  });
  revalidatePath("/app", "layout");
}

/** Removes the payments recorded on a bill so it can be corrected and paid again. */
export async function undoBillPayments(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "bills");
  await db.transaction(async (transaction) => {
    const [bill] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bills")))
      .for("update")
      .limit(1);
    if (!bill) throw new ActionError("We couldn’t find that bill. Refresh and try again.");
    if (!(Number(bill.data.paidAmount) > 0)) throw new ActionError(`${bill.data.billNumber || "This bill"} has no payment to undo.`);
    await transaction
      .delete(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'billId' = ${id}`));
    await transaction
      .update(bookkeepingRecord)
      .set({
        data: { ...bill.data, paidAmount: "0", paymentMethod: "Credit", paymentAccountId: "", paymentAccountName: "", paymentDate: "", status: "Open" },
        updatedAt: new Date(),
      })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  });
  revalidatePath("/app", "layout");
}

/** Records which Cash, Bank or Credit card account paid an expense. */
export async function recordExpensePayment(id: string, paymentDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "expenses");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  const [expense] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "expenses")))
    .limit(1);
  if (!expense) throw new ActionError("We couldn’t find that expense. Refresh and try again.");
  if (expense.data.status === "Paid") throw new ActionError(`${expense.data.description || "This expense"} is already paid.`);
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...expense.data, status: "Paid", paymentAccount: `${method} · ${name}`, paymentAccountId: account.id, paymentDate }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

/** Records a salary as paid from a Cash, Bank or Credit card account. */
export async function recordPayrollPayment(id: string, paymentDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  const [entry] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .limit(1);
  if (!entry) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
  if (entry.data.status === "Paid") throw new ActionError(`${entry.data.employeeName || "This salary"} is already paid.`);
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...entry.data, status: "Paid", paidDate: paymentDate, paymentAccountId: account.id, paymentAccountName: name, paymentMethod: method }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  // The salary's loan deduction pays down the employee's HR loans.
  await applyLoanRepayment(me.id, entry.data, 1);
  revalidatePath("/app", "layout");
}

/** Clears the payment recorded on a salary so it shows as unpaid again. */
export async function undoPayrollPayment(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  const [entry] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .limit(1);
  if (!entry) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...entry.data, status: "Unpaid", paidDate: "" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  if (entry.data.status === "Paid") await applyLoanRepayment(me.id, entry.data, -1);
  revalidatePath("/app", "layout");
}

/** Clears the payment recorded on an expense so it can be paid from another account. */
export async function undoExpensePayment(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "expenses");
  const [expense] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "expenses")))
    .limit(1);
  if (!expense) throw new ActionError("We couldn’t find that expense. Refresh and try again.");
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...expense.data, status: "Unpaid", paymentAccount: "", paymentAccountId: "", paymentDate: "" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

/** Records a supplier credit note as refunded into a Cash, Bank or Credit card account. */
export async function refundSupplierCredit(id: string, refundDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "supplier-credits");
  if (!isPaymentDate(refundDate)) throw new ActionError("Choose a refund date.");
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  const [credit] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "supplier-credits")))
    .limit(1);
  if (!credit) throw new ActionError("We couldn’t find that credit note. Refresh and try again.");
  if (["Applied", "Refunded"].includes(credit.data.status ?? "")) throw new ActionError(`${credit.data.creditNumber || "This credit note"} has already been ${credit.data.status?.toLowerCase()}.`);
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...credit.data, status: "Refunded", refundDate, refundMethod: method, refundAccountId: account.id, refundAccountName: `${method} · ${name}` }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function markRecordPaid(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (kind !== "bills" && kind !== "invoices") throw new ActionError("That payment action isn’t available here.");
  const [row] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .limit(1);
  if (!row) throw new ActionError("We couldn’t find that record. Refresh and try again.");
  // Pay what is left after any supplier or customer credit already applied.
  const due = Math.max(0, (Number(row.data.amount) || 0) - (Number(row.data.creditApplied) || 0));
  const data = { ...row.data, paidAmount: due.toFixed(2), status: "Paid" };
  await db
    .update(bookkeepingRecord)
    .set({ data, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

export async function convertBookkeepingRecord(id: string, target?: string): Promise<void> {
  const me = await requireUser();
  await db.transaction(async (transaction) => {
    const [source] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)))
      .for("update")
      .limit(1);
    if (!source) throw new ActionError("We couldn’t find that record. Refresh and try again.");
    const sourceKind = source.kind as RecordKind;
    assertCanWrite(me, sourceKind);
    const defaultTarget = convertTargets[sourceKind];
    const targetKind = target && target !== defaultTarget
      ? optionalConvertTargets[sourceKind]?.find((kind) => kind === target)
      : defaultTarget;
    if (!targetKind) throw new ActionError("This record can’t be converted to that document.");
    if (sourceKind !== "purchase-orders" && source.data.status === "Converted") {
      throw new ActionError(`${source.data.orderNumber || source.data.estimateNumber || "This record"} has already been converted.`);
    }
    const targetCount = targetKind === "estimates" || targetKind === "sales-orders"
      ? (await transaction.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, targetKind)))).length
      : 0;
    if (sourceKind === "purchase-orders") {
      if (source.data.convertedRecordId || source.data.convertedKind) {
        throw new ActionError("This purchase order has already been recorded as a bill or expense.");
      }
      if (!(["Purchase Order", "Received"].includes(source.data.status || ""))) {
        throw new ActionError("Confirm this purchase order before creating its bill.");
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const sourceData = source.data;
    let targetData = amountFromLineItems({
      ...sourceData,
      ...(targetKind === "invoices"
        ? {
            invoiceNumber: `INV-${Date.now()}`,
            issueDate: today,
            paymentTerms: "30 days",
            dueDate: dueDateForTerms(today, "30 days"),
            paidAmount: "0",
            status: "Draft",
          }
        : targetKind === "estimates"
        ? {
            estimateNumber: `EST-${String(targetCount + 1).padStart(4, "0")}`,
            date: today,
            expiryDate: dueDateForTerms(today, "30 days"),
            status: "Draft",
            sourceOrderNumber: sourceData.orderNumber || "",
          }
        : targetKind === "sales-orders"
        ? {
            orderNumber: `SO-${String(targetCount + 1).padStart(4, "0")}`,
            date: today,
            deliveryDate: "",
            status: "Draft",
            sourceEstimateNumber: sourceData.estimateNumber || "",
          }
        : {
            billNumber: `BILL-${Date.now()}`,
            billDate: today,
            dueDate: "",
            paidAmount: "0",
            status: "Open",
          }),
    }, sourceKind === "purchase-orders" ? sourceKind : targetKind);
    if (sourceKind === "purchase-orders") {
      // Bills record spending by category, not product lines: the purchase order
      // total (tax and discount included) becomes one line under the supplier's
      // default expense category, or Cost of goods sold.
      const [vendor] = sourceData.vendor
        ? await transaction.select().from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "vendors"), sql`${bookkeepingRecord.data}->>'name' = ${sourceData.vendor}`))
          .limit(1)
        : [];
      const [defaultAccount] = vendor?.data.defaultExpenseAccount
        ? await transaction.select().from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"), eq(bookkeepingRecord.id, vendor.data.defaultExpenseAccount)))
          .limit(1)
        : [];
      const category = defaultAccount?.data.name?.trim() || "Cost of goods sold";
      const products = parseInvoiceLines(sourceData.lineItems ?? "").map((line) => `${line.name} × ${line.quantity}`).join(", ");
      const description = `Purchase order ${sourceData.poNumber || ""}${products ? `: ${products}` : ""}`.trim().slice(0, 400);
      targetData = {
        ...targetData,
        purchaseLineItems: sourceData.lineItems ?? "",
        lineItems: JSON.stringify([{ itemId: "", name: category, description, quantity: "1", rate: targetData.amount || "0" }]),
        category,
        description,
        // The purchase order total already includes its tax and discount.
        subtotal: targetData.amount || "0",
        taxRate: "",
        taxAmount: "0",
        discount: "",
        paymentTerms: "30 days",
        dueDate: dueDateForTerms(today, "30 days"),
      };
    }
    const [created] = await transaction.insert(bookkeepingRecord)
      .values({ userId: me.id, kind: targetKind, data: sourceKind === "purchase-orders" ? { ...targetData, sourcePurchaseOrderId: source.id, sourcePurchaseOrderNumber: sourceData.poNumber || "" } : targetData })
      .returning({ id: bookkeepingRecord.id });
    const updatedSourceData = sourceKind === "purchase-orders"
      ? { ...sourceData, convertedKind: targetKind, convertedRecordId: created.id, convertedAt: new Date().toISOString() }
      : { ...sourceData, status: "Converted" };
    await transaction
      .update(bookkeepingRecord)
      .set({ data: updatedSourceData, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, source.id), eq(bookkeepingRecord.userId, me.id)));
  });
  revalidatePath("/app", "layout");
}

export async function convertPurchaseOrderToExpense(
  id: string,
  expenseAccountId: string,
  paymentAccountId?: string,
): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "expenses");
  await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")))
      .for("update")
      .limit(1);
    if (!order) throw new ActionError("We couldn’t find that purchase order. Refresh and try again.");
    if (!["Purchase Order", "Received"].includes(order.data.status || "")) {
      throw new ActionError("Confirm this purchase order before recording it as an expense.");
    }
    if (order.data.convertedRecordId || order.data.convertedKind) {
      throw new ActionError("This purchase order has already been recorded as a bill or expense.");
    }

    const [expenseAccount] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, expenseAccountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")))
      .limit(1);
    if (!expenseAccount || expenseAccount.data.type !== "Expense" || expenseAccount.data.locked === "true") {
      throw new ActionError("Choose an available Expense category from Chart of Accounts.");
    }

    let paymentAccountData = { paymentAccountId: "", paymentAccountName: "", paymentMethod: "" };
    if (paymentAccountId) {
      const [paymentAccount] = await transaction
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, paymentAccountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")))
        .limit(1);
      const accountType = paymentAccount ? paymentAccountType({ kind: "accounts", data: paymentAccount.data }) : null;
      if (!paymentAccount || !accountType) throw new ActionError("Choose an available Cash, Bank, or Credit card account.");
      paymentAccountData = {
        paymentAccountId: paymentAccount.id,
        paymentAccountName: paymentAccount.data.name || paymentAccount.data.code || "Account",
        paymentMethod: accountType === "Bank" ? "Bank transfer" : accountType,
      };
    }

    const lines = parseInvoiceLines(order.data.lineItems || "");
    const orderAmount = Number(order.data.amount);
    if (!lines.length || !Number.isFinite(orderAmount) || orderAmount <= 0) {
      throw new ActionError("Add valid items and an amount to this purchase order before recording it as an expense.");
    }
    const lineSummary = lines
      .map((line) => [line.name, line.description].filter(Boolean).join(" — "))
      .join(", ")
      .slice(0, 240);
    const today = new Date().toISOString().slice(0, 10);
    const expenseData = amountFromLineItems({
      payee: order.data.vendor || "",
      expenseDate: order.data.date || today,
      currency: order.data.currency || "USD",
      lineItems: JSON.stringify([{
        itemId: "",
        name: expenseAccount.data.name || expenseAccount.data.code || "Expense",
        description: `${order.data.poNumber || "Purchase order"}${lineSummary ? ` · ${lineSummary}` : ""}`,
        quantity: "1",
        rate: orderAmount.toFixed(2),
      }]),
      expenseCategoryAccountId: expenseAccount.id,
      memo: order.data.memo || `Recorded from ${order.data.poNumber || "purchase order"}`,
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderNumber: order.data.poNumber || "",
      ...paymentAccountData,
    }, "expenses");
    const [created] = await transaction.insert(bookkeepingRecord)
      .values({ userId: me.id, kind: "expenses", data: expenseData })
      .returning({ id: bookkeepingRecord.id });
    await transaction
      .update(bookkeepingRecord)
      .set({
        data: { ...order.data, convertedKind: "expenses", convertedRecordId: created.id, convertedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(and(eq(bookkeepingRecord.id, order.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
  });
  revalidatePath("/app", "layout");
}

export async function createInventoryMovement(input: {
  itemId: string;
  movementType: "Receipt" | "Delivery" | "Adjustment";
  quantity: string;
  date: string;
  reference?: string;
  notes?: string;
}): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, "inventory-movements");
  const itemId = input.itemId.trim();
  const quantity = Number(input.quantity);
  const date = input.date.trim();
  const reference = (input.reference || "").trim().slice(0, 100);
  const notes = (input.notes || "").trim().slice(0, 500);

  if (!["Receipt", "Delivery", "Adjustment"].includes(input.movementType)) throw new ActionError("Choose a valid stock movement.");
  if (!itemId) throw new ActionError("Choose a product to continue.");
  if (!Number.isFinite(quantity) || quantity < 0 || (input.movementType !== "Adjustment" && quantity === 0)) {
    throw new ActionError("Enter a valid quantity greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new ActionError("Choose a valid movement date.");
  }

  const movement = await db.transaction(async (transaction) => {
    const [item] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, itemId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items")))
      .for("update")
      .limit(1);

    if (!item || item.data.itemType !== "Product") throw new ActionError("Choose a saved product from Items & services.");
    const previousStock = Number(item.data.stock || 0);
    if (!Number.isFinite(previousStock) || previousStock < 0) throw new ActionError("This product has an invalid stock balance. Correct its count before continuing.");

    const change = input.movementType === "Receipt"
      ? quantity
      : input.movementType === "Delivery"
        ? -quantity
        : quantity - previousStock;
    const nextStock = previousStock + change;
    if (input.movementType === "Delivery" && nextStock < 0) throw new ActionError("There isn’t enough stock for this delivery.");
    if (input.movementType === "Adjustment" && change === 0) throw new ActionError("The counted stock matches the current balance.");

    const updatedAt = new Date();
    await transaction
      .update(bookkeepingRecord)
      .set({ data: { ...item.data, stock: String(nextStock) }, updatedAt })
      .where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items")));

    const [savedMovement] = await transaction
      .insert(bookkeepingRecord)
      .values({
        userId: me.id,
        kind: "inventory-movements",
        data: {
          movementType: input.movementType,
          itemId: item.id,
          itemName: item.data.name || "Product",
          sku: item.data.sku || "",
          unit: item.data.unit || "",
          quantity: String(Math.abs(change)),
          change: String(change),
          previousStock: String(previousStock),
          resultingStock: String(nextStock),
          date,
          reference,
          notes,
        },
        updatedAt,
      })
      .returning();

    return serializeRow(savedMovement);
  });

  revalidatePath("/app", "layout");
  return movement;
}

export async function advancePurchaseOrder(
  id: string,
  action: "send-rfq" | "confirm" | "receive" | "cancel",
): Promise<{ status: string }> {
  const me = await requireUser();
  assertCanWrite(me, "purchase-orders");
  if (!["send-rfq", "confirm", "receive", "cancel"].includes(action)) throw new ActionError("That purchase order action isn’t available.");
  const [order] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")))
    .limit(1);
  if (!order) throw new ActionError("We couldn’t find that purchase order. Refresh and try again.");

  const currentStatus = order.data.status === "Sent" ? "RFQ Sent" : order.data.status || "Draft";
  if (action === "send-rfq") {
    if (currentStatus !== "Draft") throw new ActionError("Only a draft request can be sent to the vendor.");
    const vendorRows = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "vendors")));
    const vendorName = order.data.vendor?.trim().toLowerCase();
    const vendor = vendorRows.find((row) => row.id === order.data.vendorId || row.id === order.data.vendor)
      ?? vendorRows.find((row) => row.data.name?.trim().toLowerCase() === vendorName);
    if (!vendor?.data.email) throw new ActionError("Add an email address to this vendor before sending the RFQ.");

    const [settings] = await db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
      .orderBy(desc(bookkeepingRecord.updatedAt))
      .limit(1);
    const company = settings?.data.companyName || me.name;
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return entities[character] ?? character;
    });
    const lines = parseInvoiceLines(order.data.lineItems || "");
    const lineRows = lines.map((line) => {
      const quantity = Number(line.quantity) || 0;
      const rate = Number(line.rate) || 0;
      return `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.rate)}</td><td>${(quantity * rate).toFixed(2)}</td></tr>`;
    }).join("");
    const number = order.data.poNumber || "Purchase order";
    await sendEmailOrThrow({
      to: vendor.data.email,
      subject: `Request for quotation ${number} from ${company}`,
      html: `<p>Hello ${escapeHtml(vendor.data.name || "there")},</p><p>Please review our request for quotation <strong>${escapeHtml(number)}</strong>${order.data.expectedDate ? `, expected by ${escapeHtml(order.data.expectedDate)}` : ""}.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th align="left">Item</th><th align="left">Qty</th><th align="left">Rate</th><th align="left">Amount</th></tr></thead><tbody>${lineRows}</tbody></table><p>Total: ${escapeHtml(order.data.amount || "0")} ${escapeHtml(order.data.currency || "USD")}</p><p>${escapeHtml(company)}</p>`,
      fromName: company,
    });

    const [updated] = await db
      .update(bookkeepingRecord)
      .set({ data: { ...order.data, status: "RFQ Sent", sentAt: new Date().toISOString() }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders"), eq(bookkeepingRecord.data, order.data)))
      .returning({ id: bookkeepingRecord.id });
    if (!updated) throw new ActionError("The purchase order changed while the RFQ was being sent. Refresh and try again.");
    revalidatePath("/app", "layout");
    return { status: "RFQ Sent" };
  }

  const result = await db.transaction(async (transaction) => {
    const [lockedOrder] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")))
      .for("update")
      .limit(1);
    if (!lockedOrder) throw new ActionError("We couldn’t find that purchase order. Refresh and try again.");
    const status = lockedOrder.data.status === "Sent" ? "RFQ Sent" : lockedOrder.data.status || "Draft";
    const updatedAt = new Date();

    if (action === "confirm") {
      if (!["Draft", "RFQ Sent"].includes(status)) throw new ActionError("Only a draft order can be confirmed.");
      await transaction.update(bookkeepingRecord)
        .set({ data: { ...lockedOrder.data, status: "Purchase Order", confirmedAt: updatedAt.toISOString() }, updatedAt })
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
      return "Purchase Order";
    }

    if (action === "receive") {
      if (status !== "Purchase Order") throw new ActionError("Confirm this purchase order before receiving its items.");
      const lines = parseInvoiceLines(lockedOrder.data.lineItems || "");
      const quantities = new Map<string, number>();
      for (const line of lines) {
        if (!line.itemId) continue;
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new ActionError("Check the ordered quantities before receiving items.");
        quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + quantity);
      }
      const itemIds = [...quantities.keys()];
      if (itemIds.length) {
        const linkedItems = await transaction.select().from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items"), inArray(bookkeepingRecord.id, itemIds)))
          .for("update");
        if (linkedItems.length !== itemIds.length) throw new ActionError("A linked item is no longer available. Update the purchase order before receiving it.");
        for (const item of linkedItems) {
          if (item.data.itemType !== "Product") continue;
          const previousStock = Number(item.data.stock || 0);
          const receivedQuantity = quantities.get(item.id) || 0;
          const nextStock = previousStock + receivedQuantity;
          if (!Number.isFinite(nextStock)) throw new ActionError(`Check the stock quantity for ${item.data.name || "this item"}.`);
          await transaction.update(bookkeepingRecord)
            .set({ data: { ...item.data, stock: String(nextStock) }, updatedAt })
            .where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items")));
          await transaction.insert(bookkeepingRecord).values({
            userId: me.id,
            kind: "inventory-movements",
            data: {
              movementType: "Receipt",
              itemId: item.id,
              itemName: item.data.name || "Product",
              sku: item.data.sku || "",
              unit: item.data.unit || "",
              quantity: String(receivedQuantity),
              change: String(receivedQuantity),
              previousStock: String(previousStock),
              resultingStock: String(nextStock),
              date: updatedAt.toISOString().slice(0, 10),
              reference: lockedOrder.data.poNumber || "Purchase order",
              notes: "Received from purchase order",
            },
            updatedAt,
          });
        }
      }
      await transaction.update(bookkeepingRecord)
        .set({ data: { ...lockedOrder.data, status: "Received", receivedAt: updatedAt.toISOString() }, updatedAt })
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
      return "Received";
    }

    if (![
      "Draft",
      "RFQ Sent",
      "Purchase Order",
    ].includes(status) || lockedOrder.data.convertedRecordId || lockedOrder.data.convertedKind) {
      throw new ActionError("This purchase order can no longer be cancelled.");
    }
    await transaction.update(bookkeepingRecord)
      .set({ data: { ...lockedOrder.data, status: "Cancelled", cancelledAt: updatedAt.toISOString() }, updatedAt })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
    return "Cancelled";
  });

  revalidatePath("/app", "layout");
  return { status: result };
}

export async function toggleTransactionMatch(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "transactions");
  const [transaction] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
    .limit(1);
  if (!transaction) throw new ActionError("We couldn’t find that transaction. Refresh and try again.");
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
  assertCanWrite(me, "reconciliations");
  const endingBalance = Number(endingBalanceInput);
  const parsedStatementDate = new Date(`${statementDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDate) || Number.isNaN(parsedStatementDate.getTime()) || parsedStatementDate.toISOString().slice(0, 10) !== statementDate) {
    throw new ActionError("Choose a valid statement ending date.");
  }
  if (!Number.isFinite(endingBalance)) throw new ActionError("Enter the ending balance shown on your bank statement.");
  if (!Array.isArray(transactionIds) || transactionIds.length > 500) throw new ActionError("Select up to 500 transactions at a time.");
  const uniqueTransactionIds = [...new Set(transactionIds)];
  if (uniqueTransactionIds.length !== transactionIds.length) throw new ActionError("A transaction was selected more than once.");

  const created = await db.transaction(async (tx) => {
    const [bankAccount] = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, bankAccountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-accounts")))
      .for("update")
      .limit(1);
    if (!bankAccount || !bankAccount.data.name) throw new ActionError("Choose a bank account from your Banking section.");

    const bankAccounts = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bank-accounts")));
    if (bankAccounts.filter((record) => record.data.name === bankAccount.data.name).length > 1) {
      throw new ActionError("Bank account names must be unique before they can be reconciled.");
    }

    const reconciliationRows = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "reconciliations")));
    const accountReconciliations = reconciliationRows.filter((record) => record.data.bankAccountId === bankAccount.id);
    if (accountReconciliations.some((record) => record.data.statementDate === statementDate)) {
      throw new ActionError("This statement date has already been reconciled for that account.");
    }
    if (accountReconciliations.some((record) => record.data.statementDate > statementDate)) {
      throw new ActionError("Reconcile this account’s statements in date order, starting with the earliest one.");
    }
    const priorReconciliation = accountReconciliations
      .filter((record) => record.data.statementDate < statementDate)
      .sort((first, second) => second.data.statementDate.localeCompare(first.data.statementDate))[0];
    const openingBalanceInput = priorReconciliation?.data.endingBalance ?? bankAccount.data.openingBalance ?? "0";
    const openingBalance = Number(openingBalanceInput);
    if (!Number.isFinite(openingBalance)) throw new ActionError("Update this account’s opening balance before reconciling.");

    const transactionRows = await tx
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "transactions")))
      .for("update");
    const selectedRows = uniqueTransactionIds.map((id) => transactionRows.find((record) => record.id === id));
    if (selectedRows.some((record) => !record)) throw new ActionError("One or more selected transactions aren’t available in this account.");

    const selectedTransactions = selectedRows.filter((record): record is (typeof transactionRows)[number] => Boolean(record));
    const openingCents = Math.round(openingBalance * 100);
    const endingCents = Math.round(endingBalance * 100);
    let netClearedCents = 0;
    let depositCents = 0;
    let withdrawalCents = 0;

    for (const transaction of selectedTransactions) {
      const amount = Number(transaction.data.amount);
      if (transaction.data.account !== bankAccount.data.name) throw new ActionError("Each selected transaction must belong to the chosen bank account.");
      if (transaction.data.reconciled === "true") throw new ActionError("A selected transaction is already part of a completed reconciliation.");
      if (!transaction.data.date || transaction.data.date > statementDate || (priorReconciliation && transaction.data.date <= priorReconciliation.data.statementDate)) {
        throw new ActionError("Selected transactions must fall within this statement period.");
      }
      if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Every selected transaction needs a valid amount greater than zero.");
      const amountCents = Math.round(amount * 100);
      if (transaction.data.type === "Withdrawal") {
        netClearedCents -= amountCents;
        withdrawalCents += amountCents;
      } else if (transaction.data.type === "Deposit") {
        netClearedCents += amountCents;
        depositCents += amountCents;
      } else {
        throw new ActionError("Choose Deposit or Withdrawal for each selected transaction.");
      }
    }

    const differenceCents = endingCents - openingCents - netClearedCents;
    if (differenceCents !== 0) throw new ActionError("The selected transactions don’t balance to the statement ending balance yet.");

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
  assertCanWrite(me, "credit-notes");
  const [creditNote] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "credit-notes")))
    .limit(1);
  if (!creditNote) throw new ActionError("We couldn’t find that credit note. Refresh and try again.");
  if (creditNote.data.status === "Applied" || creditNote.data.status === "Refunded") throw new ActionError("This credit note has already been used.");
  if (!creditNote.data.invoiceNumber) throw new ActionError("Add an invoice number to this credit note first.");

  const invoices = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")));
  const invoice = invoices.find((item) => item.data.invoiceNumber === creditNote.data.invoiceNumber);
  if (!invoice) throw new ActionError("We couldn’t find an invoice with that number in this account.");

  const creditAmount = Number(creditNote.data.amount) || 0;
  const paid = Number(invoice.data.paidAmount) || 0;
  const alreadyCredited = Number(invoice.data.creditApplied) || 0;
  const remaining = Number(invoice.data.amount) - paid - alreadyCredited;
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) throw new ActionError("Enter a credit amount greater than zero.");
  if (creditAmount > remaining + 0.005) throw new ActionError("The credit is greater than this invoice’s remaining balance.");

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

export async function applySupplierCredit(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "supplier-credits");
  await db.transaction(async (transaction) => {
    const [credit] = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "supplier-credits")))
      .for("update")
      .limit(1);
    if (!credit) throw new ActionError("We couldn’t find that credit note. Refresh and try again.");
    if (credit.data.status === "Applied") throw new ActionError("This credit note has already been applied.");
    const billNumber = credit.data.billNumber?.trim();
    if (!billNumber) throw new ActionError("Add the bill number this credit applies to, then try again.");

    const bills = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bills")))
      .for("update");
    const vendor = credit.data.vendor?.trim().toLowerCase();
    const bill = bills.find((row) => row.data.billNumber?.trim() === billNumber && (!vendor || row.data.vendor?.trim().toLowerCase() === vendor));
    if (!bill) throw new ActionError(`We couldn’t find bill ${billNumber} from ${credit.data.vendor || "this supplier"}.`);
    if (bill.data.status === "Cancelled") throw new ActionError("That bill is cancelled.");

    const creditAmount = Number(credit.data.amount) || 0;
    const paid = Number(bill.data.paidAmount) || 0;
    const alreadyCredited = Number(bill.data.creditApplied) || 0;
    const remaining = (Number(bill.data.amount) || 0) - paid - alreadyCredited;
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) throw new ActionError("This credit note needs an amount greater than zero.");
    if (creditAmount > remaining + 0.005) throw new ActionError(`The credit is more than bill ${billNumber}’s remaining balance.`);

    const newCredit = alreadyCredited + creditAmount;
    const settled = paid + newCredit >= (Number(bill.data.amount) || 0) - 0.005;
    await transaction
      .update(bookkeepingRecord)
      .set({ data: { ...bill.data, creditApplied: newCredit.toFixed(2), status: settled ? "Paid" : bill.data.status }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, bill.id), eq(bookkeepingRecord.userId, me.id)));
    await transaction
      .update(bookkeepingRecord)
      .set({ data: { ...credit.data, appliedAmount: creditAmount.toFixed(2), appliedBillId: bill.id, status: "Applied" }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  });
  revalidatePath("/app", "layout");
}

export async function generateRecurringInvoice(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const [schedule] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "recurring-invoices")))
    .limit(1);
  if (!schedule) throw new ActionError("We couldn’t find that recurring invoice. Refresh and try again.");
  if (schedule.data.status === "Paused") throw new ActionError("Resume this schedule before generating its invoice.");

  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt))
    .limit(1);
  const sequence = Math.max(1, Number(settings?.data.nextInvoiceNumber) || 1);
  const prefix = settings?.data.invoicePrefix || "INV-";
  const today = new Date().toISOString().slice(0, 10);
  const invoiceData = amountFromLineItems({
    ...schedule.data,
    invoiceNumber: `${prefix}${String(sequence).padStart(4, "0")}`,
    issueDate: today,
    paymentTerms: "30 days",
    dueDate: dueDateForTerms(today, "30 days"),
    currency: settings?.data.currency || "USD",
    exchangeRate: "1",
    paidAmount: "0",
    status: "Draft",
  }, "invoices");
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

export async function sendInvoiceRecord(id: string): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices"), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");
  const customerName = invoice.data.customer?.trim().toLowerCase();
  const customers = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "customers")));
  const customer = customers.find((row) => row.id === invoice.data.customerId || row.id === invoice.data.customer)
    ?? customers.find((row) => row.data.name?.trim().toLowerCase() === customerName);
  if (!customer?.data.email) throw new ActionError("Add an email address to this customer before sending the invoice.");

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
  const shareToken = invoice.data.shareToken || randomBytes(32).toString("hex");
  const invoiceLink = `${await siteUrl()}/invoice/${shareToken}`;
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
    html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(invoiceLink)}">View invoice ${escapeHtml(invoice.data.invoiceNumber ?? "")}</a></p>`,
    fromName: company,
  });
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...invoice.data, shareToken, status: "Sent" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
  return shareToken;
}

export async function createInvoiceShareLink(id: string): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices"), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");
  const shareToken = invoice.data.shareToken || randomBytes(32).toString("hex");
  if (shareToken !== invoice.data.shareToken) {
    await db
      .update(bookkeepingRecord)
      .set({ data: { ...invoice.data, shareToken }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, invoice.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")));
  }
  revalidatePath("/app", "layout");
  return `${await siteUrl()}/invoice/${shareToken}`;
}

type CustomerDocumentKind = Extract<RecordKind, "estimates" | "sales-orders" | "credit-notes">;

const customerDocumentDetails: Record<CustomerDocumentKind, { label: string; numberKey: string }> = {
  estimates: { label: "Estimate", numberKey: "estimateNumber" },
  "sales-orders": { label: "Sales order", numberKey: "orderNumber" },
  "credit-notes": { label: "Credit note", numberKey: "creditNumber" },
};

export async function createCustomerDocumentShareLink(id: string, kind: CustomerDocumentKind): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const [document] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!document) throw new ActionError(`We couldn’t find that ${customerDocumentDetails[kind].label.toLowerCase()}. Refresh and try again.`);

  const shareToken = document.data.shareToken || randomBytes(32).toString("hex");
  if (shareToken !== document.data.shareToken) {
    await db
      .update(bookkeepingRecord)
      .set({ data: { ...document.data, shareToken }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, document.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)));
  }
  revalidatePath("/app", "layout");
  return `${await siteUrl()}/invoice/${shareToken}`;
}

export async function sendCustomerDocumentRecord(id: string, kind: CustomerDocumentKind): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const [document] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!document) throw new ActionError(`We couldn’t find that ${customerDocumentDetails[kind].label.toLowerCase()}. Refresh and try again.`);

  const customers = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "customers")));
  const customer = customers.find((row) => row.id === document.data.customerId || row.id === document.data.customer)
    ?? customers.find((row) => row.data.name?.trim().toLowerCase() === document.data.customer?.trim().toLowerCase());
  if (!customer?.data.email) throw new ActionError("Add an email address to this customer before sending.");

  const details = customerDocumentDetails[kind];
  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt))
    .limit(1);
  const company = settings?.data.companyName || me.name;
  const shareToken = document.data.shareToken || randomBytes(32).toString("hex");
  const documentLink = `${await siteUrl()}/invoice/${shareToken}`;
  const number = document.data[details.numberKey] || "";
  const customerName = customer.data.name || "there";
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });

  await sendEmailOrThrow({
    to: customer.data.email,
    subject: `${details.label} ${number} from ${company}`,
    html: `<p>Hello ${escapeHtml(customerName)}, your ${details.label.toLowerCase()} ${escapeHtml(number)} for ${escapeHtml(document.data.amount || "0")} ${escapeHtml(document.data.currency || "USD")} is ready.</p><p><a href="${escapeHtml(documentLink)}">View ${details.label.toLowerCase()} ${escapeHtml(number)}</a></p>`,
    fromName: company,
  });

  const updatedData: Record<string, string> = { ...document.data, shareToken, sentAt: new Date().toISOString() };
  if (kind === "estimates") updatedData.status = "Sent";
  await db
    .update(bookkeepingRecord)
    .set({ data: updatedData, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, document.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)));
  revalidatePath("/app", "layout");
  return shareToken;
}

export async function duplicateCustomerDocumentRecord(id: string, kind: CustomerDocumentKind): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  const [document] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!document) throw new ActionError(`We couldn’t find that ${customerDocumentDetails[kind].label.toLowerCase()}. Refresh and try again.`);

  const existing = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)));
  const details = customerDocumentDetails[kind];
  const prefix = kind === "estimates" ? "EST" : kind === "sales-orders" ? "SO" : "CN";
  const sequence = existing.reduce((highest, row) => {
    const suffix = Number(row.data[details.numberKey]?.replace(`${prefix}-`, ""));
    return Number.isFinite(suffix) ? Math.max(highest, suffix) : highest;
  }, 0) + 1;
  const nextNumber = `${prefix}-${String(sequence).padStart(4, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  const duplicateData: Record<string, string> = {
    ...document.data,
    [details.numberKey]: nextNumber,
    date: today,
    status: "Draft",
  };
  delete duplicateData.shareToken;
  delete duplicateData.sentAt;
  if (kind === "estimates") duplicateData.expiryDate = "";
  if (kind === "sales-orders") duplicateData.deliveryDate = "";
  if (kind === "credit-notes") duplicateData.invoiceNumber = "";

  const [created] = await db
    .insert(bookkeepingRecord)
    .values({ userId: me.id, kind, data: amountFromLineItems(duplicateData, kind) })
    .returning();
  revalidatePath("/app", "layout");
  return serializeRow(created);
}

export async function duplicateInvoiceRecord(id: string): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices"), eq(bookkeepingRecord.id, id)))
    .limit(1);
  if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");

  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt))
    .limit(1);
  const invoices = settings ? [] : await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")));
  const sequence = Math.max(1, Number(settings?.data.nextInvoiceNumber) || invoices.length + 1);
  const prefix = settings?.data.invoicePrefix || "INV-";
  const invoiceNumber = `${prefix}${String(sequence).padStart(4, "0")}`;
  const issueDate = new Date().toISOString().slice(0, 10);
  const paymentTerms = invoice.data.paymentTerms || "30 days";
  const duplicateData: Record<string, string> = { ...invoice.data, invoiceNumber, issueDate, dueDate: dueDateForTerms(issueDate, paymentTerms), paymentTerms, status: "Draft", paidAmount: "0", creditApplied: "0" };
  delete duplicateData.shareToken;
  const [created] = await db
    .insert(bookkeepingRecord)
    .values({ userId: me.id, kind: "invoices", data: amountFromLineItems(duplicateData, "invoices") })
    .returning();
  if (settings) {
    await db
      .update(bookkeepingRecord)
      .set({ data: { ...settings.data, nextInvoiceNumber: String(sequence + 1) }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, settings.id), eq(bookkeepingRecord.userId, me.id)));
  }
  revalidatePath("/app", "layout");
  return serializeRow(created);
}

export async function getAttachmentUploadTarget(
  filename: string,
  contentType: string,
  size: number,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const me = await requireUser();
  if (me.role === "Viewer") throw new ActionError("Your role doesn’t allow changing records. Ask an Admin in your business.");
  if (size > 10 * 1024 * 1024) throw new ActionError("Attachments must be 10 MB or smaller.");
  const target = await createUploadUrl({ filename, contentType, size });
  return { uploadUrl: target.uploadUrl, publicUrl: target.publicUrl };
}
export async function saveBulkInventoryCount(input: {
  rows: InventoryCountRow[];
  date: string;
  reference?: string;
}): Promise<{ checkedCount: number; adjustedCount: number }> {
  const me = await requireUser();
  assertCanWrite(me, "inventory-movements");
  const rows: InventoryCountRow[] = [];
  const seenItemIds = new Set<string>();

  if (!input || !Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_INVENTORY_COUNT_ROWS) {
    throw new ActionError(`Choose between 1 and ${MAX_INVENTORY_COUNT_ROWS} product counts to save.`);
  }

  for (const [index, value] of input.rows.entries()) {
    if (!value || typeof value !== "object") throw new ActionError(`Check the product on count row ${index + 2}.`);
    const itemId = typeof value.itemId === "string" ? value.itemId.trim() : "";
    const quantity = typeof value.quantity === "string" ? value.quantity.trim() : "";
    const parsedQuantity = Number(quantity);
    if (!itemId || !quantity || !Number.isFinite(parsedQuantity) || parsedQuantity < 0 || parsedQuantity > 1_000_000_000_000) {
      throw new ActionError(`Enter a valid non-negative counted quantity on count row ${index + 2}.`);
    }
    if (seenItemIds.has(itemId)) throw new ActionError(`A product appears more than once on count row ${index + 2}.`);
    seenItemIds.add(itemId);
    rows.push({ itemId, quantity: String(parsedQuantity) });
  }

  const date = typeof input.date === "string" ? input.date.trim() : "";
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new ActionError("Choose a valid stock count date.");
  }
  const reference = typeof input.reference === "string" ? input.reference.trim().slice(0, 100) : "";

  const adjustedCount = await db.transaction(async (transaction) => {
    const itemIds = rows.map((row) => row.itemId).sort();
    const items = await transaction
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items"), inArray(bookkeepingRecord.id, itemIds)))
      .orderBy(bookkeepingRecord.id)
      .for("update");

    if (items.length !== rows.length || items.some((item) => item.data.itemType !== "Product")) {
      throw new ActionError("The spreadsheet includes a product that is no longer in your inventory. Download a fresh template and try again.");
    }

    const countedById = new Map(rows.map((row) => [row.itemId, Number(row.quantity)]));
    const updatedAt = new Date();
    const movements: (typeof bookkeepingRecord.$inferInsert)[] = [];

    for (const item of items) {
      const countedStock = countedById.get(item.id);
      if (countedStock === undefined) throw new ActionError("The count sheet has changed. Download a fresh template and try again.");
      const previousStock = Number(item.data.stock || 0);
      if (!Number.isFinite(previousStock) || previousStock < 0) {
        throw new ActionError(`${item.data.name || "A product"} has an invalid current stock balance. Fix its count before importing.`);
      }
      const change = countedStock - previousStock;
      if (change === 0) continue;

      await transaction
        .update(bookkeepingRecord)
        .set({ data: { ...item.data, stock: String(countedStock) }, updatedAt })
        .where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items")));

      movements.push({
        userId: me.id,
        kind: "inventory-movements",
        data: {
          movementType: "Adjustment",
          itemId: item.id,
          itemName: item.data.name || "Product",
          sku: item.data.sku || "",
          unit: item.data.unit || "",
          quantity: String(Math.abs(change)),
          change: String(change),
          previousStock: String(previousStock),
          resultingStock: String(countedStock),
          date,
          reference: reference || "Bulk stock count",
          notes: "Physical count imported from spreadsheet.",
        },
        updatedAt,
      });
    }

    if (movements.length > 0) await transaction.insert(bookkeepingRecord).values(movements);
    return movements.length;
  });

  revalidatePath("/app", "layout");
  return { checkedCount: rows.length, adjustedCount };
}
