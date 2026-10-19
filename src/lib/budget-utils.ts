import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseLinesFromData } from "@/lib/expense-utils";
import { homeRate } from "@/lib/invoice-utils";
import type { Ledger, Posting } from "@/lib/ledger";

export type BudgetPeriod = "Monthly" | "Quarterly" | "Annual" | "Custom";
export type BudgetLineType = "Income" | "Expense";
export type BudgetCategory = "Sales" | "Expenses" | "Payroll";

export interface BudgetLine {
  category: BudgetCategory;
  budgetHead: string;
  headKey?: string;
  type: BudgetLineType;
  expected: string;
  description: string;
}

export function parseBudgetLines(value: string | undefined): BudgetLine[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const line = item as Record<string, unknown>;
      const suppliedType = line.type === "Income" ? "Income" : "Expense";
      const legacyCategory = typeof line.category === "string" ? line.category : "";
      const category: BudgetCategory = legacyCategory === "Sales" || legacyCategory === "Expenses" || legacyCategory === "Payroll" ? legacyCategory : suppliedType === "Income" ? "Sales" : "Expenses";
      const type = category === "Sales" ? "Income" : "Expense";
      const budgetHead = typeof line.budgetHead === "string" ? line.budgetHead : category === legacyCategory ? "" : legacyCategory;
      return [{
        category,
        budgetHead,
        headKey: typeof line.headKey === "string" ? line.headKey : "",
        type,
        expected: typeof line.expected === "string" || typeof line.expected === "number" ? String(line.expected) : "0",
        description: typeof line.description === "string" ? line.description : "",
      }];
    });
  } catch {
    return [];
  }
}

export function budgetExpectedTotal(lines: BudgetLine[]) {
  return lines.reduce((sum, line) => sum + (Number(line.expected) || 0), 0);
}

export function budgetVariance(line: BudgetLine, actual: number) {
  const expected = Number(line.expected) || 0;
  return line.type === "Income" ? actual - expected : expected - actual;
}

export function recordsWithinBudgetDates(records: BookkeepingRecord[], startDate: string, endDate: string) {
  return records.filter((record) => {
    if (record.kind === "payroll" && /^\d{4}-\d{2}$/.test(record.data.month ?? "")) {
      const payrollStart = `${record.data.month}-01`;
      const [year, month] = record.data.month.split("-").map(Number);
      const payrollEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      return (!startDate || payrollEnd >= startDate) && (!endDate || payrollStart <= endDate);
    }
    const date = record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.data.paymentDate || record.createdAt.slice(0, 10);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
}

/** Payroll budget heads and the payroll entry fields whose total is each head's actual. */
export const payrollBudgetHeads = [
  { head: "Base Salary", fields: ["baseSalary"] },
  { head: "Increment", fields: ["increment"] },
  { head: "Incentive", fields: ["incentive"] },
  { head: "Overtime", fields: ["overtimeAllowance"] },
  { head: "Gym Allowance", fields: ["gymAllowance"] },
  { head: "Medical Allowance", fields: ["medicalAllowance"] },
  { head: "Other Allowance", fields: ["otherAllowance"] },
  { head: "Total Allowances", fields: ["incentive", "overtimeAllowance", "gymAllowance", "medicalAllowance", "otherAllowance"] },
  { head: "Gross Salary", fields: ["grossSalary"] },
  { head: "Tax", fields: ["taxDeduction"] },
  { head: "Advance / Loan", fields: ["advanceDeduction", "loanDeduction"] },
  { head: "Fine", fields: ["fineDeduction"] },
  { head: "EOBI / PF", fields: ["socialDeduction"] },
  { head: "Other Adjustment", fields: ["adjustment"] },
  { head: "Payable Salary", fields: ["payableSalary"] },
  { head: "Employer Contributions", fields: ["employerContribution"] },
] as const;

export function payrollBudgetHead(name: string) {
  const key = name.trim().toLocaleLowerCase();
  return payrollBudgetHeads.find((item) => item.head.toLocaleLowerCase() === key);
}

/** Documents that are not in the books: drafts, voided or cancelled ones, opening balances and unapproved automation. */
function outsideBooks(record: BookkeepingRecord) {
  return ["Draft", "Cancelled", "Void", "Pending approval"].includes(record.data.status ?? "") || record.data.docType === "Opening balance" || record.data.awaitingApproval === "true";
}

/**
 * The books a budget is compared with: the ledger (every posting, as the
 * Profit and Loss uses), the budget's dates, and the records behind postings.
 */
export interface BudgetBooks {
  ledger: Ledger;
  records: BookkeepingRecord[];
  startDate: string;
  endDate: string;
}

const allIncomeHeads = ["sales", "income", "revenue", "all sales", "all income"];
const allCostHeads = ["expenses", "all expenses", "operating expenses", "all costs"];

/**
 * The postings behind a budget line, from the ledger: the chart account the
 * head names, all income or all costs for the general heads, or a customer's
 * income. Payroll heads are worked out from the salaries themselves (null).
 */
export function budgetActualPostings(line: BudgetLine, books: BudgetBooks): Posting[] | null {
  if (line.category === "Payroll") return null;
  const head = line.budgetHead.trim().toLocaleLowerCase();
  if (!head) return [];
  const category = line.type === "Income" ? "Income" : "Expense";
  const categoryOf = (name: string) => books.ledger.accounts.get(name.trim().toLowerCase())?.category;
  const within = books.ledger.postings.filter((posting) => (!books.startDate || posting.date >= books.startDate) && (!books.endDate || posting.date <= books.endDate) && categoryOf(posting.account) === category);
  const named = books.ledger.accounts.get(head);
  if (named?.category === category) return within.filter((posting) => posting.account.trim().toLowerCase() === head);
  if (category === "Income") {
    if (allIncomeHeads.includes(head)) return within;
    if (head === "revenue · invoices") return within.filter((posting) => posting.sourceKind === "invoices" || posting.sourceKind === "credit-notes");
    return within.filter((posting) => posting.customer.trim().toLocaleLowerCase() === head);
  }
  // All costs leave salaries out: payroll has its own heads on the budget.
  return allCostHeads.includes(head) ? within.filter((posting) => posting.sourceKind !== "payroll") : [];
}

/**
 * A line whose head is a chart account (saved as "account:<id>") with that
 * account's current name and type, as the budget screen shows it.
 */
export function resolveBudgetLineAccount(line: BudgetLine, accounts: BookkeepingRecord[]): BudgetLine {
  const reference = (value: string) => {
    const trimmed = value.trim();
    const id = trimmed.startsWith("account:") ? trimmed.slice("account:".length) : /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(trimmed) ? trimmed : "";
    return id ? accounts.find((account) => account.kind === "accounts" && account.id === id && (account.data.type === "Income" || account.data.type === "Expense") && account.data.name?.trim()) : undefined;
  };
  const account = reference(line.headKey ?? "") ?? reference(line.budgetHead);
  if (!account) return line;
  const type = account.data.type === "Income" ? "Income" : "Expense";
  return { ...line, category: type === "Income" ? "Sales" : "Expenses", type, budgetHead: account.data.name.trim(), headKey: `account:${account.id}` };
}

export function budgetActualRecords(line: BudgetLine, allRecords: BookkeepingRecord[], books?: BudgetBooks) {
  const postings = books ? budgetActualPostings(line, books) : null;
  if (books && postings) {
    const ids = new Set(postings.map((posting) => posting.sourceId.split("#")[0]));
    return books.records.filter((record) => ids.has(record.id));
  }
  const records = allRecords.filter((record) => !outsideBooks(record));
  const budgetHead = line.budgetHead.trim().toLocaleLowerCase();
  if (!budgetHead) return [];

  if (line.category === "Payroll") {
    return records.filter((record) => record.kind === "payroll");
  }

  if (line.type === "Income") {
    return records
      .filter((record) => {
        if (record.kind !== "invoices") return false;
        const allSales = ["sales", "income", "revenue", "all sales"].includes(budgetHead) || budgetHead.includes("sales") || budgetHead.includes("revenue");
        return allSales || record.data.category?.trim().toLocaleLowerCase() === budgetHead || record.data.customer?.trim().toLocaleLowerCase() === budgetHead;
      });
  }

  const allCosts = ["expenses", "all expenses", "operating expenses", "all costs"].includes(budgetHead);
  return records
    .filter((record) => {
      if (record.kind !== "expenses" && record.kind !== "bills") return false;
      if (allCosts) return true;
      return expenseLinesFromData(record.data).some((expenseLine) => expenseLine.category.toLocaleLowerCase() === budgetHead);
    });
}

/**
 * The actual for a budget line, in the home currency. With the books, it is
 * what the ledger posted to the head's account in the budget's dates, as the
 * Profit and Loss shows it; payroll heads add up the salaries' own fields.
 */
export function budgetActual(line: BudgetLine, records: BookkeepingRecord[], homeCurrency = "", books?: BudgetBooks) {
  const postings = books ? budgetActualPostings(line, books) : null;
  if (postings) {
    const total = postings.reduce((sum, posting) => sum + posting.amount, 0);
    return Math.round((line.type === "Income" ? -total : total) * 100) / 100;
  }
  return budgetActualRecords(line, records).reduce((sum, record) => {
    const rate = homeRate(record.data, homeCurrency);
    if (record.kind === "payroll") {
      const fields: readonly string[] = payrollBudgetHead(line.budgetHead)?.fields ?? ["grossSalary"];
      return sum + fields.reduce((fieldTotal, field) => fieldTotal + (Number(record.data[field]) || 0), 0);
    }
    // Income is counted before tax, as the Profit and Loss shows it.
    if (record.kind === "invoices") return sum + Math.max(0, (Number(record.data.amount) || 0) - (Number(record.data.taxAmount) || 0) - (Number(record.data.creditApplied) || 0)) * rate;
    if (record.kind === "expenses" || record.kind === "bills") {
      const budgetHead = line.budgetHead.trim().toLocaleLowerCase();
      const allCosts = ["expenses", "all expenses", "operating expenses", "all costs"].includes(budgetHead);
      return sum + expenseLinesFromData(record.data)
        .filter((expenseLine) => allCosts || expenseLine.category.toLocaleLowerCase() === budgetHead)
        .reduce((expenseTotal, expenseLine) => expenseTotal + expenseLine.amount, 0) * rate;
    }
    return sum + (Number(record.data.amount) || 0) * rate;
  }, 0);
}

export function budgetPresetRange(period: Exclude<BudgetPeriod, "Custom">, asOfDate: string) {
  const [year, month] = asOfDate.split("-").map(Number);
  const monthIndex = month - 1;
  let startMonth = monthIndex;
  let endMonth = monthIndex;
  if (period === "Quarterly") {
    startMonth = Math.floor(monthIndex / 3) * 3;
    endMonth = startMonth + 2;
  } else if (period === "Annual") {
    startMonth = 0;
    endMonth = 11;
  }
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, endMonth + 1, 0));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}

export function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * A budget read like a profit and loss: income at the top, expenses below,
 * and the profit (or loss) they leave, planned and actual. Variance is
 * favorable when positive: more income, or less spending, than planned.
 */
export function budgetTotals(lines: BudgetLine[], actuals: number[]) {
  const side = (type: BudgetLineType) => lines.reduce((total, line, index) => (line.type === type ? { expected: total.expected + (Number(line.expected) || 0), actual: total.actual + (actuals[index] ?? 0) } : total), { expected: 0, actual: 0 });
  const income = side("Income");
  const expense = side("Expense");
  const profit = { expected: income.expected - expense.expected, actual: income.actual - expense.actual };
  return { income, expense, profit, variance: profit.actual - profit.expected };
}
