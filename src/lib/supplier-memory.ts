/**
 * What the books remember about a supplier, so a new bill or expense fills
 * itself in: the supplier's own rule (default category and tax), else the
 * lines of their last bill or expense. Also spots a purchase entered twice.
 */
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseLinesFromData } from "@/lib/expense-utils";
import { parseInvoiceLines } from "@/lib/invoice-utils";

export interface SuggestedLine {
  category: string;
  description: string;
  amount: string;
  taxRate?: string;
}

export interface SupplierSuggestion {
  /** "rule" when the supplier has a default category or tax; "last" when it copies their last purchase. */
  source: "rule" | "last";
  lines: SuggestedLine[];
  /** The purchase the lines came from, for "last". */
  from?: BookkeepingRecord;
}

const purchaseKinds = new Set(["bills", "expenses"]);
const closed = new Set(["Void", "Cancelled"]);
const same = (left: string | undefined, right: string | undefined) => Boolean(left?.trim()) && left!.trim().toLowerCase() === right?.trim().toLowerCase();

/** The supplier on a bill (vendor) or an expense (payee). */
export const supplierOf = (data: Record<string, string>) => data.vendor || data.payee || "";
const dateOf = (record: BookkeepingRecord) => record.data.billDate || record.data.expenseDate || record.createdAt.slice(0, 10);

/** The supplier record with this name. */
export function supplierNamed(vendors: BookkeepingRecord[], name: string) {
  return vendors.find((vendor) => same(vendor.data.name, name) || same(vendor.data.displayName, name));
}

/** The supplier's latest bill or expense, other than the one being edited. */
export function lastPurchase(history: BookkeepingRecord[], supplier: string, excludeId = ""): BookkeepingRecord | undefined {
  return history
    .filter((record) => purchaseKinds.has(record.kind) && record.id !== excludeId && !closed.has(record.data.status ?? "") && same(supplierOf(record.data), supplier))
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.createdAt.localeCompare(a.createdAt))[0];
}

/** The category lines of a purchase, with their tax; item lines are left out. */
export function categoryLines(record: BookkeepingRecord): SuggestedLine[] {
  const taxes = parseInvoiceLines(record.data.lineItems ?? "").filter((line) => !line.itemId).map((line) => line.taxRate);
  return expenseLinesFromData(record.data)
    .filter((line) => line.category.trim())
    .map((line, index) => ({ category: line.category, description: line.description, amount: line.amount ? String(line.amount) : "", ...(taxes[index] ? { taxRate: taxes[index] } : {}) }));
}

/**
 * The lines to start a new purchase from this supplier with: their rule when
 * they have one, else the categories (not the amounts) of their last purchase.
 */
export function supplierSuggestion(supplier: string, vendors: BookkeepingRecord[], history: BookkeepingRecord[], accounts: BookkeepingRecord[], excludeId = ""): SupplierSuggestion | null {
  if (!supplier.trim()) return null;
  const vendor = supplierNamed(vendors, supplier);
  const ruleCategory = vendor?.data.defaultExpenseAccount ? accounts.find((account) => account.id === vendor.data.defaultExpenseAccount)?.data.name?.trim() ?? "" : "";
  const taxValue = Number(vendor?.data.defaultTaxRate);
  const ruleTax = vendor?.data.defaultTaxRate?.trim() && Number.isFinite(taxValue) && taxValue >= 0 ? String(taxValue) : "";
  const last = lastPurchase(history, supplier, excludeId);
  if (ruleCategory) return { source: "rule", lines: [{ category: ruleCategory, description: "", amount: "", ...(ruleTax ? { taxRate: ruleTax } : {}) }] };
  const lines = last ? categoryLines(last).map((line) => ({ ...line, amount: "", ...(ruleTax ? { taxRate: ruleTax } : {}) })) : [];
  if (lines.length) return { source: "last", lines, from: last };
  return ruleTax ? { source: "rule", lines: [{ category: "", description: "", amount: "", taxRate: ruleTax }] } : null;
}

/**
 * Bills and expenses that look like this one entered again: the same supplier
 * with the same bill or reference number, or the same amount on the same date.
 */
export function possibleDuplicates(history: BookkeepingRecord[], data: Record<string, string>, excludeId = ""): BookkeepingRecord[] {
  const supplier = supplierOf(data);
  if (!supplier.trim()) return [];
  const number = (data.billNumber || data.referenceNumber || "").trim().toLowerCase();
  const amount = Number(data.amount) || 0;
  const date = data.billDate || data.expenseDate || "";
  return history.filter((record) => {
    if (!purchaseKinds.has(record.kind) || record.id === excludeId || closed.has(record.data.status ?? "") || !same(supplierOf(record.data), supplier)) return false;
    const otherNumber = (record.data.billNumber || record.data.referenceNumber || "").trim().toLowerCase();
    if (number && otherNumber === number) return true;
    return amount > 0 && Math.abs((Number(record.data.amount) || 0) - amount) < 0.005 && Boolean(date) && (record.data.billDate || record.data.expenseDate) === date;
  });
}

/** A supplier named in a bank line, with a default category: that category, for when no bank rule fits. */
type Row = { id: string; data: Record<string, string> };

export function supplierCategoryForBankLine(description: string, vendors: Row[], accounts: Row[]) {
  const text = description.toLowerCase();
  const vendor = vendors.find((row) => {
    const name = row.data.name?.trim().toLowerCase() ?? "";
    return row.data.defaultExpenseAccount && name.length >= 3 && text.includes(name);
  });
  if (!vendor) return null;
  const category = accounts.find((account) => account.id === vendor.data.defaultExpenseAccount)?.data.name?.trim();
  return category ? { category, supplier: vendor.data.name.trim() } : null;
}
