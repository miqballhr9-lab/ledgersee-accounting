import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import type { CountryCode } from "@/lib/tax-packs";

/**
 * Works out a tax return for a period from the documents already in the books:
 * invoices and credit notes on the sales side, bills, expenses and supplier
 * credits on the purchase side. Each document's tax rate is matched to the
 * Taxes list to decide its line (standard, zero-rated, exempt, further tax,
 * provincial services).
 */

export interface TaxLine {
  id: string;
  side: "Sales" | "Purchases";
  kind: string;
  number: string;
  date: string;
  party: string;
  partyTaxId: string;
  rate: number;
  category: string;
  /** The tax from the Taxes list this document matched, for reports by jurisdiction. */
  taxName: string;
  taxable: number;
  tax: number;
}

export interface ReturnRow {
  box: string;
  label: string;
  amount: number;
  tax: number;
  strong?: boolean;
}

const documentTypes: Record<string, { side: "Sales" | "Purchases"; sign: 1 | -1; date: string; number: string; party: string; label: string }> = {
  invoices: { side: "Sales", sign: 1, date: "issueDate", number: "invoiceNumber", party: "customer", label: "Invoice" },
  "credit-notes": { side: "Sales", sign: -1, date: "date", number: "creditNumber", party: "customer", label: "Credit note" },
  bills: { side: "Purchases", sign: 1, date: "billDate", number: "billNumber", party: "vendor", label: "Bill" },
  expenses: { side: "Purchases", sign: 1, date: "expenseDate", number: "referenceNumber", party: "payee", label: "Expense" },
  "supplier-credits": { side: "Purchases", sign: -1, date: "date", number: "creditNumber", party: "vendor", label: "Supplier credit" },
};

function money(value: string | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

/** Which kind of tax a document carries, from its stored tax name or its rate. */
function categoryFor(doc: BookkeepingRecord, rate: number, taxes: BookkeepingRecord[], side: "Sales" | "Purchases") {
  const named = doc.data.taxName ? taxes.find((tax) => tax.data.name === doc.data.taxName) : undefined;
  if (named?.data.type) return { category: named.data.type, taxName: named.data.name };
  if (/exempt/i.test(doc.data.taxName ?? "")) return { category: "Exempt", taxName: doc.data.taxName ?? "Exempt" };
  if (rate === 0) return { category: "Zero-rated", taxName: doc.data.taxName || "0%" };
  const usable = taxes.filter((tax) => tax.data.enabled !== "false" && (tax.data.appliesTo || "Both") !== (side === "Sales" ? "Purchases" : "Sales"));
  const match = usable.find((tax) => money(tax.data.rate) === rate && tax.data.isDefault === "true") ?? usable.find((tax) => money(tax.data.rate) === rate);
  return { category: match?.data.type || "Standard", taxName: match?.data.name || `${rate}%` };
}

export function taxLines(records: BookkeepingRecord[], taxes: BookkeepingRecord[], parties: BookkeepingRecord[], from: string, to: string): TaxLine[] {
  return records.flatMap((doc) => {
    const type = documentTypes[doc.kind];
    if (!type) return [];
    if (["Draft", "Cancelled", "Void"].includes(doc.data.status ?? "")) return [];
    const date = doc.data[type.date] ?? "";
    if (!date || date < from || date > to) return [];
    const rate = money(doc.data.taxRate);
    const subtotal = doc.data.subtotal !== undefined ? money(doc.data.subtotal) : money(doc.data.amount) - money(doc.data.taxAmount);
    const tax = doc.data.taxAmount !== undefined ? money(doc.data.taxAmount) : subtotal * (rate / 100);
    const partyName = doc.data[type.party] ?? "";
    const party = parties.find((row) => row.data.name?.trim().toLowerCase() === partyName.trim().toLowerCase());
    return [{
      id: doc.id,
      side: type.side,
      kind: type.label,
      number: doc.data[type.number] || "—",
      date,
      party: partyName,
      partyTaxId: party?.data.taxId ?? "",
      rate,
      ...categoryFor(doc, rate, taxes, type.side),
      taxable: subtotal * type.sign,
      tax: tax * type.sign,
    }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function sum(lines: TaxLine[], pick: (line: TaxLine) => boolean) {
  const chosen = lines.filter(pick);
  return { amount: chosen.reduce((total, line) => total + line.taxable, 0), tax: chosen.reduce((total, line) => total + line.tax, 0) };
}

/** The return's boxes, laid out as the country's tax authority asks for them. */
export function returnRows(country: CountryCode, lines: TaxLine[]): ReturnRow[] {
  const sales = (category: string) => sum(lines, (line) => line.side === "Sales" && line.category === category);
  const purchases = (category: string) => sum(lines, (line) => line.side === "Purchases" && line.category === category);
  const taxedSales = sum(lines, (line) => line.side === "Sales" && !["Zero-rated", "Exempt"].includes(line.category));
  const taxedPurchases = sum(lines, (line) => line.side === "Purchases" && !["Zero-rated", "Exempt", "Withholding"].includes(line.category));
  const allSales = sum(lines, (line) => line.side === "Sales");
  const allPurchases = sum(lines, (line) => line.side === "Purchases");

  if (country === "PK") {
    const standard = sum(lines, (line) => line.side === "Sales" && ["Standard", "Reduced"].includes(line.category));
    const further = sales("Further tax");
    const provincial = sales("Provincial services");
    const input = sum(lines, (line) => line.side === "Purchases" && ["Standard", "Reduced", "Further tax"].includes(line.category));
    const federalOutput = standard.tax + further.tax;
    return [
      { box: "A", label: "Taxable supplies at standard / reduced rates (GST)", ...standard },
      { box: "B", label: "Further tax on supplies to unregistered persons", ...further },
      { box: "C", label: "Zero-rated supplies (exports)", ...sales("Zero-rated") },
      { box: "D", label: "Exempt supplies", ...sales("Exempt") },
      { box: "E", label: "Total output tax (FBR)", amount: standard.amount + further.amount, tax: federalOutput, strong: true },
      { box: "F", label: "Purchases with input tax", ...input },
      { box: "G", label: "Zero-rated and exempt purchases", amount: purchases("Zero-rated").amount + purchases("Exempt").amount, tax: 0 },
      { box: "H", label: federalOutput - input.tax >= 0 ? "Sales tax payable to FBR" : "Input tax carried forward", amount: 0, tax: Math.abs(federalOutput - input.tax), strong: true },
      { box: "P", label: "Provincial sales tax on services (PRA / SRB / KPRA / BRA)", ...provincial, strong: true },
    ];
  }

  if (country === "AE") {
    const standard = sales("Standard");
    const expenses = taxedPurchases;
    const due = standard.tax;
    return [
      { box: "1", label: "Standard rated supplies", ...standard },
      { box: "4", label: "Zero-rated supplies", ...sales("Zero-rated") },
      { box: "5", label: "Exempt supplies", ...sales("Exempt") },
      { box: "8", label: "Totals (sales)", amount: allSales.amount, tax: standard.tax, strong: true },
      { box: "9", label: "Standard rated expenses", ...expenses },
      { box: "11", label: "Totals (expenses)", amount: allPurchases.amount, tax: expenses.tax, strong: true },
      { box: "12", label: "Total value of due tax for the period", amount: 0, tax: due },
      { box: "13", label: "Total value of recoverable tax for the period", amount: 0, tax: expenses.tax },
      { box: "14", label: due - expenses.tax >= 0 ? "Payable tax for the period" : "Repayable tax (refund)", amount: 0, tax: Math.abs(due - expenses.tax), strong: true },
    ];
  }

  if (country === "SA") {
    const standard = sales("Standard");
    return [
      { box: "1", label: "Standard rated sales (15%)", ...standard },
      { box: "3", label: "Zero-rated domestic sales", ...sales("Zero-rated") },
      { box: "5", label: "Exempt sales", ...sales("Exempt") },
      { box: "6", label: "Total sales", amount: allSales.amount, tax: standard.tax, strong: true },
      { box: "7", label: "Standard rated domestic purchases (15%)", ...taxedPurchases },
      { box: "10", label: "Zero-rated purchases", ...purchases("Zero-rated") },
      { box: "11", label: "Exempt purchases", ...purchases("Exempt") },
      { box: "12", label: "Total purchases", amount: allPurchases.amount, tax: taxedPurchases.tax, strong: true },
      { box: "15", label: standard.tax - taxedPurchases.tax >= 0 ? "Net VAT due" : "Net VAT refundable", amount: 0, tax: Math.abs(standard.tax - taxedPurchases.tax), strong: true },
    ];
  }

  if (country === "GB") {
    const outputVat = taxedSales.tax;
    const inputVat = taxedPurchases.tax;
    return [
      { box: "1", label: "VAT due on sales and other outputs", amount: 0, tax: outputVat },
      { box: "2", label: "VAT due on acquisitions from the EU (Northern Ireland goods only)", amount: 0, tax: 0 },
      { box: "3", label: "Total VAT due (boxes 1 + 2)", amount: 0, tax: outputVat, strong: true },
      { box: "4", label: "VAT reclaimed on purchases and other inputs", amount: 0, tax: inputVat },
      { box: "5", label: outputVat - inputVat >= 0 ? "Net VAT to pay HMRC" : "Net VAT to reclaim from HMRC", amount: 0, tax: Math.abs(outputVat - inputVat), strong: true },
      { box: "6", label: "Total value of sales excluding VAT", amount: Math.round(allSales.amount), tax: 0 },
      { box: "7", label: "Total value of purchases excluding VAT", amount: Math.round(allPurchases.amount), tax: 0 },
      { box: "8", label: "Total value of goods supplied to the EU (Northern Ireland only)", amount: 0, tax: 0 },
      { box: "9", label: "Total value of goods acquired from the EU (Northern Ireland only)", amount: 0, tax: 0 },
    ];
  }

  if (country === "US") {
    const names = [...new Set(lines.filter((line) => line.side === "Sales").map((line) => line.taxName))].sort();
    const rows: ReturnRow[] = names.map((name, index) => ({ box: String(index + 1), label: name, ...sum(lines, (line) => line.side === "Sales" && line.taxName === name) }));
    return [
      ...rows,
      { box: "T", label: "Total sales tax collected (file and pay each state separately)", amount: allSales.amount, tax: taxedSales.tax, strong: true },
    ];
  }

  return [
    { box: "1", label: "Taxable sales", ...taxedSales },
    { box: "2", label: "Zero-rated and exempt sales", amount: allSales.amount - taxedSales.amount, tax: 0 },
    { box: "3", label: "Taxable purchases", ...taxedPurchases },
    { box: "4", label: taxedSales.tax - taxedPurchases.tax >= 0 ? "Net tax payable" : "Net tax refundable", amount: 0, tax: Math.abs(taxedSales.tax - taxedPurchases.tax), strong: true },
  ];
}

/** Withholding tax rates set up for purchases, for the WHT summary on Pakistan returns. */
export function withholdingRates(taxes: BookkeepingRecord[]) {
  return taxes.filter((tax) => tax.data.type === "Withholding" && tax.data.enabled !== "false");
}
