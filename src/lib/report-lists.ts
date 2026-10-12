import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseLinesFromData } from "@/lib/expense-utils";
import { parseInvoiceLines } from "@/lib/invoice-utils";
import { accountOf, type Ledger } from "@/lib/ledger";
import { formatLongDate, periodLabel, type ReportColumn, type ReportLine, type ReportOptions, type ReportResult, type ZoomSpec } from "@/lib/reports";
import { taxLines } from "@/lib/tax-return";
import { buildInventory, itemTypeLabel } from "@/lib/inventory";

/**
 * List and detail reports (who owes you, what you owe, sales, purchases and
 * tax), built straight from the documents. Amounts are in the base currency.
 */

interface Row {
  values: (string | number | null)[];
  source?: { kind: string; id: string };
  zooms?: (ZoomSpec | null)[];
}

type Col = ReportColumn;
const text = (key: string, label: string): Col => ({ key, label, kind: "text" });
const amount = (key: string, label: string): Col => ({ key, label, kind: "amount" });
const pct = (key: string, label: string): Col => ({ key, label, kind: "pct" });

const openStatuses = (status: string | undefined) => !["Draft", "Cancelled", "Void"].includes(status ?? "");

function rate(data: Record<string, string>) {
  const value = Number(data.exchangeRate);
  return data.currency && value > 0 ? value : 1;
}

function num(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysLate(due: string, asOf: string) {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
}

/**
 * Grouped list: a header per group, its rows, and a total line summing the
 * amount columns. With no grouping, rows sit at the top level.
 */
function grouped(columns: Col[], groups: Array<{ label: string; rows: Row[]; zooms?: (ZoomSpec | null)[] }>, options: { grandTotal?: boolean; groupTotals?: boolean; runningBalance?: number; flat?: boolean } = {}): ReportLine[] {
  const lines: ReportLine[] = [];
  const sumColumns = columns.map((column) => column.kind === "amount" && column.key !== "balance");
  const grand = columns.map(() => 0);
  groups.forEach((group, groupIndex) => {
    if (!group.rows.length) return;
    const id = `g${groupIndex}`;
    if (!options.flat) lines.push({ id, label: group.label, kind: "section", depth: 0, values: columns.map(() => null) });
    const totals = columns.map(() => 0);
    let running = 0;
    group.rows.forEach((row, rowIndex) => {
      const values = [...row.values];
      columns.forEach((column, index) => {
        if (sumColumns[index] && typeof values[index] === "number") totals[index] += values[index] as number;
      });
      if (options.runningBalance !== undefined) {
        running += (values[options.runningBalance] as number) || 0;
        values[columns.findIndex((column) => column.key === "balance")] = running;
      }
      lines.push({ id: `${id}:${rowIndex}`, parentId: options.flat ? undefined : id, label: "", kind: "account", depth: options.flat ? 0 : 1, values, source: row.source, zooms: row.zooms });
    });
    totals.forEach((value, index) => { grand[index] += value; });
    if (!options.flat && options.groupTotals !== false) {
      lines.push({ id: `${id}:total`, parentId: id, label: `Total for ${group.label}`, kind: "total", depth: 0, values: columns.map((_, index) => (sumColumns[index] ? totals[index] : null)), zooms: group.zooms });
    }
  });
  if (options.grandTotal !== false && lines.length) {
    lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: columns.map((_, index) => (sumColumns[index] ? grand[index] : null)) });
  }
  return lines;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(keyOf(item), [...(map.get(keyOf(item)) ?? []), item]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface OpenDoc {
  record: BookkeepingRecord;
  date: string;
  due: string;
  number: string;
  party: string;
  total: number;
  open: number;
  late: number;
}

/** Invoices or bills with money still owed on the as-of date. */
function openDocuments(records: BookkeepingRecord[], side: "receivable" | "payable", asOf: string, includePaid = false): OpenDoc[] {
  const kind = side === "receivable" ? "invoices" : "bills";
  const paid = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== "payments") continue;
    const target = side === "receivable" ? record.data.invoiceId : record.data.billId;
    if (!target || (record.data.paymentDate || "") > asOf) continue;
    paid.set(target, (paid.get(target) ?? 0) + num(record.data.amount));
  }
  const docs: OpenDoc[] = [];
  for (const record of records) {
    if (record.kind !== kind || !openStatuses(record.data.status)) continue;
    const date = (side === "receivable" ? record.data.issueDate : record.data.billDate) || record.createdAt.slice(0, 10);
    if (date > asOf) continue;
    const r = rate(record.data);
    const total = num(record.data.amount) * r;
    const open = (num(record.data.amount) - (paid.get(record.id) ?? num(record.data.paidAmount)) - num(record.data.creditApplied)) * r;
    if (open < 0.005 && !includePaid) continue;
    const due = record.data.dueDate || date;
    docs.push({
      record, date, due, total, open: Math.max(0, open), late: daysLate(due, asOf),
      number: (side === "receivable" ? record.data.invoiceNumber : record.data.billNumber) ?? "",
      party: (side === "receivable" ? record.data.customer : record.data.vendor) || "Not specified",
    });
  }
  return docs.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

function bucketOf(late: number) {
  return late <= 0 ? "Current" : late <= 30 ? "1 - 30 days past due" : late <= 60 ? "31 - 60 days past due" : late <= 90 ? "61 - 90 days past due" : "91 or more days past due";
}

const bucketOrder = ["Current", "1 - 30 days past due", "31 - 60 days past due", "61 - 90 days past due", "91 or more days past due"];

function asOfResult(columns: Col[], lines: ReportLine[], asOf: string, empty: string): ReportResult {
  return { columns, lines, period: `As of ${formatLongDate(asOf)}`, empty };
}

function periodResult(columns: Col[], lines: ReportLine[], options: ReportOptions, empty: string): ReportResult {
  return { columns, lines, period: periodLabel(options.from, options.to), empty };
}

const inPeriod = (date: string, options: ReportOptions) => date >= options.from && date <= options.to;

function partyContacts(records: BookkeepingRecord[], kind: "customers" | "vendors") {
  return new Map(records.filter((record) => record.kind === kind).map((record) => [record.data.name?.trim() ?? "", record]));
}

function contactLine(contact: BookkeepingRecord | undefined) {
  if (!contact) return "";
  return [contact.data.phone || contact.data.mobile, contact.data.email].filter(Boolean).join(" · ");
}

function addressOf(contact: BookkeepingRecord) {
  const d = contact.data;
  return [d.address, d.addressLine2, [d.city, d.state, d.postalCode].filter(Boolean).join(" "), d.country].filter(Boolean).join(", ");
}

interface SaleLine {
  record: BookkeepingRecord;
  date: string;
  type: string;
  number: string;
  customer: string;
  item: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  taxed: boolean;
}

/** Invoice and credit note lines in the period (credit notes negative), before tax and discount. */
function saleLines(records: BookkeepingRecord[], options: ReportOptions): SaleLine[] {
  const lines: SaleLine[] = [];
  for (const record of records) {
    const isInvoice = record.kind === "invoices";
    if ((!isInvoice && record.kind !== "credit-notes") || !openStatuses(record.data.status)) continue;
    const date = (isInvoice ? record.data.issueDate : record.data.date) || record.createdAt.slice(0, 10);
    if (!inPeriod(date, options)) continue;
    const sign = isInvoice ? 1 : -1;
    const r = rate(record.data);
    const parsed = parseInvoiceLines(record.data.lineItems ?? "");
    const base = { record, date, type: isInvoice ? "Invoice" : "Credit note", number: (isInvoice ? record.data.invoiceNumber : record.data.creditNumber) ?? "", customer: record.data.customer || "Not specified", taxed: num(record.data.taxRate) > 0 || num(record.data.taxAmount) > 0 };
    if (!parsed.length) {
      const value = (num(record.data.subtotal) || num(record.data.amount) - num(record.data.taxAmount)) * r * sign;
      lines.push({ ...base, item: record.data.reason ? "Credit" : "Not specified", description: record.data.reason ?? "", quantity: 0, rate: 0, amount: value });
      continue;
    }
    for (const line of parsed) {
      const quantity = num(line.quantity) * sign;
      const unit = num(line.rate) * r;
      lines.push({ ...base, item: line.name || "Not specified", description: line.description, quantity, rate: unit, amount: quantity * unit });
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

interface PurchaseLine {
  record: BookkeepingRecord;
  date: string;
  type: string;
  number: string;
  supplier: string;
  item: string;
  memo: string;
  quantity: number;
  rate: number;
  amount: number;
}

function purchaseLines(records: BookkeepingRecord[], options: ReportOptions): PurchaseLine[] {
  const lines: PurchaseLine[] = [];
  for (const record of records) {
    if (!["bills", "expenses", "supplier-credits"].includes(record.kind) || !openStatuses(record.data.status)) continue;
    const date = (record.kind === "bills" ? record.data.billDate : record.kind === "expenses" ? record.data.expenseDate : record.data.date) || record.createdAt.slice(0, 10);
    if (!inPeriod(date, options)) continue;
    const sign = record.kind === "supplier-credits" ? -1 : 1;
    const r = rate(record.data);
    const base = {
      record, date,
      type: record.kind === "bills" ? "Bill" : record.kind === "expenses" ? "Expense" : "Supplier credit",
      number: (record.kind === "bills" ? record.data.billNumber : record.kind === "expenses" ? record.data.referenceNumber : record.data.creditNumber) ?? "",
      supplier: (record.kind === "expenses" ? record.data.payee : record.data.vendor) || "Not specified",
    };
    const parsed = parseInvoiceLines(record.data.lineItems ?? "");
    if (parsed.length) {
      for (const line of parsed) {
        const quantity = num(line.quantity) * sign;
        const unit = num(line.rate) * r;
        lines.push({ ...base, item: line.name || "Not specified", memo: line.description || record.data.memo || "", quantity, rate: unit, amount: quantity * unit });
      }
    } else {
      for (const line of expenseLinesFromData(record.data)) lines.push({ ...base, item: line.category || "Not specified", memo: line.description || record.data.memo || "", quantity: 0, rate: 0, amount: line.amount * r * sign });
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every list report, by its catalog key. */
export function buildListReport(key: string, records: BookkeepingRecord[], ledger: Ledger, options: ReportOptions): ReportResult | null {
  const asOf = options.to;
  const src = (record: BookkeepingRecord) => ({ kind: record.kind, id: record.id });
  const customers = partyContacts(records, "customers");
  const vendors = partyContacts(records, "vendors");

  switch (key) {
    case "accounts-receivable-ageing-detail":
    case "accounts-payable-ageing-detail": {
      const side = key.startsWith("accounts-receivable") ? "receivable" : "payable";
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("name", side === "receivable" ? "Customer" : "Supplier"), text("due", "Due date"), amount("late", "Past due"), amount("amount", "Amount"), amount("open", "Open balance")];
      const docs = openDocuments(records, side, asOf);
      const groups = bucketOrder.map((bucket) => ({
        label: bucket,
        rows: docs.filter((doc) => bucketOf(doc.late) === bucket).map((doc) => ({ values: [doc.date, side === "receivable" ? "Invoice" : "Bill", doc.number, doc.party, doc.due, Math.max(0, doc.late) || null, doc.total, doc.open], source: src(doc.record) })),
      }));
      const lines = grouped(columns, groups);
      lines.forEach((line) => { if (line.kind !== "account") line.values[5] = null; });
      return asOfResult(columns, lines, asOf, side === "receivable" ? "No customer owes you money on this date." : "You owe no supplier money on this date.");
    }

    case "collections-report": {
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("due", "Due date"), amount("late", "Past due"), amount("amount", "Amount"), amount("open", "Open balance")];
      const docs = openDocuments(records, "receivable", asOf).filter((doc) => doc.late > 0);
      const lines = grouped(columns, groupBy(docs, (doc) => doc.party).map(([party, items]) => ({
        label: [party, contactLine(customers.get(party))].filter(Boolean).join(" · "),
        rows: items.map((doc) => ({ values: [doc.date, "Invoice", doc.number, doc.due, doc.late, doc.total, doc.open], source: src(doc.record) })),
      })));
      lines.forEach((line) => { if (line.kind !== "account") line.values[4] = null; });
      return asOfResult(columns, lines, asOf, "No overdue invoices on this date.");
    }

    case "customer-balance-summary":
    case "supplier-balance-summary": {
      const side = key === "customer-balance-summary" ? "receivable" : "payable";
      const columns = [amount("total", "Total")];
      const account = side === "receivable" ? ledger.ar : ledger.ap;
      const docs = openDocuments(records, side, asOf);
      const lines: ReportLine[] = groupBy(docs, (doc) => doc.party).map(([party, items]) => {
        const zoom: ZoomSpec = { accounts: [account], from: "", to: asOf, name: party === "Not specified" ? "" : party, nameField: "name" };
        return { id: party, label: party, kind: "account" as const, depth: 0, values: [items.reduce((sum, doc) => sum + doc.open, 0)], zooms: [zoom] };
      });
      if (lines.length) lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [docs.reduce((sum, doc) => sum + doc.open, 0)] });
      return asOfResult(columns, lines, asOf, side === "receivable" ? "No customer owes you money on this date." : "You owe no supplier money on this date.");
    }

    case "customer-balance-detail":
    case "supplier-balance-detail":
    case "open-invoices":
    case "unpaid-bills": {
      const side = key === "customer-balance-detail" || key === "open-invoices" ? "receivable" : "payable";
      const withBalance = key.endsWith("balance-detail");
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("due", "Due date"), ...(withBalance ? [] : [amount("late", "Past due")]), amount("amount", "Amount"), amount("open", "Open balance"), ...(withBalance ? [amount("balance", "Balance")] : [])];
      const docs = openDocuments(records, side, asOf);
      const lines = grouped(columns, groupBy(docs, (doc) => doc.party).map(([party, items]) => ({
        label: party,
        rows: items.map((doc) => ({ values: [doc.date, side === "receivable" ? "Invoice" : "Bill", doc.number, doc.due, ...(withBalance ? [] : [doc.late > 0 ? doc.late : null]), doc.total, doc.open, ...(withBalance ? [null] : [])], source: src(doc.record) })),
      })), { runningBalance: withBalance ? columns.findIndex((column) => column.key === "open") : undefined });
      if (!withBalance) lines.forEach((line) => { if (line.kind !== "account") line.values[4] = null; });
      return asOfResult(columns, lines, asOf, side === "receivable" ? "No open invoices on this date." : "No unpaid bills on this date.");
    }

    case "invoice-list": {
      const columns = [text("date", "Date"), text("no", "No."), text("name", "Customer"), text("due", "Due date"), text("status", "Status"), amount("amount", "Amount"), amount("open", "Open balance")];
      const docs = openDocuments(records, "receivable", options.to, true).filter((doc) => inPeriod(doc.date, options));
      const lines = grouped(columns, [{ label: "Invoices", rows: docs.map((doc) => ({ values: [doc.date, doc.number, doc.party, doc.due, doc.record.data.status || "", doc.total, doc.open], source: src(doc.record) })) }], { flat: true });
      return periodResult(columns, lines, options, "No invoices in this period.");
    }

    case "customer-statement": {
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), amount("amount", "Amount"), amount("balance", "Balance")];
      const byCustomer = new Map<string, Row[]>();
      const add = (party: string, row: Row) => byCustomer.set(party, [...(byCustomer.get(party) ?? []), row]);
      for (const posting of ledger.postings) {
        if (posting.account !== ledger.ar || posting.date > options.to) continue;
        const party = posting.customer || posting.name || "Not specified";
        if (posting.date < options.from) {
          const rows = byCustomer.get(party);
          const opening = rows?.[0]?.values[1] === "Opening balance" ? rows[0] : null;
          if (opening) opening.values[3] = ((opening.values[3] as number) || 0) + posting.amount;
          else byCustomer.set(party, [{ values: [options.from, "Opening balance", "", posting.amount, null] }, ...(rows ?? [])]);
          continue;
        }
        add(party, { values: [posting.date, posting.type, posting.number, posting.amount, null], source: { kind: posting.sourceKind, id: posting.sourceId } });
      }
      const lines = grouped(columns, [...byCustomer.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => ({ label, rows })), { runningBalance: 3, grandTotal: false });
      return periodResult(columns, lines, options, "No customer activity in this period.");
    }

    case "sales-by-customer-detail":
    case "sales-by-product-detail": {
      const byItem = key === "sales-by-product-detail";
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text(byItem ? "name" : "item", byItem ? "Customer" : "Product/Service"), text("memo", "Memo/Description"), amount("qty", "Qty"), amount("rate", "Sales price"), amount("amount", "Amount"), amount("balance", "Balance")];
      const lines = grouped(columns, groupBy(saleLines(records, options), (line) => (byItem ? line.item : line.customer)).map(([label, items]) => ({
        label,
        rows: items.map((line) => ({ values: [line.date, line.type, line.number, byItem ? line.customer : line.item, line.description, line.quantity || null, line.rate || null, line.amount, null], source: src(line.record) })),
      })), { runningBalance: 7 });
      lines.forEach((line) => { if (line.kind !== "account") line.values[6] = null; });
      return periodResult(columns, lines, options, "No sales in this period.");
    }

    case "sales-by-product-summary": {
      const columns = [amount("qty", "Quantity"), amount("amount", "Amount"), pct("share", "% of sales"), amount("avg", "Avg price")];
      const items = groupBy(saleLines(records, options), (line) => line.item);
      const total = items.reduce((sum, [, lines]) => sum + lines.reduce((s, line) => s + line.amount, 0), 0);
      const lines: ReportLine[] = items.map(([item, rows]) => {
        const qty = rows.reduce((sum, line) => sum + line.quantity, 0);
        const value = rows.reduce((sum, line) => sum + line.amount, 0);
        return { id: item, label: item, kind: "account" as const, depth: 0, values: [qty, value, total ? (value / total) * 100 : null, qty ? value / qty : null] };
      });
      if (lines.length) lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [items.reduce((sum, [, rows]) => sum + rows.reduce((s, line) => s + line.quantity, 0), 0), total, total ? 100 : null, null] });
      return periodResult(columns, lines, options, "No sales in this period.");
    }

    case "taxable-sales-summary": {
      const columns = [amount("taxable", "Taxable amount"), amount("exempt", "Non-taxable amount"), amount("total", "Total")];
      const items = groupBy(saleLines(records, options), (line) => line.item);
      const lines: ReportLine[] = items.map(([item, rows]) => {
        const taxable = rows.filter((line) => line.taxed).reduce((sum, line) => sum + line.amount, 0);
        const exempt = rows.filter((line) => !line.taxed).reduce((sum, line) => sum + line.amount, 0);
        return { id: item, label: item, kind: "account" as const, depth: 0, values: [taxable, exempt, taxable + exempt] };
      });
      const sum = (index: number) => lines.reduce((total, line) => total + ((line.values[index] as number) || 0), 0);
      if (lines.length) lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [sum(0), sum(1), sum(2)] });
      return periodResult(columns, lines, options, "No sales in this period.");
    }

    case "estimates-by-customer":
    case "sales-order-list":
    case "open-purchase-order-list": {
      const kind = key === "estimates-by-customer" ? "estimates" : key === "sales-order-list" ? "sales-orders" : "purchase-orders";
      const isPo = kind === "purchase-orders";
      const dateKey = "date";
      const secondDate = kind === "estimates" ? "expiryDate" : kind === "sales-orders" ? "deliveryDate" : "expectedDate";
      const secondLabel = kind === "estimates" ? "Expiry date" : kind === "sales-orders" ? "Delivery date" : "Expected date";
      const numberKey = kind === "estimates" ? "estimateNumber" : kind === "sales-orders" ? "orderNumber" : "poNumber";
      const columns = [text("date", "Date"), text("no", "No."), ...(kind === "sales-orders" ? [text("name", "Customer")] : []), text("second", secondLabel), text("status", "Status"), amount("amount", "Amount")];
      const docs = records.filter((record) => {
        if (record.kind !== kind) return false;
        const date = record.data[dateKey] || record.createdAt.slice(0, 10);
        if (isPo) return ["Purchase Order", "Received"].includes(record.data.status ?? "") && !record.data.convertedRecordId && !record.data.convertedKind && date <= options.to;
        return inPeriod(date, options);
      }).sort((a, b) => (a.data[dateKey] ?? "").localeCompare(b.data[dateKey] ?? ""));
      const rowOf = (record: BookkeepingRecord): Row => ({ values: [record.data[dateKey] || record.createdAt.slice(0, 10), record.data[numberKey] ?? "", ...(kind === "sales-orders" ? [record.data.customer ?? ""] : []), record.data[secondDate] ?? "", record.data.status || "Draft", num(record.data.amount) * rate(record.data)], source: src(record) });
      const lines = kind === "sales-orders"
        ? grouped(columns, [{ label: "Sales orders", rows: docs.map(rowOf) }], { flat: true })
        : grouped(columns, groupBy(docs, (record) => (isPo ? record.data.vendor : record.data.customer) || "Not specified").map(([label, items]) => ({ label, rows: items.map(rowOf) })));
      return isPo ? asOfResult(columns, lines, asOf, "No open purchase orders.") : periodResult(columns, lines, options, kind === "estimates" ? "No estimates in this period." : "No sales orders in this period.");
    }

    case "payment-method-list":
    case "bill-payment-list": {
      const incoming = key === "payment-method-list";
      const columns = [text("date", "Date"), text("no", incoming ? "Invoice no." : "Bill no."), text("name", incoming ? "Customer" : "Supplier"), text("account", incoming ? "Deposit to" : "Paid from"), amount("amount", "Amount")];
      const docRate = new Map(records.filter((record) => record.kind === "invoices" || record.kind === "bills").map((record) => [record.id, rate(record.data)]));
      // Payments whose invoice or bill no longer exists (deleted before payments were removed with it) are left out.
      const payments = records.filter((record) => record.kind === "payments" && docRate.has((incoming ? record.data.invoiceId : record.data.billId) ?? "") && inPeriod(record.data.paymentDate || "", options))
        .sort((a, b) => (a.data.paymentDate ?? "").localeCompare(b.data.paymentDate ?? ""));
      const rowOf = (record: BookkeepingRecord): Row => ({
        values: [record.data.paymentDate ?? "", (incoming ? record.data.invoiceNumber : record.data.billNumber) ?? "", (incoming ? record.data.customer : record.data.vendor) ?? "", record.data.paymentAccountName || "—", num(record.data.amount) * (docRate.get((incoming ? record.data.invoiceId : record.data.billId) ?? "") ?? 1)],
        source: { kind: incoming ? "invoices" : "bills", id: (incoming ? record.data.invoiceId : record.data.billId) ?? "" },
      });
      const lines = incoming
        ? grouped(columns, groupBy(payments, (record) => record.data.method || "Not specified").map(([label, items]) => ({ label, rows: items.map(rowOf) })))
        : grouped(columns, groupBy(payments, (record) => record.data.paymentAccountName || "Not specified").map(([label, items]) => ({ label, rows: items.map(rowOf) })));
      return periodResult(columns, lines, options, incoming ? "No payments received in this period." : "No bill payments in this period.");
    }

    case "customer-contact-list":
    case "supplier-contact-list": {
      const kind = key === "customer-contact-list" ? "customers" : "vendors";
      const side = kind === "customers" ? "receivable" : "payable";
      const open = new Map<string, number>();
      for (const doc of openDocuments(records, side, asOf)) open.set(doc.party, (open.get(doc.party) ?? 0) + doc.open);
      const columns = [text("company", "Company name"), text("phone", "Phone"), text("email", "Email"), text("address", "Address"), amount("open", "Open balance")];
      const contacts = records.filter((record) => record.kind === kind).sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
      const lines: ReportLine[] = contacts.map((record) => ({ id: record.id, label: record.data.name || "Unnamed", kind: "account" as const, depth: 0, values: [record.data.company ?? "", record.data.phone || record.data.mobile || "", record.data.email ?? "", addressOf(record), open.get(record.data.name?.trim() ?? "") ?? 0], source: src(record) }));
      return asOfResult(columns, lines, asOf, kind === "customers" ? "No customers yet." : "No suppliers yet.");
    }

    case "expenses-by-supplier-summary": {
      const expenseAccounts = [...ledger.accounts.values()].filter((account) => account.category === "Expense").map((account) => account.name);
      const expenseSet = new Set(expenseAccounts);
      const totals = new Map<string, number>();
      for (const posting of ledger.postings) {
        if (!expenseSet.has(posting.account) || !inPeriod(posting.date, options)) continue;
        const supplier = posting.supplier || posting.name || "";
        totals.set(supplier, (totals.get(supplier) ?? 0) + posting.amount);
      }
      const columns = [amount("total", "Total")];
      const lines: ReportLine[] = [...totals.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1)).map(([supplier, value]) => ({
        id: supplier || "none", label: supplier || "Not specified", kind: "account" as const, depth: 0, values: [value],
        zooms: [{ accounts: expenseAccounts, from: options.from, to: options.to, name: supplier, nameField: "supplier" }],
      }));
      if (lines.length) lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [[...totals.values()].reduce((a, b) => a + b, 0)] });
      return periodResult(columns, lines, options, "No expenses in this period.");
    }

    case "purchases-by-supplier-detail":
    case "purchases-by-product-detail": {
      const byItem = key === "purchases-by-product-detail";
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text(byItem ? "name" : "item", byItem ? "Supplier" : "Product/Service or category"), text("memo", "Memo/Description"), amount("qty", "Qty"), amount("rate", "Rate"), amount("amount", "Amount"), amount("balance", "Balance")];
      const lines = grouped(columns, groupBy(purchaseLines(records, options), (line) => (byItem ? line.item : line.supplier)).map(([label, items]) => ({
        label,
        rows: items.map((line) => ({ values: [line.date, line.type, line.number, byItem ? line.supplier : line.item, line.memo, line.quantity || null, line.rate || null, line.amount, null], source: src(line.record) })),
      })), { runningBalance: 7 });
      lines.forEach((line) => { if (line.kind !== "account") line.values[6] = null; });
      return periodResult(columns, lines, options, "No purchases in this period.");
    }

    case "transaction-list-by-supplier": {
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("memo", "Memo/Description"), text("account", "Account"), amount("amount", "Amount")];
      const txns = new Map<string, { date: string; type: string; number: string; supplier: string; memo: string; accounts: Set<string>; amount: number; source: { kind: string; id: string } }>();
      for (const posting of ledger.postings) {
        if (!posting.supplier || !inPeriod(posting.date, options)) continue;
        const entry = txns.get(posting.txnId) ?? { date: posting.date, type: posting.type, number: posting.number, supplier: posting.supplier, memo: posting.memo, accounts: new Set<string>(), amount: 0, source: { kind: posting.sourceKind, id: posting.sourceId } };
        if (posting.amount > 0) entry.amount += posting.amount;
        const category = accountOf(ledger, posting.account).category;
        if (posting.account !== ledger.ap && posting.account !== ledger.salesTax && (category === "Expense" || posting.type.includes("payment"))) entry.accounts.add(posting.account);
        txns.set(posting.txnId, entry);
      }
      const lines = grouped(columns, groupBy([...txns.values()], (entry) => entry.supplier).map(([label, items]) => ({
        label,
        rows: items.map((entry) => ({ values: [entry.date, entry.type, entry.number, entry.memo, entry.accounts.size > 1 ? "-Split-" : [...entry.accounts][0] ?? "", entry.amount], source: entry.source })),
      })));
      return periodResult(columns, lines, options, "No supplier transactions in this period.");
    }

    case "tax-detail": {
      const taxes = records.filter((record) => record.kind === "taxes");
      const lines = taxLines(records, taxes, [...customers.values(), ...vendors.values()], options.from, options.to);
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("name", "Name"), text("tax", "Tax"), pct("rate", "Rate"), amount("taxable", "Taxable amount"), amount("amount", "Tax amount")];
      const byId = new Map(records.map((record) => [record.id, record]));
      const groups = (["Sales", "Purchases"] as const).map((side) => ({
        label: side === "Sales" ? "Tax collected on sales" : "Tax paid on purchases",
        rows: lines.filter((line) => line.side === side && Math.abs(line.tax) > 0.004).sort((a, b) => a.date.localeCompare(b.date)).map((line) => {
          const record = byId.get(line.id);
          return { values: [line.date, line.kind, line.number, line.party, line.taxName, line.rate, line.taxable, line.tax], source: record ? src(record) : undefined };
        }),
      }));
      const result = grouped(columns, groups, { grandTotal: false });
      result.forEach((line) => { if (line.kind !== "account") line.values[5] = null; });
      return periodResult(columns, result, options, "No taxed transactions in this period.");
    }

    case "inventory-valuation-summary": {
      const columns = [text("sku", "SKU"), amount("qty", "Qty"), amount("value", "Asset value"), amount("avg", "Calc. avg")];
      const summaries = [...buildInventory(records, asOf).values()].sort((a, b) => (a.item.data.name ?? "").localeCompare(b.item.data.name ?? ""));
      const lines: ReportLine[] = summaries.map((summary) => ({ id: summary.item.id, label: summary.item.data.name || "Item", kind: "account" as const, depth: 0, values: [summary.item.data.sku ?? "", summary.onHand, summary.value, summary.onHand > 0 ? summary.value / summary.onHand : null], source: src(summary.item) }));
      if (lines.length) lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: ["", summaries.reduce((sum, item) => sum + item.onHand, 0), summaries.reduce((sum, item) => sum + item.value, 0), null] });
      return asOfResult(columns, lines, asOf, "No inventory items yet. Set an item's type to Inventory to track it.");
    }

    case "inventory-valuation-detail": {
      const columns = [text("date", "Date"), text("type", "Transaction type"), text("no", "No."), text("name", "Name"), amount("qty", "Qty"), amount("rate", "Rate"), amount("cost", "FIFO cost"), amount("onHand", "Qty on hand"), amount("balance", "Asset value")];
      const summaries = [...buildInventory(records, options.to).values()].sort((a, b) => (a.item.data.name ?? "").localeCompare(b.item.data.name ?? ""));
      const groups = summaries.map((summary) => ({
        label: summary.item.data.name || "Item",
        rows: summary.events.filter((event) => event.date >= options.from).map((event) => ({
          values: [event.date, event.type, event.number, event.name, event.quantity, event.unitCost, event.value, event.onHand, event.assetValue],
          source: { kind: event.sourceKind, id: event.sourceId.split("#")[0] },
        })),
      }));
      const lines = grouped(columns, groups, { grandTotal: false });
      lines.forEach((line) => { if (line.kind === "total") { line.values[5] = null; line.values[7] = null; line.values[8] = null; } });
      return periodResult(columns, lines, options, "No stock movements in this period.");
    }

    case "stock-take-worksheet": {
      const columns = [text("sku", "SKU"), text("description", "Description"), amount("qty", "Qty on hand"), amount("reorder", "Reorder point"), text("count", "Physical count")];
      const summaries = [...buildInventory(records, asOf).values()].sort((a, b) => (a.item.data.name ?? "").localeCompare(b.item.data.name ?? ""));
      const lines: ReportLine[] = summaries.map((summary) => ({ id: summary.item.id, label: summary.item.data.name || "Item", kind: "account" as const, depth: 0, values: [summary.item.data.sku ?? "", summary.item.data.unit ?? "", summary.onHand, num(summary.item.data.reorderPoint) || null, "__________"], source: src(summary.item) }));
      return asOfResult(columns, lines, asOf, "No inventory items yet.");
    }

    case "product-service-list": {
      const stock = buildInventory(records, asOf);
      const columns = [text("type", "Type"), text("sku", "SKU"), text("unit", "Unit"), amount("price", "Sales price"), amount("cost", "Purchase cost"), amount("qty", "Qty on hand"), amount("reorder", "Reorder point")];
      const items = records.filter((record) => record.kind === "items").sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
      const lines: ReportLine[] = items.map((item) => ({ id: item.id, label: item.data.name || "Item", kind: "account" as const, depth: 0, values: [itemTypeLabel(item.data.itemType), item.data.sku ?? "", item.data.unit ?? "", num(item.data.rate), num(item.data.cost) || null, stock.has(item.id) ? stock.get(item.id)!.onHand : null, num(item.data.reorderPoint) || null], source: src(item) }));
      return asOfResult(columns, lines, asOf, "No products or services yet.");
    }

    default:
      return null;
  }
}
