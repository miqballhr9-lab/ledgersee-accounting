import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseLinesFromData } from "@/lib/expense-utils";
import { buildInventory, isInventoryItem, pricedLines } from "@/lib/inventory";

/**
 * Turns the saved records (invoices, bills, expenses, payments, journals,
 * payroll, bank transactions and opening balances) into double-entry postings,
 * so reports can total any account for any period and list the entries
 * behind each amount. Nothing here is stored: the ledger is rebuilt from the
 * records each time a report runs.
 */

export type AccountCategory = "Asset" | "Liability" | "Equity" | "Income" | "Expense";
export type AccountingMethod = "accrual" | "cash";

export interface LedgerAccount {
  name: string;
  code: string;
  category: AccountCategory;
  /** QuickBooks-style account type, e.g. "Accounts receivable (A/R)" or "Cost of sales". */
  accountType: string;
  detailType: string;
}

export interface Posting {
  /** Groups the postings of one transaction, so a report can show the other side ("split"). */
  txnId: string;
  date: string;
  type: string;
  number: string;
  /** Customer, supplier, payee or employee. */
  name: string;
  /** Set on sales-side postings, for reports grouped by customer. */
  customer: string;
  /** Set on purchase-side postings, for reports grouped by supplier. */
  supplier: string;
  /** QuickBooks' class, location and project of the transaction, for reports split by them. */
  className?: string;
  location?: string;
  project?: string;
  memo: string;
  account: string;
  /** Debit is positive, credit is negative, in the business's base currency. */
  amount: number;
  sourceKind: string;
  sourceId: string;
}

export interface Ledger {
  accounts: Map<string, LedgerAccount>;
  postings: Posting[];
  ar: string;
  ap: string;
  /** Tax paid on purchases that can be claimed back; the same as salesTax when there is no separate input tax account. */
  inputTax: string;
  salesTax: string;
  sales: string;
  openingEquity: string;
  retainedEarnings: string;
  payrollLiabilities: string;
  salaries: string;
  fiscalYearStartMonth: number;
}

const defaultTypeFor: Record<AccountCategory, string> = {
  Asset: "Current assets",
  Liability: "Current liabilities",
  Equity: "Owner's equity",
  Income: "Income",
  Expense: "Expenses",
};

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function num(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function categoryOf(value: string | undefined): AccountCategory | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "asset") return "Asset";
  if (normalized === "liability") return "Liability";
  if (normalized === "equity") return "Equity";
  if (normalized === "income") return "Income";
  if (normalized === "expense") return "Expense";
  return null;
}

function key(name: string) {
  return name.trim().toLowerCase();
}

/** A document's amounts are in its own currency; reports use the base currency. */
function rateOf(data: Record<string, string>, baseCurrency: string) {
  if (!data.currency || data.currency === baseCurrency) return 1;
  const rate = num(data.exchangeRate);
  return rate > 0 ? rate : 1;
}

interface DocPayment {
  date: string;
  amount: number;
  account: string;
  id: string;
  /** The exchange rate on the day the money moved, when it differs from the document's. */
  rate?: number;
}

/** Attachments that pay a creditor or court out of salary, rather than money lent to the employee. */
export const isGarnishment = (loanType: string | undefined) => /attachment of salary|assignment of salary|child support|garnish/i.test(loanType ?? "");

/** What each salary kept back for an attachment, as worked out from payroll. */
export function deductionLog(raw: string | undefined): Array<{ payrollId: string; month: string; amount: number }> {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.flatMap((entry) => (entry && typeof entry === "object" && typeof entry.payrollId === "string" && Number(entry.amount) > 0 ? [{ payrollId: entry.payrollId, month: String(entry.month ?? ""), amount: Number(entry.amount) }] : []))
      : [];
  } catch {
    return [];
  }
}

// Expense accounts that suit each HR expense category when there is no account of that name.
const claimAccountPatterns: Record<string, RegExp> = {
  travel: /travel/i,
  accommodation: /accommodation|lodging|hotel|travel/i,
  fuel: /fuel|vehicle|motor/i,
  meals: /meal|entertain/i,
  "office supplies": /office|supplies/i,
  "mobile & internet": /phone|mobile|internet|telecom|communication/i,
  training: /training|education/i,
  medical: /medical|health/i,
};

export function buildLedger(allRecords: BookkeepingRecord[], method: AccountingMethod = "accrual"): Ledger {
  // Records an automation made that still wait for approval stay out of the books until approved.
  const records = allRecords.filter((record) => record.data.awaitingApproval !== "true");
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  const baseCurrency = settings.currency || "";
  const fiscalIndex = months.indexOf((settings.fiscalYear || "January").trim().toLowerCase());
  const accounts = new Map<string, LedgerAccount>();
  const postings: Posting[] = [];

  for (const record of records) {
    if (record.kind !== "accounts") continue;
    const name = record.data.name?.trim() || record.data.code?.trim();
    if (!name) continue;
    const category = categoryOf(record.data.type) ?? "Expense";
    accounts.set(key(name), {
      name,
      code: record.data.code ?? "",
      category,
      accountType: record.data.accountType || defaultTypeFor[category],
      detailType: record.data.detailType ?? "",
    });
  }

  const find = (test: (account: LedgerAccount) => boolean) => [...accounts.values()].find(test)?.name;
  const ensure = (name: string, category: AccountCategory, accountType = defaultTypeFor[category]) => {
    const existing = accounts.get(key(name));
    if (existing) return existing.name;
    accounts.set(key(name), { name, code: "", category, accountType, detailType: "" });
    return name;
  };

  const ar = find((account) => account.accountType === "Accounts receivable (A/R)") ?? ensure("Accounts receivable (A/R)", "Asset", "Accounts receivable (A/R)");
  const ap = find((account) => account.accountType === "Accounts payable (A/P)") ?? ensure("Accounts payable (A/P)", "Liability", "Accounts payable (A/P)");
  const salesTax = find((account) => /sales tax|tax payable|vat|gst/i.test(`${account.name} ${account.detailType}`) && account.category === "Liability") ?? ensure("Sales tax payable", "Liability", "Current liabilities");
  const sales = find((account) => account.category === "Income" && /sales/i.test(`${account.name} ${account.detailType}`)) ?? find((account) => account.accountType === "Income") ?? ensure("Sales", "Income", "Income");
  const openingEquity = find((account) => /opening balance/i.test(`${account.name} ${account.detailType}`)) ?? ensure("Opening balance equity", "Equity", "Owner's equity");
  const retainedEarnings = find((account) => /retained earnings/i.test(`${account.name} ${account.detailType}`)) ?? ensure("Retained earnings", "Equity", "Owner's equity");
  const payrollLiabilities = find((account) => /payroll/i.test(`${account.name} ${account.detailType}`) && account.category === "Liability") ?? ensure("Payroll liabilities", "Liability", "Current liabilities");
  const salaries = find((account) => /salar|wages|payroll expense/i.test(`${account.name} ${account.detailType}`) && account.category === "Expense" && !/employer/i.test(account.name)) ?? ensure("Salaries and wages", "Expense", "Expenses");
  const undeposited = find((account) => /undeposited/i.test(`${account.name} ${account.detailType}`)) ?? "Undeposited funds";
  // Tax paid on purchases goes to the input tax account a tax pack adds (GST/VAT you can claim back);
  // without one it is netted against the tax payable account, as QuickBooks' tax control account does.
  const inputTax = find((account) => account.category === "Asset" && /input (sales )?tax|vat input|input vat|tax recoverable|tax reclaimable/i.test(`${account.name} ${account.detailType}`)) ?? salesTax;
  const lazy = (make: () => string) => { let name = ""; return () => (name ||= make()); };
  const employeeLoans = lazy(() => find((account) => account.category === "Asset" && /employee (loans|advances)|staff (loans|advances)|salary advance/i.test(account.name)) ?? ensure("Employee loans and advances", "Asset", "Current assets"));
  const reimbursements = lazy(() => find((account) => account.category === "Liability" && /reimburse/i.test(account.name)) ?? ensure("Employee reimbursements payable", "Liability", "Current liabilities"));
  const settlementExpense = lazy(() => find((account) => account.category === "Expense" && /gratuity|final settlement|severance/i.test(account.name)) ?? ensure("Gratuity and final settlement", "Expense", "Expenses"));
  // Foreign currency paid at a different rate than invoiced or billed: the difference is a realized gain or loss.
  const exchangeGainLoss = lazy(() => find((account) => /exchange gain|exchange loss|foreign exchange|fx gain/i.test(account.name)) ?? ensure("Exchange gain or loss", "Expense", "Other expense"));
  // What the employer pays on top of salaries (Sweden's arbetsgivaravgifter, Denmark's ATP), and where it is owed until paid.
  const employerContributions = lazy(() => find((account) => account.category === "Expense" && /employer (social )?contributions|arbetsgivaravgift|employer.*(social security|national insurance)/i.test(account.name)) ?? ensure("Employer social contributions", "Expense", "Expenses"));
  const employerContributionsOwed = lazy(() => find((account) => account.category === "Liability" && /employer contributions owed/i.test(account.name)) ?? payrollLiabilities);
  // Salary kept back for a creditor or court (attachment, assignment, child support), owed on until paid to them.
  const attachmentsPayable = lazy(() => find((account) => account.category === "Liability" && /attachment|garnish|child support/i.test(account.name)) ?? ensure("Salary attachments payable", "Liability", "Current liabilities"));
  const vehicleExpenses = lazy(() => find((account) => account.category === "Expense" && /vehicle|motor|fleet|car expense/i.test(account.name)) ?? ensure("Vehicle expenses", "Expense", "Expenses"));
  const employeeExpenses = lazy(() => find((account) => account.category === "Expense" && /employee expenses|staff expenses/i.test(account.name)) ?? ensure("Employee expenses", "Expense", "Expenses"));
  /** An HR expense category's account: the chart account of that name, else one that fits it, else Employee expenses. */
  const claimAccount = (category: string) => {
    const named = accounts.get(key(category));
    if (named?.category === "Expense") return named.name;
    const pattern = claimAccountPatterns[category.trim().toLowerCase()];
    return (pattern && find((account) => account.category === "Expense" && pattern.test(account.name))) || employeeExpenses();
  };
  const employeeRecoveries = lazy(() => find((account) => account.category === "Income" && /fine|recover/i.test(account.name)) ?? ensure("Employee fines and recoveries", "Income", "Other income"));

  const recordById = new Map(records.map((record) => [record.id, record]));
  const accountById = new Map(records.filter((record) => record.kind === "accounts").map((record) => [record.id, record.data.name?.trim() || record.data.code?.trim() || ""]));
  /** Money received with no account goes to undeposited funds; money paid out with no account to a clearly named cash account. */
  const paymentAccountName = (data: Record<string, string>, direction: "in" | "out" = "out") => {
    const byId = data.paymentAccountId ? accountById.get(data.paymentAccountId) : "";
    const name = byId || data.paymentAccountName?.trim() || "";
    if (name) return ensure(name, "Asset", "Cash and cash equivalents");
    return direction === "in" ? ensure(undeposited, "Asset", "Current assets") : ensure("Cash (account not set)", "Asset", "Cash and cash equivalents");
  };
  /** Expense lines name their category account; unknown names become expense accounts. */
  const expenseAccount = (name: string) => (name.trim() ? ensure(name.trim(), "Expense") : ensure("Uncategorised expense", "Expense"));
  const incomeAccount = (name: string) => (name.trim() ? ensure(name.trim(), "Income") : ensure("Uncategorised income", "Income"));
  const balanceAccount = (name: string) => (name.trim() ? accounts.get(key(name))?.name ?? ensure(name.trim(), "Expense") : ensure("Uncategorised", "Expense"));
  // Accounts from Banking (bank, cash and card accounts) are balance sheet accounts, not expenses.
  const bankAccounts = records.filter((record) => record.kind === "bank-accounts" && record.data.name?.trim());
  for (const bank of bankAccounts) {
    const card = /card/i.test(bank.data.accountType ?? "");
    ensure(bank.data.name.trim(), card ? "Liability" : "Asset", card ? "Credit card" : "Cash and cash equivalents");
  }
  /** The account a bank line belongs to: a Banking account or a chart account by name, else a bank account. */
  const bankAccountFor = (name: string) => (name.trim() ? accounts.get(key(name))?.name ?? ensure(name.trim(), "Asset", "Cash and cash equivalents") : ensure("Bank", "Asset", "Cash and cash equivalents"));

  const postLines = (base: Omit<Posting, "account" | "amount">, lines: Array<[string, number]>) => {
    const kept = lines.map(([account, amount]) => [account, round(amount)] as const).filter(([, amount]) => amount !== 0);
    const difference = round(kept.reduce((sum, [, amount]) => sum + amount, 0));
    // Rounding from currency conversion or line scaling is kept inside the transaction so it always balances.
    if (difference !== 0 && kept.length) {
      const [account, amount] = kept[kept.length - 1];
      kept[kept.length - 1] = [account, round(amount - difference)];
    }
    // Each posting carries its document's class, location and project.
    const source = recordById.get(base.sourceId.split("#")[0])?.data;
    const segment = source ? { className: source.className || "", location: source.location || "", project: source.project || "" } : {};
    for (const [account, amount] of kept) postings.push({ ...base, ...segment, account, amount });
  };
  const post = postLines;

  /** A sale's income split by each line's item income account; lines without one go to Sales. */
  function splitIncome(data: Record<string, string>, income: number): Array<[string, number]> {
    const lines = pricedLines(data).filter((line) => line.qty);
    const lineTotal = lines.reduce((sum, line) => sum + line.qty * line.unit, 0);
    if (!lines.length || lineTotal <= 0) return [[sales, income]];
    const byAccount = new Map<string, number>();
    for (const line of lines) {
      const account = incomeFor(line.itemId);
      byAccount.set(account, (byAccount.get(account) ?? 0) + (line.qty * line.unit / lineTotal) * income);
    }
    return [...byAccount.entries()];
  }

  // Inventory: stock bought goes to the inventory asset, and its cost moves to cost of goods sold when sold (FIFO).
  const inventoryItems = new Set(records.filter((record) => record.kind === "items" && isInventoryItem(record)).map((record) => record.id));
  const inventoryAsset = () => find((account) => account.category === "Asset" && /inventory/i.test(`${account.name} ${account.detailType}`)) ?? ensure("Inventory Asset", "Asset", "Current assets");
  const cogs = () => find((account) => account.accountType === "Cost of sales" && /cost of goods/i.test(account.name)) ?? find((account) => account.accountType === "Cost of sales") ?? ensure("Cost of goods sold", "Expense", "Cost of sales");
  const shrinkage = () => find((account) => /shrinkage/i.test(account.name)) ?? ensure("Inventory Shrinkage", "Expense", "Cost of sales");
  const receivedNotBilled = () => find((account) => /received not billed/i.test(account.name)) ?? ensure("Inventory received not billed", "Liability", "Current liabilities");
  const purchaseOrders = new Map(records.filter((record) => record.kind === "purchase-orders").map((record) => [record.id, record]));
  // Each item can name its own income, expense (cost of goods sold) and inventory asset accounts.
  const itemById = new Map(records.filter((record) => record.kind === "items").map((record) => [record.id, record]));
  const itemAccount = (itemId: string, field: "incomeAccountId" | "expenseAccountId" | "assetAccountId") => {
    const id = itemById.get(itemId)?.data[field];
    const name = id ? accountById.get(id) : "";
    return name ? accounts.get(key(name))?.name ?? name : "";
  };
  const incomeFor = (itemId: string) => (itemId && itemAccount(itemId, "incomeAccountId")) || sales;
  const cogsFor = (itemId: string) => (itemId && itemAccount(itemId, "expenseAccountId")) || cogs();
  const assetFor = (itemId: string) => (itemId && itemAccount(itemId, "assetAccountId")) || inventoryAsset();
  if (inventoryItems.size) {
    let sequence = 0;
    for (const summary of buildInventory(records).values()) {
      for (const event of summary.events) {
        if (event.role === "bill" || event.role === "purchase-return" || Math.abs(event.value) < 0.005) continue;
        sequence += 1;
        const base = { txnId: `inv-${event.role}-${sequence}`, date: event.date, type: event.role === "sale" ? "Invoice (cost of sale)" : event.role === "return" ? "Credit note (stock returned)" : event.type, number: event.number, name: event.name, customer: event.role === "sale" || event.role === "return" ? event.name : "", supplier: "", memo: `${summary.item.data.name ?? "Item"} × ${Math.abs(event.quantity)}`, sourceKind: event.sourceKind, sourceId: event.sourceId };
        const offset = event.role === "opening" ? openingEquity : event.role === "po-receipt" ? receivedNotBilled() : event.role === "adjust-in" || event.role === "adjust-out" ? shrinkage() : cogsFor(event.itemId);
        post(base, [[assetFor(event.itemId), event.value], [offset, -event.value]]);
      }
    }
  }

  // Opening balances, offset to opening balance equity.
  for (const record of records) {
    if (record.kind !== "accounts") continue;
    const opening = num(record.data.openingBalance);
    const name = record.data.name?.trim() || record.data.code?.trim();
    if (!opening || !name) continue;
    const account = accounts.get(key(name));
    if (!account || account.name === openingEquity) continue;
    const debitNormal = account.category === "Asset" || account.category === "Expense";
    const amount = debitNormal ? opening : -opening;
    post(
      { txnId: `open-${record.id}`, date: record.data.openingBalanceDate || record.createdAt.slice(0, 10), type: "Opening balance", number: "", name: "", customer: "", supplier: "", memo: "Opening balance", sourceKind: "accounts", sourceId: record.id },
      [[account.name, amount], [openingEquity, -amount]],
    );
  }

  // Opening balances of Banking accounts that are not also in the chart of accounts (those post above).
  const chartNames = new Set(records.filter((record) => record.kind === "accounts").map((record) => key(record.data.name?.trim() || record.data.code?.trim() || "")));
  for (const bank of bankAccounts) {
    const opening = num(bank.data.openingBalance);
    if (!opening || chartNames.has(key(bank.data.name))) continue;
    const account = accounts.get(key(bank.data.name))!;
    const amount = account.category === "Liability" ? -opening : opening;
    post(
      { txnId: `open-bank-${bank.id}`, date: bank.data.openingBalanceDate || bank.createdAt.slice(0, 10), type: "Opening balance", number: "", name: "", customer: "", supplier: "", memo: "Opening balance", sourceKind: "bank-accounts", sourceId: bank.id },
      [[account.name, amount], [openingEquity, -amount]],
    );
  }

  const paymentsFor = new Map<string, DocPayment[]>();
  for (const record of records) {
    if (record.kind !== "payments") continue;
    const target = record.data.invoiceId || record.data.billId || record.data.expenseId || record.data.payrollId;
    if (!target) continue;
    const list = paymentsFor.get(target) ?? [];
    const rate = num(record.data.exchangeRate);
    list.push({ date: record.data.paymentDate || record.createdAt.slice(0, 10), amount: num(record.data.amount), account: paymentAccountName(record.data, record.data.invoiceId ? "in" : "out"), id: record.id, ...(rate > 0 ? { rate } : {}) });
    paymentsFor.set(target, list);
  }
  /** Payments on a document; a paid amount with no payment records (older data) counts as one payment. */
  const docPayments = (record: BookkeepingRecord, fallbackDate: string) => {
    const list = [...(paymentsFor.get(record.id) ?? [])];
    const recorded = list.reduce((sum, payment) => sum + payment.amount, 0);
    const unrecorded = round(num(record.data.paidAmount) - recorded);
    if (unrecorded > 0.005) list.push({ date: record.data.paymentDate || record.data.paidDate || fallbackDate, amount: unrecorded, account: paymentAccountName(record.data, record.kind === "invoices" ? "in" : "out"), id: record.id });
    return list;
  };

  for (const record of records) {
    const data = record.data;
    const rate = rateOf(data, baseCurrency);
    /** The rate a payment was made at: its own when recorded in a foreign currency, else the document's. */
    const paidRate = (payment: DocPayment) => data.currency && data.currency !== baseCurrency && payment.rate ? payment.rate : rate;
    /** A debit (loss) or credit (gain) to the exchange account, only when there is a difference. */
    const fxLine = (amount: number): Array<[string, number]> => (Math.abs(amount) > 0.004 ? [[exchangeGainLoss(), amount]] : []);

    if (record.kind === "invoices") {
      if (["Draft", "Cancelled", "Void"].includes(data.status ?? "")) continue;
      const date = data.issueDate || record.createdAt.slice(0, 10);
      const total = num(data.amount) * rate;
      const tax = num(data.taxAmount) * rate;
      const income = total - tax;
      const base = { type: "Invoice", number: data.invoiceNumber ?? "", name: data.customer ?? "", customer: data.customer ?? "", supplier: "", memo: "", sourceKind: "invoices", sourceId: record.id };
      // Income goes to each item's income account (Sales by default); lines carry the discount, not the tax.
      // An opening balance invoice brings in what a customer already owed, against opening balance equity.
      const incomeLines: Array<[string, number]> = data.docType === "Opening balance" ? [[openingEquity, income]] : splitIncome(data, income);
      if (method === "accrual") {
        post({ ...base, txnId: `inv-${record.id}`, date }, [[ar, total], ...incomeLines.map(([account, amount]) => [account, -amount] as [string, number]), [salesTax, -tax]]);
        for (const payment of docPayments(record, date)) {
          const received = payment.amount * paidRate(payment);
          post({ ...base, type: "Payment", txnId: `pay-${payment.id}-${record.id}`, date: payment.date }, [[payment.account, received], [ar, -payment.amount * rate], ...fxLine(payment.amount * rate - received)]);
        }
      } else if (total > 0) {
        for (const payment of docPayments(record, date)) {
          const share = (payment.amount * rate) / total;
          const received = payment.amount * paidRate(payment);
          post({ ...base, type: "Payment", txnId: `pay-${payment.id}-${record.id}`, date: payment.date }, [[payment.account, received], ...incomeLines.map(([account, amount]) => [account, -amount * share] as [string, number]), [salesTax, -tax * share], ...fxLine(payment.amount * rate - received)]);
        }
      }
      continue;
    }

    if (record.kind === "credit-notes") {
      if (["Draft", "Void", "Cancelled"].includes(data.status ?? "")) continue;
      const total = num(data.amount) * rate;
      const tax = num(data.taxAmount) * rate;
      if (!total) continue;
      const base = { number: data.creditNumber ?? "", name: data.customer ?? "", customer: data.customer ?? "", supplier: "", memo: data.reason ?? "", sourceKind: "credit-notes", sourceId: record.id };
      // A refunded credit is paid back to the customer from a bank or cash account.
      const refundFrom = data.status === "Refunded" ? paymentAccountName({ paymentAccountId: data.refundAccountId || "", paymentAccountName: data.refundAccountName || "" }) : "";
      if (method === "accrual") {
        post({ ...base, type: "Credit note", txnId: `cn-${record.id}`, date: data.date || record.createdAt.slice(0, 10) }, [...splitIncome(data, total - tax), [salesTax, tax], [ar, -total]]);
        if (refundFrom) post({ ...base, type: "Refund", txnId: `cr-${record.id}`, date: data.refundDate || data.date || record.createdAt.slice(0, 10) }, [[ar, total], [refundFrom, -total]]);
      } else if (refundFrom) {
        post({ ...base, type: "Refund", txnId: `cr-${record.id}`, date: data.refundDate || data.date || record.createdAt.slice(0, 10) }, [...splitIncome(data, total - tax), [salesTax, tax], [refundFrom, -total]]);
      }
      continue;
    }

    if (record.kind === "bills" || record.kind === "expenses" || record.kind === "supplier-credits") {
      if (["Cancelled", "Void", "Draft", "Pending approval"].includes(data.status ?? "")) continue;
      // A credit card credit runs the other way: the card balance and the expense both go down.
      const post = data.docType === "Credit card credit" && record.kind === "expenses"
        ? (base: Omit<Posting, "account" | "amount">, lines: Array<[string, number]>) => postLines(base, lines.map(([account, amount]) => [account, -amount] as [string, number]))
        : postLines;
      const isBill = record.kind === "bills";
      const isCredit = record.kind === "supplier-credits";
      const date = (isBill ? data.billDate : isCredit ? data.date : data.expenseDate) || record.createdAt.slice(0, 10);
      const total = num(data.amount) * rate;
      const tax = num(data.taxAmount) * rate;
      const lines = expenseLinesFromData(data);
      const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0);
      // Lines are before tax and discount; scale them so they add up to what was actually charged.
      const scale = lineTotal ? (total - tax) / lineTotal : 0;
      // A supplier credit without lines of its own reverses the category of the bill it applies to.
      const appliedBill = isCredit && !lines.some((line) => line.category) && data.billNumber ? records.find((item) => item.kind === "bills" && item.data.billNumber === data.billNumber) : undefined;
      const fallbackCategory = data.category || (appliedBill ? expenseLinesFromData(appliedBill.data)[0]?.category : "") || "";
      let debitLines: Array<[string, number]> = lines.length && lineTotal
        ? lines.map((line) => [expenseAccount(line.category || fallbackCategory), line.amount * scale])
        : [[expenseAccount(fallbackCategory), total - tax]];
      // Inventory items on the document are stock, not an expense. Items from a received purchase
      // order clear "received not billed" instead, since the receipt already added them.
      const itemLines = pricedLines(data, data.purchaseLineItems || data.lineItems || "").filter((line) => inventoryItems.has(line.itemId) && line.qty);
      // Non-inventory products and services bought go to cost of goods sold, as in QuickBooks.
      if (!itemLines.length && !data.purchaseLineItems && pricedLines(data).some((line) => line.itemId && line.qty)) {
        debitLines = pricedLines(data).filter((line) => line.qty).map((line) => [line.itemId ? cogsFor(line.itemId) : expenseAccount(line.name || fallbackCategory), line.qty * line.unit] as [string, number]);
      }
      if (itemLines.length && inventoryItems.size) {
        const order = data.sourcePurchaseOrderId ? purchaseOrders.get(data.sourcePurchaseOrderId) : undefined;
        const received = Boolean(order && (order.data.receivedAt || order.data.status === "Received"));
        const others = data.purchaseLineItems
          ? [[debitLines[0]?.[0] ?? expenseAccount(fallbackCategory), total - tax - itemLines.reduce((sum, line) => sum + line.qty * line.unit, 0)] as [string, number]]
          : pricedLines(data).filter((line) => !inventoryItems.has(line.itemId) && line.qty).map((line) => [line.itemId ? cogsFor(line.itemId) : expenseAccount(line.name || fallbackCategory), line.qty * line.unit] as [string, number]);
        const stockLines: Array<[string, number]> = itemLines.map((line) => [received ? receivedNotBilled() : assetFor(line.itemId), line.qty * line.unit]);
        debitLines = [...stockLines, ...others.filter(([, amount]) => Math.abs(amount) > 0.004)];
      }
      if (isBill && data.docType === "Opening balance") debitLines = [[openingEquity, total]];
      const party = (isBill || isCredit ? data.vendor : data.payee) ?? "";
      const base = {
        type: isBill ? "Bill" : isCredit ? "Supplier credit" : "Expense",
        number: (isBill ? data.billNumber : isCredit ? data.creditNumber : data.referenceNumber) ?? "",
        name: party,
        customer: "",
        supplier: party,
        memo: data.memo || data.description || "",
        sourceKind: record.kind,
        sourceId: record.id,
      };
      if (isCredit) {
        if (method === "accrual") post({ ...base, txnId: `sc-${record.id}`, date }, [[ap, total], ...debitLines.map(([account, amount]) => [account, -amount] as [string, number]), [inputTax, -tax]]);
        // A refunded credit is money back from the supplier.
        if (data.status === "Refunded") {
          const refundTo = paymentAccountName({ paymentAccountId: data.refundAccountId || data.paymentAccountId || "", paymentAccountName: data.paymentAccountName || "" }, "in");
          if (method === "accrual") post({ ...base, type: "Supplier refund", txnId: `sr-${record.id}`, date }, [[refundTo, total], [ap, -total]]);
          else post({ ...base, type: "Supplier refund", txnId: `sr-${record.id}`, date }, [[refundTo, total], ...debitLines.map(([account, amount]) => [account, -amount] as [string, number]), [inputTax, -tax]]);
        }
        continue;
      }
      // Expenses paid in parts are booked like bills: owed when incurred, then each payment.
      if (!isBill && (paymentsFor.has(record.id) || num(data.paidAmount) > 0)) {
        const payments = docPayments(record, date);
        if (method === "accrual") {
          post({ ...base, txnId: `exp-${record.id}`, date }, [...debitLines, [inputTax, tax], [ap, -total]]);
          for (const payment of payments) post({ ...base, type: "Expense payment", txnId: `ep-${payment.id}-${record.id}`, date: payment.date }, [[ap, payment.amount * rate], [payment.account, -payment.amount * rate]]);
        } else if (total > 0) {
          for (const payment of payments) {
            const share = (payment.amount * rate) / total;
            post({ ...base, type: "Expense payment", txnId: `ep-${payment.id}-${record.id}`, date: payment.date }, [...debitLines.map(([account, amount]) => [account, amount * share] as [string, number]), [inputTax, tax * share], [payment.account, -payment.amount * rate]]);
          }
        }
        continue;
      }
      if (!isBill) {
        const paid = data.status === "Paid" || Boolean(data.paymentAccountId) || (!data.status && Boolean(data.paymentAccount));
        if (method === "cash" && !paid) continue;
        const credit = paid ? paymentAccountName(data) : ap;
        post({ ...base, txnId: `exp-${record.id}`, date: paid && method === "cash" ? data.paymentDate || date : date }, [...debitLines, [inputTax, tax], [credit, -total]]);
        continue;
      }
      if (method === "accrual") {
        post({ ...base, txnId: `bill-${record.id}`, date }, [...debitLines, [inputTax, tax], [ap, -total]]);
        for (const payment of docPayments(record, date)) {
          const spent = payment.amount * paidRate(payment);
          post({ ...base, type: "Bill payment", txnId: `bp-${payment.id}-${record.id}`, date: payment.date }, [[ap, payment.amount * rate], [payment.account, -spent], ...fxLine(spent - payment.amount * rate)]);
        }
      } else if (total > 0) {
        for (const payment of docPayments(record, date)) {
          const share = (payment.amount * rate) / total;
          const spent = payment.amount * paidRate(payment);
          post({ ...base, type: "Bill payment", txnId: `bp-${payment.id}-${record.id}`, date: payment.date }, [...debitLines.map(([account, amount]) => [account, amount * share] as [string, number]), [inputTax, tax * share], [payment.account, -spent], ...fxLine(spent - payment.amount * rate)]);
        }
      }
      continue;
    }

    if (record.kind === "journals") {
      const date = data.date || record.createdAt.slice(0, 10);
      const base = { txnId: `jnl-${record.id}`, date, type: "Journal entry", number: data.reference ?? "", name: "", customer: "", supplier: "", memo: data.memo ?? "", sourceKind: "journals", sourceId: record.id };
      let lines: Array<[string, number]> = [];
      try {
        const parsed: unknown = JSON.parse(data.lines || "[]");
        if (Array.isArray(parsed)) {
          lines = parsed.flatMap((entry): Array<[string, number]> => {
            if (!entry || typeof entry !== "object") return [];
            const line = entry as Record<string, unknown>;
            const account = typeof line.account === "string" ? line.account : "";
            const amount = Number(line.debit ?? 0) - Number(line.credit ?? 0);
            return account && Number.isFinite(amount) ? [[balanceAccount(account), amount]] : [];
          });
        }
      } catch {
        lines = [];
      }
      if (!lines.length && num(data.amount)) lines = [[balanceAccount(data.debitAccount ?? ""), num(data.amount)], [balanceAccount(data.creditAccount ?? ""), -num(data.amount)]];
      post(base, lines);
      continue;
    }

    if (record.kind === "transactions") {
      // Matched bank lines are already counted through the invoice, bill or expense they match.
      // A line only categorised by a bank rule (older automation also marked it matched) still counts.
      const matched = data.matched === "true" && !(data.ruleApplied && data.matchedBy !== "user");
      if (matched || !num(data.amount)) continue;
      if (data.type === "Transfer") {
        // A transfer moves money between two of the business's own accounts.
        const from = (data.accountId && accountById.get(data.accountId)) || data.account || "";
        const to = (data.toAccountId && accountById.get(data.toAccountId)) || data.toAccount || "";
        const amount = Math.abs(num(data.amount));
        post({ txnId: `trf-${record.id}`, date: data.date || record.createdAt.slice(0, 10), type: "Transfer", number: "", name: "", customer: "", supplier: "", memo: data.description ?? "", sourceKind: "transactions", sourceId: record.id }, [[bankAccountFor(to), amount], [bankAccountFor(from), -amount]]);
        continue;
      }
      const bank = bankAccountFor(data.account ?? "");
      const inflow = (data.type ?? "").toLowerCase().startsWith("dep") || (data.type ?? "").toLowerCase() === "in" || (data.type ?? "").toLowerCase().includes("money in");
      const category = inflow ? (accounts.get(key(data.category ?? ""))?.name ?? incomeAccount(data.category ?? "")) : (accounts.get(key(data.category ?? ""))?.name ?? expenseAccount(data.category ?? ""));
      const amount = Math.abs(num(data.amount));
      post(
        { txnId: `txn-${record.id}`, date: data.date || record.createdAt.slice(0, 10), type: inflow ? "Deposit" : "Withdrawal", number: "", name: "", customer: "", supplier: "", memo: data.description ?? "", sourceKind: "transactions", sourceId: record.id },
        inflow ? [[bank, amount], [category, -amount]] : [[category, amount], [bank, -amount]],
      );
      continue;
    }

    if (record.kind === "payroll") {
      const gross = num(data.grossSalary);
      if (!gross || /draft|cancel/i.test(data.status ?? "")) continue;
      const net = num(data.payableSalary);
      // What was kept back from pay: loans and advances repay the employee's receivable, fines are income,
      // and income tax and anything else is owed onwards (payroll liabilities).
      const repaid = num(data.loanDeduction) + num(data.advanceDeduction);
      const fines = num(data.fineDeduction);
      // Expense claims paid back with the salary clear what is owed to the employee for them.
      const reimbursed = num(data.reimbursement);
      const owed = gross + reimbursed - net - repaid - fines;
      const claimsBack = (share: number): Array<[string, number]> => (reimbursed ? [[reimbursements(), reimbursed * share]] : []);
      const recovered = (share: number): Array<[string, number]> => [...(repaid ? [[employeeLoans(), -repaid * share] as [string, number]] : []), ...(fines ? [[employeeRecoveries(), -fines * share] as [string, number]] : [])];
      const withheld = (share: number): Array<[string, number]> => [...recovered(share), [payrollLiabilities, -owed * share]];
      const base = { number: data.reference ?? "", name: data.employeeName ?? "", customer: "", supplier: "", memo: data.month ? `Salary ${data.month}` : "Salary", sourceKind: "payroll", sourceId: record.id };
      const month = /^\d{4}-\d{2}$/.test(data.month ?? "") ? `${data.month}-28` : "";
      // The employer's contributions on this salary are a cost of the month, owed to the tax authority.
      const employerCost = num(data.employerContribution);
      if (employerCost > 0 && (method === "accrual" || data.status === "Paid" || paymentsFor.has(record.id))) {
        post({ ...base, type: "Employer contributions", txnId: `pec-${record.id}`, date: month || record.createdAt.slice(0, 10) }, [[employerContributions(), employerCost], [employerContributionsOwed(), -employerCost]]);
      }
      // Salaries paid in parts: owed for the month, then each payment.
      if (paymentsFor.has(record.id) || num(data.paidAmount) > 0) {
        const payments = docPayments(record, month || record.createdAt.slice(0, 10));
        if (method === "accrual") {
          post({ ...base, type: "Payroll", txnId: `pr-${record.id}`, date: month || record.createdAt.slice(0, 10) }, [[salaries, gross], ...claimsBack(1), ...recovered(1), [payrollLiabilities, -(gross + reimbursed - repaid - fines)]]);
          for (const payment of payments) post({ ...base, type: "Salary payment", txnId: `sp-${payment.id}-${record.id}`, date: payment.date }, [[payrollLiabilities, payment.amount], [payment.account, -payment.amount]]);
        } else if (net > 0) {
          for (const payment of payments) {
            const share = payment.amount / net;
            post({ ...base, type: "Salary payment", txnId: `sp-${payment.id}-${record.id}`, date: payment.date }, [[salaries, gross * share], ...claimsBack(share), ...withheld(share), [payment.account, -payment.amount]]);
          }
        }
        continue;
      }
      const paid = data.status === "Paid";
      if (method === "cash" && !paid) continue;
      const date = (paid ? data.paidDate : "") || month || record.createdAt.slice(0, 10);
      post(
        { txnId: `pr-${record.id}`, date, type: "Payroll", number: data.reference ?? "", name: data.employeeName ?? "", customer: "", supplier: "", memo: data.month ? `Salary ${data.month}` : "Salary", sourceKind: "payroll", sourceId: record.id },
        [[salaries, gross], ...claimsBack(1), ...withheld(1), [paid ? paymentAccountName(data) : payrollLiabilities, -net]],
      );
      continue;
    }

    if (record.kind === "tax-filings") {
      // Paying a filed return clears the tax collected, less the tax claimed back on purchases.
      if (data.status !== "Paid") continue;
      const output = num(data.outputTax);
      const input = num(data.inputTax);
      const net = output - input;
      const base = { txnId: `taxpay-${record.id}`, date: data.paymentDate || record.createdAt.slice(0, 10), type: "Tax payment", number: "", name: data.returnName ?? "", customer: "", supplier: "", memo: `${data.returnName || "Tax return"} ${data.from} to ${data.to}`, sourceKind: "tax-filings", sourceId: record.id };
      const from = paymentAccountName(data);
      post(base, inputTax === salesTax ? [[salesTax, net], [from, -net]] : [[salesTax, output], [inputTax, -input], [from, -net]]);
      continue;
    }

    if (record.kind === "deposits") {
      // A bank deposit moves customer payments out of Undeposited funds, plus any other money, into the bank.
      const total = num(data.amount);
      if (!total) continue;
      let lines: Array<[string, number]> = [];
      try {
        const parsed: unknown = JSON.parse(data.lines || "[]");
        if (Array.isArray(parsed)) lines = parsed.flatMap((line): Array<[string, number]> => {
          if (!line || typeof line !== "object") return [];
          const entry = line as Record<string, string>;
          const name = (entry.accountId && accountById.get(entry.accountId)) || entry.account || "";
          return num(entry.amount) ? [[balanceAccount(name), -num(entry.amount)]] : [];
        });
      } catch {
        lines = [];
      }
      const bank = (data.accountId && accountById.get(data.accountId)) || data.accountName || "";
      post(
        { txnId: `dep-${record.id}`, date: data.date || record.createdAt.slice(0, 10), type: "Deposit", number: data.reference ?? "", name: "", customer: "", supplier: "", memo: data.memo ?? "", sourceKind: "deposits", sourceId: record.id },
        [[bankAccountFor(bank), total], ...(num(data.paymentTotal) ? [[ensure(undeposited, "Asset", "Current assets"), -num(data.paymentTotal)] as [string, number]] : []), ...lines],
      );
      continue;
    }

    if (record.kind === "hr-loans") {
      const amount = num(data.amount);
      if (!amount || !["Running", "Completed", "Approved", "Repaid"].includes(data.status ?? "")) continue;
      const date = data.requestDate || record.createdAt.slice(0, 10);
      const base = { number: "", name: data.employee ?? "", customer: "", supplier: "", memo: data.loanType || "Salary attachment", sourceKind: "hr-loans", sourceId: record.id };
      if (isGarnishment(data.loanType)) {
        // Not money paid to the employee: what each salary keeps back for it is owed on to the creditor or court.
        for (const entry of deductionLog(data.deductionLog)) {
          post({ ...base, type: "Salary attachment", txnId: `att-${record.id}-${entry.payrollId}`, date: /^\d{4}-\d{2}$/.test(entry.month) ? `${entry.month}-28` : date }, [[employeeLoans(), entry.amount], [attachmentsPayable(), -entry.amount]]);
        }
        continue;
      }
      // A loan or advance paid out to an employee is money they owe back, repaid through payroll or in cash.
      post({ ...base, type: "Employee loan", txnId: `loan-${record.id}`, date }, [[employeeLoans(), amount], [paymentAccountName(data), -amount]]);
      const cash = num(data.manualRepaid);
      if (cash > 0) {
        const into = data.repaidIntoId && accountById.get(data.repaidIntoId) ? ensure(accountById.get(data.repaidIntoId)!, "Asset", "Cash and cash equivalents") : paymentAccountName(data);
        post({ ...base, type: "Loan repayment", txnId: `loan-rep-${record.id}`, date: data.cashRepaidDate || date }, [[into, cash], [employeeLoans(), -cash]]);
      }
      continue;
    }

    if (record.kind === "hr-vehicle-services") {
      // Fuel, repairs and servicing are a cost once done, paid from the account chosen on the service.
      const cost = num(data.cost);
      if (!cost || !["Done", ""].includes(data.status ?? "")) continue;
      post(
        { txnId: `fleet-${record.id}`, date: data.date || record.createdAt.slice(0, 10), type: "Vehicle expense", number: "", name: data.vendor ?? "", customer: "", supplier: data.vendor ?? "", memo: [data.vehicle, data.serviceType].filter(Boolean).join(" · "), sourceKind: "hr-vehicle-services", sourceId: record.id },
        [[vehicleExpenses(), cost], [paymentAccountName(data), -cost]],
      );
      continue;
    }

    if (record.kind === "hr-claims") {
      const amount = num(data.amount);
      if (!amount || !["Approved", "Paid"].includes(data.status ?? "")) continue;
      const base = { number: data.reference ?? "", name: data.employee ?? "", customer: "", supplier: "", memo: data.description ?? "", sourceKind: "hr-claims", sourceId: record.id };
      const expense = claimAccount(data.category || "");
      const date = data.date || record.createdAt.slice(0, 10);
      if (data.paidBy === "Company") {
        // Paid with company money: the expense and the payment happen together.
        post({ ...base, type: "Employee expense", txnId: `claim-${record.id}`, date }, [[expense, amount], [paymentAccountName(data), -amount]]);
        continue;
      }
      const paid = data.status === "Paid";
      const paidDate = data.paidDate || date;
      const salary = data.reimbursedInPayroll ? recordById.get(data.reimbursedInPayroll) : undefined;
      if (salary) {
        // Paid back with a salary: the salary's payment clears what is owed for it.
        const salaryPaid = salary.data.status === "Paid" || num(salary.data.paidAmount) > 0;
        if (method === "accrual") post({ ...base, type: "Employee expense", txnId: `claim-${record.id}`, date }, [[expense, amount], [reimbursements(), -amount]]);
        else if (salaryPaid) post({ ...base, type: "Employee expense", txnId: `claim-${record.id}`, date: salary.data.paidDate || paidDate }, [[expense, amount], [reimbursements(), -amount]]);
        continue;
      }
      if (method === "accrual") {
        post({ ...base, type: "Employee expense", txnId: `claim-${record.id}`, date }, [[expense, amount], [reimbursements(), -amount]]);
        if (paid) post({ ...base, type: "Expense reimbursement", txnId: `claim-pay-${record.id}`, date: paidDate }, [[reimbursements(), amount], [paymentAccountName(data), -amount]]);
      } else if (paid) {
        post({ ...base, type: "Expense reimbursement", txnId: `claim-pay-${record.id}`, date: paidDate }, [[expense, amount], [paymentAccountName(data), -amount]]);
      }
      continue;
    }

    if (record.kind === "hr-settlements") {
      // Final pay on departure: owed once approved, then paid out.
      if (!["Approved", "Paid"].includes(data.status ?? "")) continue;
      const gross = num(data.grossPayable);
      if (!gross) continue;
      const net = num(data.netPayable);
      const salaryPart = Math.min(gross, (num(data.monthlySalary) / 30) * num(data.pendingSalaryDays));
      const recovered = num(data.loanRecovery);
      const other = num(data.otherDeductions);
      const date = data.lastWorkingDay || record.createdAt.slice(0, 10);
      const paidDate = data.paidDate || date;
      const base = { number: "", name: data.employee ?? "", customer: "", supplier: "", memo: `Final settlement${data.reason ? ` · ${data.reason}` : ""}`, sourceKind: "hr-settlements", sourceId: record.id };
      const dues: Array<[string, number]> = [[salaries, salaryPart], [settlementExpense(), gross - salaryPart], ...(recovered ? [[employeeLoans(), -recovered] as [string, number]] : []), ...(other ? [[employeeRecoveries(), -other] as [string, number]] : [])];
      if (method === "accrual") {
        post({ ...base, type: "Final settlement", txnId: `fs-${record.id}`, date }, [...dues, [payrollLiabilities, -net]]);
        if (data.status === "Paid" && net > 0) post({ ...base, type: "Final settlement payment", txnId: `fs-pay-${record.id}`, date: paidDate }, [[payrollLiabilities, net], [paymentAccountName(data), -net]]);
      } else if (data.status === "Paid") {
        post({ ...base, type: "Final settlement payment", txnId: `fs-pay-${record.id}`, date: paidDate }, [...dues, [paymentAccountName(data), -net]]);
      }
      continue;
    }
  }

  postings.sort((a, b) => a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId));
  return {
    accounts,
    postings,
    ar,
    ap,
    inputTax,
    salesTax,
    sales,
    openingEquity,
    retainedEarnings,
    payrollLiabilities,
    salaries,
    fiscalYearStartMonth: fiscalIndex >= 0 ? fiscalIndex : 0,
  };
}

export function accountOf(ledger: Ledger, name: string): LedgerAccount {
  return ledger.accounts.get(key(name)) ?? { name, code: "", category: "Expense", accountType: "Expenses", detailType: "" };
}
