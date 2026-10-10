import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

export type BudgetPeriod = "Monthly" | "Quarterly" | "Annual" | "Custom";
export type BudgetLineType = "Income" | "Expense";
export type BudgetCategory = "Sales" | "Expenses";

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
      const type = line.type === "Income" ? "Income" : "Expense";
      const legacyCategory = typeof line.category === "string" ? line.category : "";
      const category: BudgetCategory = legacyCategory === "Sales" || legacyCategory === "Expenses" ? legacyCategory : type === "Income" ? "Sales" : "Expenses";
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
    const date = record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.data.paymentDate || record.createdAt.slice(0, 10);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
}

export function budgetActual(line: BudgetLine, records: BookkeepingRecord[]) {
  const budgetHead = line.budgetHead.trim().toLocaleLowerCase();
  if (!budgetHead) return 0;

  if (line.type === "Income") {
    return records
      .filter((record) => {
        if (record.kind !== "invoices" || ["Draft", "Cancelled"].includes(record.data.status ?? "")) return false;
        const allSales = ["sales", "income", "revenue", "all sales"].includes(budgetHead) || budgetHead.includes("sales") || budgetHead.includes("revenue");
        return allSales || record.data.category?.trim().toLocaleLowerCase() === budgetHead || record.data.customer?.trim().toLocaleLowerCase() === budgetHead;
      })
      .reduce((sum, record) => sum + Math.max(0, (Number(record.data.amount) || 0) - (Number(record.data.creditApplied) || 0)), 0);
  }

  const allCosts = ["expenses", "all expenses", "operating expenses", "all costs"].includes(budgetHead);
  return records
    .filter((record) => {
      if (record.kind !== "expenses" && record.kind !== "bills") return false;
      if (record.data.status === "Cancelled") return false;
      return allCosts || record.data.category?.trim().toLocaleLowerCase() === budgetHead;
    })
    .reduce((sum, record) => sum + (Number(record.data.amount) || 0), 0);
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
