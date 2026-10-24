"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { assertBooksOpen, documentDate } from "@/lib/closing";
import { revalidatePath } from "@/lib/revalidate";

import { db } from "@/db";
import { ActionError } from "@/lib/action-error";
import { bookkeepingRecord, user } from "@/db/schema";
import { assertCanRead, assertCanWrite, assertNotViewing, requireUser } from "@/lib/auth";
import { businessRecords, type BusinessBackup } from "@/lib/backup";
import { canReadKind } from "@/lib/permissions";
import { syncAttachmentRepayments } from "@/lib/hr-rules";
import { sendEmailOrThrow } from "@/lib/email";
import { blobConfigured, blobUploadToken, createUploadUrl, privateBlobToken } from "@/lib/storage";
import { dueDateForTerms, invoiceTax, parseInvoiceLines, serialList } from "@/lib/invoice-utils";
import { defaultWarehouse, lotRegister, stockByWarehouse } from "@/lib/warehouses";
import { buildInventory, inventoryKinds, isInventoryItem } from "@/lib/inventory";
import { siteUrl } from "@/lib/site";
import { isRecordKind, type BookkeepingRecord, type RecordKind } from "@/lib/bookkeeping-types";
import { paymentAccountType, receivingAccountType } from "@/lib/payment-accounts";
import { recurringKinds, type RecurringKind } from "@/lib/recurring";
import { accountCategoryForType, accountDetailsForType } from "@/lib/account-types";
import { standardAccounts } from "@/lib/standard-accounts";
import { budgetActual, budgetExpectedTotal, payrollBudgetHead, budgetVariance, parseBudgetLines, parseCsv, recordsWithinBudgetDates, resolveBudgetLineAccount, type BudgetCategory, type BudgetLine, type BudgetLineType, type BudgetPeriod } from "@/lib/budget-utils";
import { calculatePayroll, payrollCsvFields, serializePayroll, type EmployerContribution, type PayrollValues, type SalaryTaxRule } from "@/lib/payroll-utils";
import { packFor } from "@/lib/tax-packs";
import { nextPartyNumber, partyNumberKey } from "@/lib/party-number";
import { paymentTermOptions, termsFor } from "@/lib/payment-terms";
import { buildLedger } from "@/lib/ledger";
import type { PayrollLiabilityKind } from "@/lib/payroll-liabilities";
import { supplierCategoryForBankLine } from "@/lib/supplier-memory";
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

export async function exportMyAccountData(): Promise<BusinessBackup> {
  const me = await requireUser();
  assertNotViewing(me);
  // A team member exports only their own profile; the business's records are the owner's to export.
  return {
    exportedAt: new Date().toISOString(),
    account: { name: me.name, email: me.email },
    business: me.workspaceName,
    records: me.role === "Admin" ? await businessRecords(me.id) : [],
  };
}

/**
 * Fields only the app's own actions set: what was paid or credited (Receive
 * payment, Pay bill, Apply credit), share links and send times, bank matching.
 * A form can't type them in, so nobody can mark an invoice paid without a
 * payment behind it. Payroll and employees keep their own rules.
 */
const serverOwnedKeys = ["paidAmount", "creditApplied", "shareToken", "sentAt", "reconciled", "reconciliationId", "depositId"];
const keysOnlySetLater = new Set(["paidAmount", "creditApplied", "shareToken", "sentAt"]);

function keepServerOwned(kind: string, data: Record<string, string>, current: Record<string, string> | undefined) {
  if (kind === "payroll" || kind === "employees") return data;
  const next = { ...data };
  for (const key of serverOwnedKeys) {
    if (current) {
      if (current[key] !== undefined) next[key] = current[key];
      else delete next[key];
    } else if (keysOnlySetLater.has(key)) {
      delete next[key];
    }
  }
  if (kind === "settings") {
    // Public form and jobs-page addresses are made here, never taken from the browser,
    // so one business can't claim another's address and receive its leads.
    for (const key of ["webFormToken", "careersToken"]) {
      if (!next[key]) next[key] = "";
      else if (next[key] !== current?.[key]) next[key] = randomBytes(16).toString("hex");
    }
  }
  return next;
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
  // An invite's link is the key to joining the business: it goes to the invitee
  // by email and never to anyone browsing the team list.
  if (row.kind === "team-members" && data.inviteToken) {
    const { inviteToken: _inviteToken, ...rest } = data;
    data = rest;
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
  if (entries.length > 120) throw new ActionError("This record has too many fields.");

  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof value !== "string") {
        throw new ActionError("One of the values needs to be checked.");
      }
      return [key, value.trim().slice(0, key === "emailTemplate" ? 12000 : key === "lines" || key === "lineItems" ? 30000 : 4000)];
    }),
  );
}

/** Checks a recurring template's schedule, as in QuickBooks' Recurring transactions. */
function recurringTemplateData(me: Parameters<typeof assertCanWrite>[0], data: Record<string, string>): Record<string, string> {
  if (!recurringKinds.includes(data.rtKind as RecurringKind)) throw new ActionError("Choose an invoice, bill, expense or journal to repeat.");
  assertCanWrite(me, data.rtKind);
  if (!data.rtName?.trim()) throw new ActionError("Enter a template name.");
  if (!["Scheduled", "Reminder", "Unscheduled"].includes(data.rtType)) throw new ActionError("Choose Scheduled, Reminder or Unscheduled.");
  if (data.rtType !== "Unscheduled") {
    if (!["Daily", "Weekly", "Monthly", "Yearly"].includes(data.rtInterval)) throw new ActionError("Choose how often it repeats.");
    const every = Number(data.rtEvery || "1");
    if (!Number.isInteger(every) || every < 1 || every > 99) throw new ActionError("Repeat every 1 to 99 periods.");
    if (!isIsoDate(data.rtStart)) throw new ActionError("Choose a start date.");
    if (!["None", "By", "After"].includes(data.rtEndType || "None")) throw new ActionError("Choose when the schedule ends.");
    if (data.rtEndType === "By" && (!isIsoDate(data.rtEndDate) || data.rtEndDate < data.rtStart)) throw new ActionError("Choose an end date on or after the start date.");
    const occurrences = Number(data.rtOccurrences);
    if (data.rtEndType === "After" && (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 999)) throw new ActionError("Enter how many times it repeats, from 1 to 999.");
    data = { ...data, rtEvery: String(every), rtEndType: data.rtEndType || "None", rtNext: data.rtNext && isIsoDate(data.rtNext) ? data.rtNext : data.rtStart };
  } else {
    data = { ...data, rtInterval: "", rtEvery: "", rtStart: "", rtEndType: "", rtEndDate: "", rtOccurrences: "", rtNext: "" };
  }
  return { ...data, rtName: data.rtName.trim().slice(0, 120), rtStatus: ["Active", "Paused", "Ended"].includes(data.rtStatus) ? data.rtStatus : "Active", rtCount: String(Math.max(0, Number(data.rtCount) || 0)) };
}

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()));
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
  if (lines.some((line) => line.taxRate && (Number(line.taxRate) < 0 || Number(line.taxRate) > 100))) throw new ActionError("Each line’s tax rate must be between 0 and 100%.");
  const taxAmount = invoiceTax(lines, taxRate);

  return {
    ...data,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    amount: Math.max(0, subtotal + taxAmount - discount).toFixed(2),
  };
}

interface PayrollRules {
  taxRule: SalaryTaxRule;
  employer?: EmployerContribution;
}

/** The payroll rules of the business's country (Tax setup): its salary tax, and what the employer pays on top. Pakistan slabs until a country is chosen. */
async function payrollRules(userId: string): Promise<PayrollRules> {
  const [settings] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  const payroll = packFor(settings?.data.taxCountry)?.payroll;
  return { taxRule: payroll?.incomeTax ?? "pakistan-slabs", employer: payroll?.employer };
}

function normalizePayrollData(data: Record<string, string>, rules: PayrollRules = { taxRule: "pakistan-slabs" }): Record<string, string> {
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
    socialDeduction: data.socialDeduction || "0",
    adjustment: data.adjustment || "0",
    reimbursement: data.reimbursement || "0",
    reimbursedClaims: (data.reimbursedClaims || "").split(",").map((id) => id.trim()).filter(Boolean).join(","),
    description: data.description || "",
  };

  // CNIC and job title are shown on the payslip when known; a new hire can be paid before they are added.
  if (!values.employeeId || !values.employeeName || !values.baseSalary) {
    throw new ActionError("Enter the employee ID, name and base salary.");
  }
  if (values.cnic && !/^\d{5}-?\d{7}-?\d$/.test(values.cnic)) throw new ActionError("Enter a valid 13-digit CNIC, or leave it empty.");
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
    "medicalAllowance", "otherAllowance", "taxDeduction", "advanceDeduction", "loanDeduction", "fineDeduction", "socialDeduction", "adjustment", "reimbursement",
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
  if (calculatePayroll(values, rules.taxRule).payableSalary < 0) throw new ActionError("Deductions exceed the gross salary. Adjust the deductions or adjustment.");

  return serializePayroll(values, rules.taxRule, rules.employer);
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

  // Only record kinds the app knows; the billing record stays out of reports and exports.
  return rows.filter((row) => isRecordKind(row.kind) && canReadKind(me.role, row.kind)).map(serializeRow);
}

/** Logs a payment against an invoice, bill, expense or salary, with the amount of the payment just recorded. */
async function auditPayment(me: Awaited<ReturnType<typeof requireUser>>, kind: string, id: string) {
  const link = { invoices: "invoiceId", bills: "billId", expenses: "expenseId", payroll: "payrollId" }[kind] ?? "";
  const [record] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id))).limit(1);
  const [payment] = link ? await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>${link} = ${id}`))
    .orderBy(desc(bookkeepingRecord.createdAt)).limit(1) : [];
  if (record) await recordAudit(me, "Payment", kind, id, { ...record.data, amount: payment?.data.amount ?? "" });
}

/** Undoing a payment changes the books on the payment's date, so that date must be open. */
async function assertPaymentsOpen(userId: string, link: string, id: string) {
  const payments = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>${link} = ${id}`));
  await assertBooksOpen(userId, ...payments.map((payment) => payment.data.paymentDate));
}

/** Logs an action on a record (conversion, credit, refund, undo…) in the Audit Log. */
async function auditRecord(me: Awaited<ReturnType<typeof requireUser>>, action: string, id: string) {
  const [record] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id))).limit(1);
  if (record) await recordAudit(me, action, record.kind, record.id, record.data);
}

export async function saveBookkeepingRecord(kind: string, input: Record<string, string>, id?: string): Promise<BookkeepingRecord> {
  const saved = await saveRecord(kind, input, id);
  const me = await requireUser();
  await recordAudit(me, id ? "Edited" : "Added", kind, saved.id, saved.data);
  if (kind === "customers" || kind === "vendors") await syncOpeningBalance(me.id, kind, saved);
  // Loan and advance deductions on a salary pay down the employee's salary attachments.
  if (kind === "payroll") await syncAttachmentRepayments(me.id);
  return saved;
}

/**
 * A customer's or supplier's opening balance becomes an "Opening balance" invoice or bill, as in
 * QuickBooks, so it ages, can be paid and shows in A/R and A/P. It posts against opening balance equity.
 * Once anything is paid on it, it is left as it is.
 */
async function syncOpeningBalance(userId: string, kind: "customers" | "vendors", party: BookkeepingRecord) {
  const docKind = kind === "customers" ? "invoices" : "bills";
  const amount = Math.round((Number(party.data.openingBalance) || 0) * 100) / 100;
  const [existing] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, docKind), sql`${bookkeepingRecord.data}->>'openingBalanceFor' = ${party.id}`)).limit(1);
  if (existing && (Number(existing.data.paidAmount) || 0) > 0) return;
  if (amount <= 0) {
    if (existing) await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, existing.id));
    return;
  }
  const date = party.data.openingBalanceDate || new Date().toISOString().slice(0, 10);
  const name = party.data.name || party.data.company || (kind === "customers" ? "Customer" : "Supplier");
  const line = JSON.stringify([{ itemId: "", name: "Opening balance", description: `Opening balance as of ${date}`, quantity: "1", rate: amount.toFixed(2) }]);
  const common = { docType: "Opening balance", openingBalanceFor: party.id, amount: amount.toFixed(2), subtotal: amount.toFixed(2), taxAmount: "0", taxRate: "", lineItems: line, paidAmount: "0", memo: "Opening balance" };
  const data: Record<string, string> = kind === "customers"
    ? { ...(existing?.data ?? {}), ...common, customer: name, customerId: party.id, invoiceNumber: "Opening balance", issueDate: date, dueDate: date, status: "Sent", paymentMethod: "Credit" }
    : { ...(existing?.data ?? {}), ...common, vendor: name, billNumber: "Opening balance", billDate: date, dueDate: date, status: "Open", category: "Opening balance equity", paymentMethod: "Credit" };
  if (existing) await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, existing.id));
  else await db.insert(bookkeepingRecord).values({ userId, kind: docKind, data });
}

async function saveRecord(
  kind: string,
  input: Record<string, string>,
  id?: string,
): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (!isRecordKind(kind)) throw new ActionError("That section isn’t available.");
  if (kind === "reconciliations") throw new ActionError("Completed reconciliations can only be created from the reconciliation screen.");
  if (kind === "team-members") throw new ActionError("Add and change team members from Users & roles.");
  const [current] = id ? await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id))).limit(1) : [];
  if (current?.data.docType === "Opening balance" && (kind === "invoices" || kind === "bills")) throw new ActionError(`Change this opening balance on the ${kind === "invoices" ? "customer" : "supplier"} instead.`);
  // Nothing dated in a closed period can be added or changed.
  await assertBooksOpen(me.id, documentDate(kind, input), documentDate(kind, current?.data));
  let data = amountFromLineItems(sanitizePayload(input), kind);
  data = keepServerOwned(kind, data, current?.data);
  if (kind === "purchase-orders" && !id) data = { ...data, status: "Draft" };
  if (kind === "mileage") {
    const distance = Number(data.distance);
    if (!Number.isFinite(distance) || distance <= 0) throw new ActionError("Enter the distance in km.");
    const rate = Number(data.rate) || 0;
    data = { ...data, tripType: data.tripType || "Business", amount: (distance * Math.max(0, rate)).toFixed(2) };
  }
  if (kind === "time-activities") {
    const hours = Number(data.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new ActionError("Enter the hours worked, up to 24 a day.");
    const billable = data.billable === "true";
    // Billed time keeps its status; otherwise billable time waits to be invoiced.
    data = { ...data, status: data.status === "Billed" ? "Billed" : billable ? "Unbilled" : "Not billable" };
  }
  if (kind === "delayed-charges") {
    const quantity = data.quantity?.trim() ? Number(data.quantity) : 1;
    const rate = Number(data.rate);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ActionError("Enter a quantity greater than zero.");
    if (!Number.isFinite(rate) || rate <= 0) throw new ActionError("Enter a rate greater than zero.");
    // Invoiced charges stay closed; anything else waits for the next invoice.
    data = { ...data, chargeType: data.chargeType === "Credit" ? "Credit" : "Charge", quantity: String(quantity), amount: (quantity * rate).toFixed(2), status: current?.data.status === "Closed" || data.status === "Closed" ? "Closed" : "Open" };
  }
  if (["warehouses", "stock-transfers", "invoices", "supplier-credits"].includes(kind) || data.warehouse?.trim() || data.lineItems?.includes("\"serials\"")) data = await checkStockPlaces(me.id, kind, data, id);
  if (kind === "recurring-transactions") data = recurringTemplateData(me, data);
  // A check is an expense paid from a bank account, with a check number.
  if (kind === "expenses" && data.docType && !["Check", "Credit card credit"].includes(data.docType)) data = { ...data, docType: "" };
  if (kind === "items") {
    if (data.itemType === "Product") data.itemType = "Inventory";
    if (!["Inventory", "Non-inventory", "Service", "Bundle"].includes(data.itemType || "Inventory")) throw new ActionError("Choose Inventory, Non-inventory, Service or Bundle.");
    // Item accounts must be accounts in this chart of accounts.
    const accountIds = [data.incomeAccountId, data.expenseAccountId, data.assetAccountId].filter(Boolean) as string[];
    if (accountIds.length) {
      const found = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"), inArray(bookkeepingRecord.id, accountIds)));
      if (found.length !== new Set(accountIds).size) throw new ActionError("Choose the item's accounts from your chart of accounts.");
    }
    if (data.itemType === "Bundle") {
      // A bundle's price is the total of its parts; it has no stock or accounts of its own.
      let parts: Array<{ itemId: string; quantity: string }> = [];
      try {
        const parsed: unknown = JSON.parse(data.bundleItems || "[]");
        if (Array.isArray(parsed)) parts = parsed.filter((part): part is { itemId: string; quantity: string } => Boolean(part) && typeof part === "object" && typeof (part as Record<string, unknown>).itemId === "string").map((part) => ({ itemId: part.itemId, quantity: String(part.quantity ?? "1") }));
      } catch {
        parts = [];
      }
      parts = parts.filter((part) => part.itemId);
      if (!parts.length) throw new ActionError("Add at least one product or service to the bundle.");
      if (parts.length > 50) throw new ActionError("A bundle can hold up to 50 products and services.");
      if (parts.some((part) => !(Number(part.quantity) > 0))) throw new ActionError("Each product in the bundle needs a quantity greater than zero.");
      const components = await db.select().from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items"), inArray(bookkeepingRecord.id, parts.map((part) => part.itemId))));
      if (components.length !== new Set(parts.map((part) => part.itemId)).size) throw new ActionError("A product in the bundle is no longer in Items & services.");
      if (components.some((component) => component.data.itemType === "Bundle" || component.id === id)) throw new ActionError("A bundle can’t contain another bundle.");
      const price = parts.reduce((sum, part) => sum + (Number(components.find((component) => component.id === part.itemId)?.data.rate) || 0) * Number(part.quantity), 0);
      data = { ...data, bundleItems: JSON.stringify(parts), rate: price.toFixed(2), cost: "", openingQty: "", openingDate: "", reorderPoint: "", incomeAccountId: "", expenseAccountId: "", assetAccountId: "", showComponents: data.showComponents === "false" ? "false" : "true" };
    } else {
      data = { ...data, bundleItems: "", showComponents: "" };
    }
    if (data.itemType !== "Inventory") data = { ...data, assetAccountId: "" };
    data.itemType = data.itemType || "Inventory";
    if (data.openingQty && (!Number.isFinite(Number(data.openingQty)) || Number(data.openingQty) < 0)) throw new ActionError("Enter an initial quantity of zero or more.");
    if (id) {
      // Stock moved by receipts, deliveries and counts is kept on the item; editing its details keeps it.
      const [existing] = await db.select().from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items"))).limit(1);
      if (existing?.data.stock !== undefined) data = { ...data, stock: existing.data.stock };
    } else if (data.itemType === "Inventory" && !data.openingQty) {
      data = { ...data, openingQty: "0" };
    }
    if (data.itemType !== "Inventory") data = { ...data, openingQty: "", openingDate: "" };
    if (data.itemType !== "Bundle" && !(Number(data.rate) >= 0)) throw new ActionError("Enter a sales price of zero or more.");
  }
  if (kind === "customers" || kind === "vendors") {
    // Customer and supplier numbers: the next in the series when left empty, and never used twice.
    const numberKey = partyNumberKey[kind];
    const others = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))).filter((row) => row.id !== id);
    const chosen = (data[numberKey] ?? "").trim();
    if (!chosen) data = { ...data, [numberKey]: nextPartyNumber(kind, others) };
    else if (others.some((row) => (row.data[numberKey] ?? "").trim().toLowerCase() === chosen.toLowerCase())) {
      throw new ActionError(`${kind === "customers" ? "Customer" : "Supplier"} no. ${chosen} is already used. Leave it empty for the next number.`);
    }
  }
  if (kind === "payroll") {
    data = normalizePayrollData(data, await payrollRules(me.id));
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
    if (existing?.data.status === "Paid" || existing?.data.status === "Partially Paid") {
      data = {
        ...data,
        status: existing.data.status,
        paidAmount: existing.data.paidAmount || "",
        paidDate: existing.data.paidDate || "",
        paymentAccountId: existing.data.paymentAccountId || "",
        paymentAccountName: existing.data.paymentAccountName || "",
        paymentMethod: existing.data.paymentMethod || "",
      };
    }
  }
  if (kind === "invoices") {
    // A sales receipt is a sale paid in full on the spot, deposited straight to an account.
    if (data.docType && data.docType !== "Sales receipt") data = { ...data, docType: "" };
    if (data.docType === "Sales receipt") {
      if (!id && (!data.paymentMethod || data.paymentMethod === "Credit")) throw new ActionError("Choose the account this sales receipt was deposited to.");
      data = { ...data, paymentTerms: "Due on receipt", amountPaid: "" };
    }
    const paymentTerms = data.paymentTerms || "30 days";
    if (!["Due on receipt", "15 days", "30 days", "60 days"].includes(paymentTerms)) throw new ActionError("Choose one of the available payment terms.");
    const calculatedDueDate = dueDateForTerms(data.issueDate ?? "", paymentTerms);
    if (!calculatedDueDate) throw new ActionError("Choose an issue date and valid payment terms.");
    data = { ...data, paymentTerms, dueDate: calculatedDueDate };
  }
  if (!id && (kind === "bills" || kind === "supplier-credits") && !data.status) data = { ...data, status: "Open" };
  // A bill waiting for approval stays that way until someone who can approve it does.
  if (id && kind === "bills" && current?.data.status === "Pending approval" && data.status !== "Pending approval" && !(await canApproveTransactions(me))) {
    data = { ...data, status: "Pending approval" };
  }
  // With bill approval on (Settings > Expenses), a new bill waits for someone who can approve it.
  if (!id && kind === "bills" && data.status === "Open" && (await settingsOf(me.id)).requireBillApproval === "On" && !(await canApproveTransactions(me))) {
    data = { ...data, status: "Pending approval" };
  }
  if (!id && (kind === "invoices" || kind === "bills")) {
    const selectedAccountId = data.paymentMethod || "Credit";
    let paymentMethod = "Credit";
    if (selectedAccountId !== "Credit") {
      const [paymentAccount] = await db
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"), eq(bookkeepingRecord.id, selectedAccountId)))
        .limit(1);
      // Money received can also wait in Undeposited funds until it is banked with a bank deposit.
      const accountType = paymentAccount ? (kind === "invoices" ? receivingAccountType : paymentAccountType)({ kind: "accounts", data: paymentAccount.data }) : null;
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
      // Part of the total can be received or paid now; the rest stays open.
      const paidNow = paymentAmount(data.amountPaid, amount, kind === "invoices" ? "this invoice" : "this bill");
      data = { ...data, paidAmount: paidNow.toFixed(2), status: paidNow >= amount - 0.005 ? "Paid" : "Partially Paid" };
    }
    const { amountPaid: _amountPaid, ...withoutAmountPaid } = data;
    data = withoutAmountPaid;
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
    else if (!data.category && data.type !== "Deposit") {
      // No bank rule fits: money paid to a supplier named in the line goes to their default category.
      const [vendors, accounts] = await Promise.all([
        db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "vendors"))),
        db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"))),
      ]);
      const fromSupplier = supplierCategoryForBankLine(data.description, vendors, accounts);
      if (fromSupplier) data = { ...data, category: fromSupplier.category, ruleApplied: `Supplier: ${fromSupplier.supplier}` };
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
  if (kind === "bills" && data.paymentMethod && data.paymentMethod !== "Credit" && Number(data.paidAmount) > 0) {
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "payments",
      data: {
        billId: created.id,
        billNumber: data.billNumber ?? "Bill",
        vendor: data.vendor ?? "",
        amount: data.paidAmount ?? "0",
        paymentDate: data.billDate || new Date().toISOString().slice(0, 10),
        method: data.paymentMethod,
        paymentAccountId: data.paymentAccountId ?? "",
        paymentAccountName: data.paymentAccountName ?? "",
        direction: "out",
      },
    });
  }
  if (kind === "invoices" && data.paymentMethod && data.paymentMethod !== "Credit") {
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "payments",
      data: {
        invoiceId: created.id,
        invoiceNumber: data.invoiceNumber ?? "Invoice",
        customer: data.customer ?? "",
        amount: data.paidAmount ?? data.amount ?? "0",
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

    data.itemType = !data.itemType || data.itemType === "Product" ? "Inventory" : data.itemType;
    if (!data.name) throw new ActionError(`Add a name on spreadsheet row ${entry.rowNumber}.`);
    if (!["Inventory", "Non-inventory", "Service"].includes(data.itemType)) throw new ActionError(`Choose Inventory, Non-inventory or Service on spreadsheet row ${entry.rowNumber}.`);
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
  const rules = await payrollRules(me.id);
  if (input.length > 2_000_000) throw new ActionError("The payroll CSV is too large. Keep it under 2 MB.");
  const [rawHeaders, ...rows] = parseCsv(input);
  if (!rawHeaders || !rows.length) throw new ActionError("The payroll CSV needs a header row and at least one employee.");
  if (rows.length > 500) throw new ActionError("Import up to 500 payroll rows at a time.");

  const headerIndexes = new Map(rawHeaders.map((header, index) => [header.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""), index]));
  const requiredFields: (keyof PayrollValues)[] = ["employeeId", "employeeName", "month", "baseSalary", "workingDays", "workedDays"];
  const missingFields = requiredFields.filter((fieldName) => !headerIndexes.has(fieldName.toLowerCase()));
  if (missingFields.length) throw new ActionError(`The payroll CSV is missing these columns: ${missingFields.join(", ")}.`);

  const imported = rows.map((row, index) => {
    const payload: Record<string, string> = {};
    for (const fieldName of payrollCsvFields) {
      const columnIndex = headerIndexes.get(fieldName.toLowerCase());
      if (columnIndex !== undefined) payload[fieldName] = row[columnIndex] ?? "";
    }
    try {
      return normalizePayrollData(payload, rules);
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

  await syncAttachmentRepayments(me.id);
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
  assertNotViewing(me);
  const email = recipient.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("Enter a valid recipient email address.");
  const [budgetRow] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "budgets")))
    .limit(1);
  if (!budgetRow) throw new ActionError("That budget wasn’t found. Save it and try again.");

  const budget = serializeRow(budgetRow);
  // Everything the books are built from, so the emailed actuals match the budget screen and the Profit and Loss.
  const sourceRows = await db.select().from(bookkeepingRecord).where(eq(bookkeepingRecord.userId, me.id));
  const records = sourceRows.filter((row) => isRecordKind(row.kind) && row.kind !== "budgets").map(serializeRow);
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  const budgetData = recordsWithinBudgetDates(records.filter((record) => ["invoices", "bills", "expenses", "payroll"].includes(record.kind)), budget.data.startDate ?? "", budget.data.endDate ?? "");
  const books = { ledger: buildLedger(records, settings.accountingMethod === "Cash" ? "cash" : "accrual"), records, startDate: budget.data.startDate ?? "", endDate: budget.data.endDate ?? "" };
  const lines = parseBudgetLines(budget.data.lines).map((line) => resolveBudgetLineAccount(line, records));
  const actualOf = (line: BudgetLine) => budgetActual(line, budgetData, settings.currency || "", books);
  const currency = budget.data.currency || settings.currency || "USD";
  const formatAmount = (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };
  const rows = lines.map((line) => {
    const actual = actualOf(line);
    const variance = budgetVariance(line, actual);
    return `<tr><td>${escapeBudgetHtml(line.category)}</td><td>${escapeBudgetHtml(line.budgetHead)}</td><td>${formatAmount(Number(line.expected) || 0)}</td><td>${formatAmount(actual)}</td><td>${formatAmount(variance)}</td><td>${escapeBudgetHtml(line.description)}</td></tr>`;
  }).join("");
  const subject = `Budget: ${budget.data.name || "Budget"}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#13263b;max-width:900px;margin:0 auto"><h1>${escapeBudgetHtml(subject)}</h1><p>${escapeBudgetHtml(budget.data.period || "Custom")} · ${escapeBudgetHtml(budget.data.startDate || "")} to ${escapeBudgetHtml(budget.data.endDate || "")}</p><p>${escapeBudgetHtml(budget.data.description || "Budget overview")}</p><p>Positive variance means favorable: under plan for expenses or above plan for income.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Category</th><th align="left">Budget Head</th><th align="right">Expected</th><th align="right">Actual</th><th align="right">Variance</th><th align="left">Description</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th align="left" colspan="2">Totals</th><th align="right">${formatAmount(budgetExpectedTotal(lines))}</th><th align="right">${formatAmount(lines.reduce((sum, line) => sum + actualOf(line), 0))}</th><th align="right">${formatAmount(lines.reduce((sum, line) => sum + budgetVariance(line, actualOf(line)), 0))}</th><td></td></tr></tfoot></table></div>`;
  await sendEmailOrThrow({ to: email, subject, html, fromName: "MIKLEDGER" });
}

export async function deleteBookkeepingRecord(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  const [before] = isRecordKind(kind) ? await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind))).limit(1) : [];
  await deleteRecord(kind, id);
  if (before) await recordAudit(me, "Deleted", kind, id, before.data);
  if (kind === "payroll") await syncAttachmentRepayments(me.id);
}

async function deleteRecord(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (!isRecordKind(kind)) throw new ActionError("That section isn’t available.");
  if (kind === "reconciliations") throw new ActionError("Completed reconciliations can’t be deleted.");
  if (kind === "team-members") throw new ActionError("Remove team members from Users & roles.");
  const [toDelete] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind))).limit(1);
  await assertBooksOpen(me.id, documentDate(kind, toDelete?.data));
  if (kind === "deposits") throw new ActionError("Delete deposits from Bank deposits, so their payments go back to Undeposited funds.");
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
      // A deleted bill or expense takes its payments with it, so they don't linger in banking and reports.
      await transaction.delete(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>${kind === "bills" ? "billId" : "expenseId"} = ${record.id}`));
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
  if (kind === "credit-notes" || kind === "supplier-credits") await releaseAppliedCredit(me.id, kind, id);
  if (kind === "purchase-orders") await removeOrderReceipts(me.id, id);
  // A deleted invoice puts its delayed charges and billed time back to be invoiced again.
  if (kind === "invoices") {
    const linked = await db.select().from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["delayed-charges", "time-activities"]), sql`${bookkeepingRecord.data}->>'invoiceId' = ${id}`));
    for (const row of linked) {
      const { invoiceId: _invoiceId, invoiceNumber: _invoiceNumber, ...rest } = row.data;
      await db.update(bookkeepingRecord).set({ data: { ...rest, status: row.kind === "delayed-charges" ? "Open" : "Unbilled" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
    }
  }
  const [deleted] = await db
    .delete(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind)))
    .returning({ id: bookkeepingRecord.id });
  if (!deleted) throw new ActionError("We couldn’t find that record. Refresh and try again.");
  // A deleted invoice or salary takes its payments with it, so they don't linger in banking and reports.
  if (kind === "invoices" || kind === "payroll") {
    await db.delete(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>${kind === "invoices" ? "invoiceId" : "payrollId"} = ${id}`));
  }
  revalidatePath("/app", "layout");
}

/** Deleting an applied credit gives the invoice or bill its balance back. */
async function releaseAppliedCredit(userId: string, kind: "credit-notes" | "supplier-credits", id: string) {
  const [credit] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind))).limit(1);
  const applied = Number(credit?.data.appliedAmount) || 0;
  if (!credit || credit.data.status !== "Applied" || applied <= 0) return;
  const targetKind = kind === "credit-notes" ? "invoices" : "bills";
  const targetId = kind === "credit-notes" ? credit.data.appliedInvoiceId : credit.data.appliedBillId;
  const numberKey = kind === "credit-notes" ? "invoiceNumber" : "billNumber";
  const candidates = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, targetKind)));
  const target = candidates.find((row) => (targetId ? row.id === targetId : Boolean(credit.data[numberKey]) && row.data[numberKey] === credit.data[numberKey]));
  if (!target) return;
  const creditApplied = Math.max(0, (Number(target.data.creditApplied) || 0) - applied);
  const paid = Number(target.data.paidAmount) || 0;
  const settled = paid + creditApplied >= (Number(target.data.amount) || 0) - 0.005;
  const status = target.data.status === "Paid" && !settled ? (paid > 0 ? "Partially Paid" : targetKind === "invoices" ? "Sent" : "Open") : target.data.status;
  await db.update(bookkeepingRecord).set({ data: { ...target.data, creditApplied: creditApplied.toFixed(2), status }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, target.id));
}

/** Deleting a purchase order takes back the stock its receipt added. */
async function removeOrderReceipts(userId: string, orderId: string) {
  const receipts = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "inventory-movements"))))
    .filter((row) => row.data.purchaseOrderId === orderId);
  for (const receipt of receipts) {
    const [item] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, receipt.data.itemId ?? ""), eq(bookkeepingRecord.userId, userId))).limit(1);
    if (item) await db.update(bookkeepingRecord).set({ data: { ...item.data, stock: String((Number(item.data.stock) || 0) - (Number(receipt.data.change) || 0)) }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, item.id));
    await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, receipt.id));
  }
}

export async function recordInvoicePayment(
  id: string,
  amountInput: string,
  paymentDate: string,
  accountId: string,
  reference = "",
  exchangeRate = "",
): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Enter a payment amount greater than zero.");
  await assertBooksOpen(me.id, paymentDate);

  const [paymentAccount] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, accountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")))
    .limit(1);
  const method = paymentAccount ? receivingAccountType({ kind: "accounts", data: paymentAccount.data }) : null;
  if (!paymentAccount || !method) throw new ActionError("Choose a Cash, Bank, or Credit card account, or Undeposited funds, from Chart of Accounts.");

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
      ...(typeof reference === "string" && reference.trim() ? { referenceNumber: reference.trim().slice(0, 120) } : {}),
      ...paymentRate(data, exchangeRate),
    },
  });
  await auditPayment(me, "invoices", id);
  if (updatedData.status === "Paid" && data.crmDealId) await markDealWon(me.id, me.name, data.crmDealId, data.invoiceNumber || "the invoice");
  revalidatePath("/app", "layout");
}

/** A deal whose invoice is paid in full is won, as in Zoho CRM. Closed deals are left alone. */
async function markDealWon(userId: string, actor: string, dealId: string, invoiceNumber: string) {
  const [deal] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, dealId), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "crm-deals"))).limit(1);
  if (!deal || (deal.data.stage ?? "").startsWith("Closed")) return;
  let history: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(deal.data.history || "[]");
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    history = [];
  }
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = { at, by: actor, text: `Stage changed from “${deal.data.stage || "—"}” to “Closed Won” when ${invoiceNumber} was paid` };
  await db.update(bookkeepingRecord).set({
    data: { ...deal.data, stage: "Closed Won", probability: "100", expectedRevenue: deal.data.amount || "0", closedOn: at.slice(0, 10), history: JSON.stringify([entry, ...history].slice(0, 40)) },
    updatedAt: new Date(),
  }).where(eq(bookkeepingRecord.id, deal.id));
}

/**
 * Removes every payment recorded against an invoice, so a paid invoice can be
 * corrected and paid again (for example into a different account).
 */
export async function undoInvoicePayments(id: string): Promise<void> {
  const me = await requireUser();
  await assertPaymentsOpen(me.id, "invoiceId", id);
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
  await auditRecord(me, "Payment removed", id);
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

/** The amount being paid: the whole remaining balance when left blank, otherwise a positive amount no larger than it. */
function paymentAmount(input: string | undefined, remaining: number, label: string) {
  if (input === undefined || input.trim() === "") return Math.round(remaining * 100) / 100;
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) throw new ActionError("Enter an amount greater than zero.");
  if (value > remaining + 0.005) throw new ActionError(`That is more than the ${remaining.toFixed(2)} still to pay on ${label}.`);
  return Math.round(value * 100) / 100;
}

/** Quantity on hand for every inventory item, worked out from the documents that move stock. */
async function stockOnHand(userId: string) {
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, [...inventoryKinds])));
  const summaries = buildInventory(rows.map(serializeRow));
  return new Map([...summaries].map(([id, summary]) => [id, summary.onHand]));
}

/** A foreign-currency payment keeps the day's exchange rate, so the books can show the gain or loss against the document's rate. */
function paymentRate(document: Record<string, string>, exchangeRate: string): Record<string, string> {
  if (!document.currency || !exchangeRate.trim()) return {};
  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new ActionError("Enter an exchange rate greater than zero.");
  return Number(document.exchangeRate || 1) === rate ? {} : { exchangeRate: String(rate) };
}

/**
 * Warehouses, transfers and serial numbers: a warehouse named on a document must
 * exist, a transfer moves stock that is there, and serial numbers match the quantity.
 */
async function checkStockPlaces(userId: string, kind: string, data: Record<string, string>, id?: string): Promise<Record<string, string>> {
  // Stock leaving a warehouse (transfers, sales, returns to suppliers) needs the whole stock picture.
  const outgoing = ["stock-transfers", "invoices", "supplier-credits"].includes(kind);
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, ["warehouses", "items", ...(outgoing ? [...inventoryKinds, "stock-transfers"] : [])])));
  const records = rows.map(serializeRow);
  const warehouses = records.filter((row) => row.kind === "warehouses" && row.data.name?.trim());
  const known = (name: string | undefined) => warehouses.some((row) => row.data.name.trim().toLowerCase() === (name ?? "").trim().toLowerCase());
  if (kind === "warehouses") {
    if (warehouses.some((row) => row.id !== id && row.data.name.trim().toLowerCase() === (data.name ?? "").trim().toLowerCase())) throw new ActionError(`There's already a warehouse called ${data.name}.`);
    return data;
  }
  if (kind !== "stock-transfers" && data.warehouse?.trim() && !known(data.warehouse)) throw new ActionError(`Choose a warehouse from Inventory > Warehouses.`);
  const items = records.filter((row) => row.kind === "items");
  if (kind !== "stock-transfers") {
    for (const line of parseInvoiceLines(data.lineItems ?? "")) {
      const item = items.find((row) => row.id === line.itemId);
      if (item?.data.tracking !== "Serial number" || !line.serials) continue;
      const count = serialList(line.serials).length;
      if (count !== Number(line.quantity)) throw new ActionError(`${item.data.name}: enter ${Number(line.quantity)} serial ${Number(line.quantity) === 1 ? "number" : "numbers"}, one per unit (${count} given).`);
    }
    // With warehouses, a sale or a return to a supplier can only take what that warehouse holds,
    // and only serial numbers that are in stock there. Drafts don't move stock, so they aren't checked.
    if (outgoing && warehouses.length && !["Draft", "Cancelled", "Void", "Pending approval"].includes(data.status ?? "")) {
      const others = records.filter((row) => row.id !== id);
      const place = data.warehouse?.trim() || defaultWarehouse(others);
      const date = (kind === "invoices" ? data.issueDate : data.date) || "9999-12-31";
      const stock = stockByWarehouse(others, date);
      const lots = lotRegister(others);
      const wanted = new Map<string, number>();
      for (const line of parseInvoiceLines(data.lineItems ?? "")) {
        const item = items.find((row) => row.id === line.itemId);
        if (!item || !isInventoryItem(item) || item.data.itemType === "Bundle") continue;
        wanted.set(item.id, (wanted.get(item.id) ?? 0) + (Number(line.quantity) || 0));
        if (item.data.tracking === "Serial number") {
          for (const serial of serialList(line.serials)) {
            const lot = lots.find((entry) => entry.itemId === item.id && entry.number.toLowerCase() === serial.toLowerCase());
            if (!lot || lot.onHand <= 0) throw new ActionError(`${item.data.name}: serial number ${serial} isn't in stock.`);
            if (lot.warehouse.toLowerCase() !== place.toLowerCase()) throw new ActionError(`${item.data.name}: serial number ${serial} is in ${lot.warehouse}, not ${place}.`);
          }
        }
      }
      for (const [itemId, quantity] of wanted) {
        const available = stock.get(itemId)?.get(place) ?? 0;
        if (quantity > available + 1e-9) throw new ActionError(`Only ${available} of ${items.find((row) => row.id === itemId)?.data.name ?? "this item"} ${available === 1 ? "is" : "are"} in ${place}. Choose another warehouse, transfer stock, or save as a draft.`);
      }
    }
    return data;
  }
  const item = items.find((row) => isInventoryItem(row) && (row.id === data.itemId || row.data.name?.trim().toLowerCase() === (data.item ?? "").trim().toLowerCase()));
  if (!item) throw new ActionError("Choose an inventory product to move.");
  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ActionError("Enter a quantity greater than zero.");
  if (!known(data.fromWarehouse) || !known(data.toWarehouse)) throw new ActionError("Choose both warehouses from Inventory > Warehouses.");
  if (data.fromWarehouse.trim().toLowerCase() === data.toWarehouse.trim().toLowerCase()) throw new ActionError("Choose two different warehouses.");
  if (item.data.tracking === "Serial number" && data.serials?.trim() && serialList(data.serials).length !== quantity) throw new ActionError(`Enter ${quantity} serial numbers, one per unit.`);
  // Only stock that is in the "from" warehouse on that day can move.
  const available = stockByWarehouse(records.filter((row) => row.id !== id), data.date || "9999-12-31").get(item.id)?.get(data.fromWarehouse.trim()) ?? 0;
  if (quantity > available + 1e-9) throw new ActionError(`Only ${available} of ${item.data.name} ${available === 1 ? "is" : "are"} in ${data.fromWarehouse} on ${data.date}.`);
  return { ...data, item: item.data.name ?? data.item, itemId: item.id, quantity: String(quantity) };
}

function isPaymentDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Pays all or part of a bill's remaining balance from a Cash, Bank or Credit card account and records where it came from. */
export async function recordBillPayment(id: string, paymentDate: string, accountId: string, amountInput?: string, reference = "", exchangeRate = ""): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "bills");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  await assertBooksOpen(me.id, paymentDate);
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
    if (bill.data.status === "Pending approval") throw new ActionError(`${bill.data.billNumber || "This bill"} is waiting for approval and can’t be paid yet.`);
    const paid = Number(bill.data.paidAmount) || 0;
    const due = (Number(bill.data.amount) || 0) - paid - (Number(bill.data.creditApplied) || 0);
    if (due <= 0.005) throw new ActionError(`${bill.data.billNumber || "This bill"} is already paid.`);
    const amount = paymentAmount(amountInput, due, bill.data.billNumber || "this bill");
    await transaction
      .update(bookkeepingRecord)
      .set({
        data: { ...bill.data, paidAmount: (paid + amount).toFixed(2), status: amount >= due - 0.005 ? "Paid" : "Partially Paid", paymentMethod: method, paymentAccountId: account.id, paymentAccountName: name, paymentDate },
        updatedAt: new Date(),
      })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
    await transaction.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "payments",
      data: { billId: id, billNumber: bill.data.billNumber ?? "Bill", vendor: bill.data.vendor ?? "", amount: amount.toFixed(2), paymentDate, method, paymentAccountId: account.id, paymentAccountName: name, direction: "out", ...(typeof reference === "string" && reference.trim() ? { referenceNumber: reference.trim().slice(0, 120) } : {}), ...paymentRate(bill.data, exchangeRate) },
    });
  });
  await auditPayment(me, "bills", id);
  revalidatePath("/app", "layout");
}

/** Removes the payments recorded on a bill so it can be corrected and paid again. */
export async function undoBillPayments(id: string): Promise<void> {
  const me = await requireUser();
  await assertPaymentsOpen(me.id, "billId", id);
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
  await auditRecord(me, "Payment removed", id);
  revalidatePath("/app", "layout");
}

interface PaymentAllocation {
  id: string;
  amount: string;
}

function readAllocations(input: unknown, noun: string): PaymentAllocation[] {
  if (!Array.isArray(input)) throw new ActionError(`Choose the ${noun} to pay.`);
  const allocations = input.flatMap((entry): PaymentAllocation[] => {
    if (!entry || typeof entry !== "object") return [];
    const { id, amount } = entry as Record<string, unknown>;
    return typeof id === "string" && typeof amount === "string" && Number(amount) > 0 ? [{ id, amount }] : [];
  });
  if (!allocations.length) throw new ActionError(`Enter a payment against at least one ${noun.replace(/s$/, "")}.`);
  if (allocations.length > 100) throw new ActionError(`Pay up to 100 ${noun} at a time.`);
  if (new Set(allocations.map((entry) => entry.id)).size !== allocations.length) throw new ActionError(`Each ${noun.replace(/s$/, "")} can be listed once.`);
  return allocations;
}

/** Receive payment, as in QuickBooks: one customer payment applied across their open invoices. */
export async function receiveCustomerPayment(paymentDate: string, accountId: string, reference: string, allocationsInput: unknown): Promise<void> {
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  const allocations = readAllocations(allocationsInput, "invoices");
  for (const allocation of allocations) await recordInvoicePayment(allocation.id, allocation.amount, paymentDate, accountId, reference);
}

/** Pay bills, as in QuickBooks: several supplier bills paid from one account on one date. */
export async function payBills(paymentDate: string, accountId: string, reference: string, allocationsInput: unknown): Promise<void> {
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  const allocations = readAllocations(allocationsInput, "bills");
  for (const allocation of allocations) await recordBillPayment(allocation.id, paymentDate, accountId, allocation.amount, reference);
}

/** Records all or part of an expense as paid from a Cash, Bank or Credit card account. */
export async function recordExpensePayment(id: string, paymentDate: string, accountId: string, amountInput?: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "expenses");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  await assertBooksOpen(me.id, paymentDate);
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  const [expense] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "expenses")))
    .limit(1);
  if (!expense) throw new ActionError("We couldn’t find that expense. Refresh and try again.");
  if (expense.data.status === "Paid") throw new ActionError(`${expense.data.description || "This expense"} is already paid.`);
  const total = Number(expense.data.amount) || 0;
  const paid = Number(expense.data.paidAmount) || 0;
  const amount = paymentAmount(amountInput, total - paid, expense.data.referenceNumber || "this expense");
  const fullyPaid = paid + amount >= total - 0.005;
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...expense.data, status: fullyPaid ? "Paid" : "Partially Paid", paidAmount: (paid + amount).toFixed(2), paymentAccount: `${method} · ${name}`, paymentAccountId: account.id, paymentDate }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "payments",
    data: { expenseId: id, reference: expense.data.referenceNumber ?? "", vendor: expense.data.payee ?? "", amount: amount.toFixed(2), paymentDate, method, paymentAccountId: account.id, paymentAccountName: name, direction: "out" },
  });
  await auditPayment(me, "expenses", id);
  revalidatePath("/app", "layout");
}

/** Records all or part of a salary as paid from a Cash, Bank or Credit card account. */
export async function recordPayrollPayment(id: string, paymentDate: string, accountId: string, amountInput?: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  if (!isPaymentDate(paymentDate)) throw new ActionError("Choose a payment date.");
  await assertBooksOpen(me.id, paymentDate);
  const { account, method, name } = await findPaymentAccount(me.id, accountId);
  const [entry] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .limit(1);
  if (!entry) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
  if (entry.data.status === "Paid") throw new ActionError(`${entry.data.employeeName || "This salary"} is already paid.`);
  const payable = Number(entry.data.payableSalary) || 0;
  const paid = Number(entry.data.paidAmount) || 0;
  const amount = paymentAmount(amountInput, payable - paid, `${entry.data.employeeName || "this"}'s salary`);
  const fullyPaid = paid + amount >= payable - 0.005;
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...entry.data, status: fullyPaid ? "Paid" : "Partially Paid", paidAmount: (paid + amount).toFixed(2), paidDate: paymentDate, paymentAccountId: account.id, paymentAccountName: name, paymentMethod: method }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await db.insert(bookkeepingRecord).values({
    userId: me.id,
    kind: "payments",
    data: { payrollId: id, reference: entry.data.reference ?? "", employee: entry.data.employeeName ?? "", amount: amount.toFixed(2), paymentDate, method, paymentAccountId: account.id, paymentAccountName: name, direction: "out" },
  });
  // The salary's loan deduction pays down the employee's HR loans once the salary is fully paid.
  await syncAttachmentRepayments(me.id);
  await auditPayment(me, "payroll", id);
  revalidatePath("/app", "layout");
}

const payrollLiabilityAccounts: Record<PayrollLiabilityKind, { test: RegExp; name: string; label: string }> = {
  withheld: { test: /payroll/i, name: "Payroll liabilities", label: "Tax and deductions withheld from salaries" },
  employer: { test: /employer contributions owed/i, name: "Payroll liabilities", label: "Employer contributions" },
  attachments: { test: /attachment|garnish|child support/i, name: "Salary attachments payable", label: "Salary attachments kept back for creditors" },
};

/**
 * Pays over what payroll owes onwards: income tax and other deductions kept
 * back from salaries, the employer's contributions, or salary attachments
 * owed to a creditor or court. Saved as an expense against the liability
 * account, so the books show the amount as paid and no longer owed.
 */
export async function payPayrollLiabilities(input: { kind: PayrollLiabilityKind; date: string; accountId: string; amount: string; payee: string; memo?: string }): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "payroll");
  const target = payrollLiabilityAccounts[input.kind];
  if (!target) throw new ActionError("Choose what you are paying.");
  if (!isPaymentDate(input.date)) throw new ActionError("Choose a payment date.");
  await assertBooksOpen(me.id, input.date);
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new ActionError("Enter an amount greater than zero.");
  const payee = input.payee.trim();
  if (!payee) throw new ActionError("Enter who you are paying, such as the tax authority.");
  const { account, method, name } = await findPaymentAccount(me.id, input.accountId);
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["accounts", "settings"])));
  const liabilities = rows.filter((row) => row.kind === "accounts" && /^liability$/i.test(row.data.type ?? ""));
  // The same account the books keep the amount in until it is paid.
  const payrollAccount = liabilities.find((row) => /payroll/i.test(`${row.data.name} ${row.data.detailType}`));
  const found = input.kind === "withheld" ? payrollAccount : liabilities.find((row) => target.test.test(row.data.name ?? "")) ?? (input.kind === "employer" ? payrollAccount : undefined);
  let liability = found?.data.name?.trim() || found?.data.code?.trim() || "";
  if (!liability) {
    liability = target.name;
    if (!liabilities.some((row) => (row.data.name ?? "").trim().toLowerCase() === liability.toLowerCase())) {
      await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "accounts", data: { name: liability, type: "Liability", accountType: "Current liabilities", detailType: input.kind === "attachments" ? "Other current liabilities" : "Payroll tax payable" } });
    }
  }
  const currency = rows.find((row) => row.kind === "settings")?.data.currency || "USD";
  const data = amountFromLineItems({
    payee,
    expenseDate: input.date,
    currency,
    exchangeRate: "1",
    lineItems: JSON.stringify([{ itemId: "", name: liability, description: target.label, quantity: "1", rate: amount.toFixed(2) }]),
    memo: input.memo?.trim() || target.label,
    payrollLiability: input.kind,
    paymentAccountId: account.id,
    paymentAccountName: name,
    paymentMethod: method === "Bank" ? "Bank transfer" : method,
  }, "expenses");
  const [created] = await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "expenses", data: data }).returning({ id: bookkeepingRecord.id });
  await auditRecord(me, "Created", created.id);
  revalidatePath("/app", "layout");
}

/** Clears the payment recorded on a salary so it shows as unpaid again. */
export async function undoPayrollPayment(id: string): Promise<void> {
  const me = await requireUser();
  await assertPaymentsOpen(me.id, "payrollId", id);
  assertCanWrite(me, "payroll");
  const [entry] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .limit(1);
  if (!entry) throw new ActionError("We couldn’t find that payroll entry. Refresh and try again.");
  await db
    .delete(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'payrollId' = ${id}`));
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...entry.data, status: "Unpaid", paidAmount: "0", paidDate: "" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await syncAttachmentRepayments(me.id);
  await auditRecord(me, "Payment removed", id);
  revalidatePath("/app", "layout");
}

/** Clears the payment recorded on an expense so it can be paid from another account. */
export async function undoExpensePayment(id: string): Promise<void> {
  const me = await requireUser();
  await assertPaymentsOpen(me.id, "expenseId", id);
  assertCanWrite(me, "expenses");
  const [expense] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "expenses")))
    .limit(1);
  if (!expense) throw new ActionError("We couldn’t find that expense. Refresh and try again.");
  await db
    .delete(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payments"), sql`${bookkeepingRecord.data}->>'expenseId' = ${id}`));
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...expense.data, status: "Unpaid", paidAmount: "0", paymentAccount: "", paymentAccountId: "", paymentDate: "" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await auditRecord(me, "Payment removed", id);
  revalidatePath("/app", "layout");
}

/** Records a supplier credit note as refunded into a Cash, Bank or Credit card account. */
export async function refundSupplierCredit(id: string, refundDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "supplier-credits");
  if (!isPaymentDate(refundDate)) throw new ActionError("Choose a refund date.");
  await assertBooksOpen(me.id, refundDate);
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
  await auditRecord(me, "Refunded", id);
  revalidatePath("/app", "layout");
}

/**
 * QuickBooks' Void: the document stays on file, marked Void, but no longer counts in the books.
 * Payments and applied credits must be removed first, so nothing is left pointing at it.
 */
export async function voidBookkeepingRecord(kind: string, id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, kind);
  if (!["invoices", "bills", "expenses", "credit-notes", "supplier-credits"].includes(kind)) throw new ActionError("This can’t be voided.");
  const [row] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, kind))).limit(1);
  if (!row) throw new ActionError("We couldn’t find that record. Refresh and try again.");
  if (row.data.status === "Void") throw new ActionError("This is already void.");
  if (row.data.docType === "Opening balance") throw new ActionError("Change the opening balance on the customer or supplier instead.");
  await assertBooksOpen(me.id, documentDate(kind, row.data));
  if ((Number(row.data.paidAmount) || 0) > 0) throw new ActionError("Undo its payments first, then void it.");
  if ((Number(row.data.creditApplied) || 0) > 0) throw new ActionError("A credit is applied to it. Delete or unapply the credit first.");
  if (["Applied", "Refunded"].includes(row.data.status ?? "")) throw new ActionError(`This credit has been ${row.data.status?.toLowerCase()}, so it can’t be voided.`);
  const data = { ...row.data, status: "Void", statusBeforeVoid: row.data.status ?? "", voidedAt: new Date().toISOString().slice(0, 10), voidedBy: me.name ?? "" };
  await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
  await recordAudit(me, "Voided", kind, row.id, data);
  revalidatePath("/app", "layout");
}

async function settingsOf(userId: string) {
  const [settings] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  return settings?.data ?? {};
}

/** Admins, and team members marked "Can approve transactions", approve bills. */
async function canApproveTransactions(me: Awaited<ReturnType<typeof requireUser>>) {
  if (me.role === "Admin") return true;
  const members = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "team-members")));
  const email = (me.email ?? "").trim().toLowerCase();
  return members.some((member) => member.data.email?.trim().toLowerCase() === email && member.data.canApprove === "true" && member.data.enabled !== "false");
}

/** Approves a bill waiting for approval, so it counts in the books and can be paid. */
export async function approveBill(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "bills");
  if (!(await canApproveTransactions(me))) throw new ActionError("Only an Admin or a team member who can approve transactions can approve bills.");
  const [bill] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "bills"))).limit(1);
  if (!bill) throw new ActionError("We couldn’t find that bill. Refresh and try again.");
  if (bill.data.status !== "Pending approval") throw new ActionError("This bill isn’t waiting for approval.");
  await assertBooksOpen(me.id, bill.data.billDate);
  const data = { ...bill.data, status: "Open", approvedBy: me.name ?? "", approvedAt: new Date().toISOString().slice(0, 10) };
  await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, bill.id));
  await recordAudit(me, "Approved", "bills", bill.id, data);
  revalidatePath("/app", "layout");
}

/** The next number in a series, e.g. INV-0012 → INV-0013, so converted documents follow on. */
async function nextDocumentNumber(executor: Pick<typeof db, "select">, userId: string, kind: RecordKind, key: string, prefix: string) {
  const rows = await executor.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind)));
  // Up to six digits: older documents numbered from a timestamp don't push the series to huge numbers.
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{1,6})$`);
  const highest = rows.reduce((max, row) => Math.max(max, Number(pattern.exec(row.data[key] ?? "")?.[1] ?? 0)), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export async function convertBookkeepingRecord(id: string, target?: string, percent?: number): Promise<void> {
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
    // Progress invoicing (QuickBooks): invoice part of an estimate now and the rest later.
    const alreadyInvoiced = Number(source.data.invoicedPercent || 0);
    const progress = percent === undefined ? 0 : Number(percent);
    if (percent !== undefined) {
      if (sourceKind !== "estimates" || targetKind !== "invoices") throw new ActionError("Only an estimate can be invoiced in parts.");
      if (!Number.isFinite(progress) || progress <= 0 || progress > 100 - alreadyInvoiced + 0.001) throw new ActionError(`Choose a percent between 1 and ${Math.max(0, 100 - alreadyInvoiced)}.`);
    }
    const targetCount = targetKind === "estimates" || targetKind === "sales-orders"
      ? (await transaction.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, targetKind)))).length
      : 0;
    if (sourceKind === "purchase-orders") {
      if (source.data.convertedRecordId || source.data.convertedKind) {
        throw new ActionError("This purchase order has already been recorded as a bill or expense.");
      }
      if (source.data.status === "Partially received") throw new ActionError("Part of this order is still to come. Receive the rest before creating its bill.");
      if (!(["Purchase Order", "Received"].includes(source.data.status || ""))) {
        throw new ActionError("Confirm this purchase order before creating its bill.");
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    // The customer's or supplier's own payment terms, not always 30 days.
    const terms = targetKind === "invoices" ? await termsFor(me.id, "customers", source.data.customer) : sourceKind === "purchase-orders" ? await termsFor(me.id, "vendors", source.data.vendor) : "30 days";
    const sourceData = progress
      ? {
          ...source.data,
          lineItems: JSON.stringify(parseInvoiceLines(source.data.lineItems || "").map((line) => ({ ...line, rate: ((Number(line.rate) || 0) * progress / 100).toFixed(2) }))),
          discount: source.data.discount ? ((Number(source.data.discount) || 0) * progress / 100).toFixed(2) : source.data.discount,
          progressPercent: String(progress),
          memo: `${progress}% of estimate ${source.data.estimateNumber || ""}`.trim(),
        }
      : source.data;
    let targetData = amountFromLineItems({
      ...sourceData,
      ...(targetKind === "invoices"
        ? {
            invoiceNumber: await nextDocumentNumber(transaction, me.id, "invoices", "invoiceNumber", "INV-"),
            issueDate: today,
            paymentTerms: terms,
            dueDate: dueDateForTerms(today, terms),
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
            billNumber: await nextDocumentNumber(transaction, me.id, "bills", "billNumber", "BILL-"),
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
        paymentTerms: terms,
        dueDate: dueDateForTerms(today, terms),
      };
    }
    const [created] = await transaction.insert(bookkeepingRecord)
      .values({ userId: me.id, kind: targetKind, data: sourceKind === "purchase-orders" ? { ...targetData, sourcePurchaseOrderId: source.id, sourcePurchaseOrderNumber: sourceData.poNumber || "" } : { ...targetData, convertedFromKind: sourceKind, convertedFromId: source.id } })
      .returning({ id: bookkeepingRecord.id });
    const updatedSourceData = sourceKind === "purchase-orders"
      ? { ...sourceData, convertedKind: targetKind, convertedRecordId: created.id, convertedAt: new Date().toISOString() }
      : progress
        ? { ...source.data, invoicedPercent: String(Math.min(100, Math.round((alreadyInvoiced + progress) * 100) / 100)), status: alreadyInvoiced + progress >= 99.999 ? "Converted" : source.data.status === "Draft" || source.data.status === "Sent" ? "Accepted" : source.data.status }
        : { ...sourceData, status: "Converted" };
    await transaction
      .update(bookkeepingRecord)
      .set({ data: updatedSourceData, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, source.id), eq(bookkeepingRecord.userId, me.id)));
  });
  await auditRecord(me, "Converted", id);
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
      exchangeRate: order.data.exchangeRate || "1",
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
      // The ordered products, so stocked items reach inventory (or clear "received not billed").
      purchaseLineItems: order.data.lineItems || "",
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
  await auditRecord(me, "Converted", id);
  revalidatePath("/app", "layout");
}

export async function createInventoryMovement(input: {
  itemId: string;
  movementType: "Receipt" | "Delivery" | "Adjustment";
  quantity: string;
  date: string;
  reference?: string;
  notes?: string;
  /** Cost per unit for stock received without a bill; the item's purchase cost when blank. */
  unitCost?: string;
  /** Where the stock comes in or goes out; the first warehouse when blank. */
  warehouse?: string;
  /** The lot, or serial numbers, for items tracked by them. */
  serials?: string;
}): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertCanWrite(me, "inventory-movements");
  const onHandByItem = await stockOnHand(me.id);
  const itemId = input.itemId.trim();
  const quantity = Number(input.quantity);
  const date = input.date.trim();
  const reference = (input.reference || "").trim().slice(0, 100);
  const notes = (input.notes || "").trim().slice(0, 500);

  if (!["Receipt", "Delivery", "Adjustment"].includes(input.movementType)) throw new ActionError("Choose a valid stock movement.");
  if (input.warehouse?.trim()) await checkStockPlaces(me.id, "inventory-movements", { warehouse: input.warehouse });
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

    if (!item || !isInventoryItem(item)) throw new ActionError("Choose a saved inventory item from Items & services.");
    const previousStock = onHandByItem.get(item.id) ?? 0;
    const unitCost = input.unitCost?.trim() ? Number(input.unitCost) : NaN;
    if (input.unitCost?.trim() && (!Number.isFinite(unitCost) || unitCost < 0)) throw new ActionError("Enter a unit cost of zero or more.");

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
      .set({ data: { ...item.data, stock: String(Number(item.data.stock || 0) + change) }, updatedAt })
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
          ...(input.warehouse?.trim() ? { warehouse: input.warehouse.trim().slice(0, 120) } : {}),
          ...(input.serials?.trim() ? { serials: input.serials.trim().slice(0, 2000) } : {}),
          ...(Number.isFinite(unitCost) ? { unitCost: String(unitCost) } : {}),
        },
        updatedAt,
      })
      .returning();

    return serializeRow(savedMovement);
  });

  revalidatePath("/app", "layout");
  return movement;
}

/** How many of each item a purchase order has received so far, by item id. */
function receivedQuantities(data: Record<string, string>): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(data.receivedQuantities || "{}");
    return parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, Number(value) || 0])) : {};
  } catch {
    return {};
  }
}

export async function advancePurchaseOrder(
  id: string,
  action: "send-rfq" | "confirm" | "receive" | "cancel",
  /** For a receipt: how many of each item arrived now, by item id; everything still to come when left out. */
  receiving?: Record<string, number>,
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
      if (status !== "Purchase Order" && status !== "Partially received") throw new ActionError("Confirm this purchase order before receiving its items.");
      const lines = parseInvoiceLines(lockedOrder.data.lineItems || "");
      const ordered = new Map<string, number>();
      for (const line of lines) {
        if (!line.itemId) continue;
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new ActionError("Check the ordered quantities before receiving items.");
        ordered.set(line.itemId, (ordered.get(line.itemId) || 0) + quantity);
      }
      // Deliveries can come in parts: each receipt adds what arrived, up to what is still to come.
      const already = receivedQuantities(lockedOrder.data);
      const quantities = new Map<string, number>();
      for (const [itemId, total] of ordered) {
        const left = Math.max(0, total - (already[itemId] ?? 0));
        const now = receiving && itemId in receiving ? Number(receiving[itemId]) : left;
        if (!Number.isFinite(now) || now < 0) throw new ActionError("Enter the quantities received as numbers of zero or more.");
        if (now > left + 1e-9) throw new ActionError(`Only ${left} of an item ${left === 1 ? "is" : "are"} still to come on this order.`);
        if (now > 0) quantities.set(itemId, now);
      }
      if (!quantities.size && ordered.size) throw new ActionError("Enter how many of each item arrived.");
      const receivedNow = Object.fromEntries([...ordered.keys()].map((itemId) => [itemId, (already[itemId] ?? 0) + (quantities.get(itemId) ?? 0)]));
      const complete = [...ordered].every(([itemId, total]) => receivedNow[itemId] >= total - 1e-9);
      const itemIds = [...quantities.keys()];
      if (itemIds.length) {
        const linkedItems = await transaction.select().from(bookkeepingRecord)
          .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "items"), inArray(bookkeepingRecord.id, itemIds)))
          .for("update");
        if (linkedItems.length !== itemIds.length) throw new ActionError("A linked item is no longer available. Update the purchase order before receiving it.");
        const orderLines = parseInvoiceLines(lockedOrder.data.lineItems || "");
        for (const item of linkedItems) {
          if (!isInventoryItem(item)) continue;
          const previousStock = Number(item.data.stock || 0);
          const receivedQuantity = quantities.get(item.id) || 0;
          const nextStock = previousStock + receivedQuantity;
          const orderRate = orderLines.find((line) => line.itemId === item.id)?.rate ?? "";
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
              purchaseOrderId: lockedOrder.id,
              unitCost: orderRate,
            },
            updatedAt,
          });
        }
      }
      const receivedData = { ...lockedOrder.data, receivedQuantities: JSON.stringify(receivedNow), lastReceivedAt: updatedAt.toISOString() };
      await transaction.update(bookkeepingRecord)
        .set({ data: complete ? { ...receivedData, status: "Received", receivedAt: updatedAt.toISOString() } : { ...receivedData, status: "Partially received" }, updatedAt })
        .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "purchase-orders")));
      return complete ? "Received" : "Partially received";
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

  await auditRecord(me, "Status changed", id);
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
      data: { ...transaction.data, matched: transaction.data.matched === "true" ? "false" : "true", matchedBy: transaction.data.matched === "true" ? "" : "user" },
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

  await recordAudit(me, "Reconciled", "reconciliations", created.id, created.data);
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
    .set({ data: { ...creditNote.data, appliedAmount: creditAmount.toFixed(2), appliedInvoiceId: invoice.id, status: "Applied" }, updatedAt: new Date() })
    .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  await auditRecord(me, "Credit applied", id);
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
  await auditRecord(me, "Credit applied", id);
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
  // The schedule's own terms, else the customer's.
  const terms = paymentTermOptions.includes(schedule.data.paymentTerms ?? "") ? schedule.data.paymentTerms : await termsFor(me.id, "customers", schedule.data.customer);
  const invoiceData = amountFromLineItems({
    ...schedule.data,
    invoiceNumber: `${prefix}${String(sequence).padStart(4, "0")}`,
    issueDate: today,
    paymentTerms: terms,
    dueDate: dueDateForTerms(today, terms),
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
  await auditRecord(me, "Invoice generated", id);
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
  purpose: "file" | "logo" = "file",
): Promise<{ provider: "blob"; pathname: string; clientToken: string; access: "public" | "private" } | { provider: "platform"; uploadUrl: string; publicUrl: string }> {
  const me = await requireUser();
  assertNotViewing(me);
  if (me.role === "Viewer") throw new ActionError("Your role doesn’t allow changing records. Ask an Admin in your business.");
  if (size > 10 * 1024 * 1024) throw new ActionError("Attachments must be 10 MB or smaller.");
  // Receipts, HR documents and other attachments go to the private store when one is
  // connected; the browser gets a ten-minute token for this one path.
  if (purpose === "file" && privateBlobToken()) return { provider: "blob", ...(await blobUploadToken(me.ownerId, filename, contentType, "private")) };
  if (blobConfigured()) return { provider: "blob", ...(await blobUploadToken(me.ownerId, filename, contentType, "public")) };
  const target = await createUploadUrl({ filename, contentType, size });
  return { provider: "platform", uploadUrl: target.uploadUrl, publicUrl: target.publicUrl };
}
export async function saveBulkInventoryCount(input: {
  rows: InventoryCountRow[];
  date: string;
  reference?: string;
}): Promise<{ checkedCount: number; adjustedCount: number }> {
  const me = await requireUser();
  assertCanWrite(me, "inventory-movements");
  const onHandByItem = await stockOnHand(me.id);
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

    if (items.length !== rows.length || items.some((item) => !isInventoryItem(item))) {
      throw new ActionError("The spreadsheet includes a product that is no longer in your inventory. Download a fresh template and try again.");
    }

    const countedById = new Map(rows.map((row) => [row.itemId, Number(row.quantity)]));
    const updatedAt = new Date();
    const movements: (typeof bookkeepingRecord.$inferInsert)[] = [];

    for (const item of items) {
      const countedStock = countedById.get(item.id);
      if (countedStock === undefined) throw new ActionError("The count sheet has changed. Download a fresh template and try again.");
      const previousStock = onHandByItem.get(item.id) ?? 0;
      const change = countedStock - previousStock;
      if (Math.abs(change) < 1e-9) continue;

      await transaction
        .update(bookkeepingRecord)
        .set({ data: { ...item.data, stock: String(Number(item.data.stock || 0) + change) }, updatedAt })
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
