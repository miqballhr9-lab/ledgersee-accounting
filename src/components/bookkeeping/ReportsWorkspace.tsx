"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, CalendarRange } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface ReportsWorkspaceProps {
  records: BookkeepingRecord[];
  asOfDate: string;
}

type ReportKey = "profit-loss" | "balance-sheet" | "cash-flow" | "trial-balance" | "sales-customer" | "expenses-category" | "ageing" | "tax-summary";
type ReportRow = Record<string, string | number>;

const reportOptions: { key: ReportKey; label: string; description: string }[] = [
  { key: "profit-loss", label: "Profit & Loss", description: "Income and costs over the selected period." },
  { key: "balance-sheet", label: "Balance Sheet", description: "Assets, liabilities, and equity from your recorded balances." },
  { key: "cash-flow", label: "Cash Flow", description: "Money received and paid, grouped by month." },
  { key: "trial-balance", label: "Trial Balance", description: "Debit and credit totals from opening balances and journals." },
  { key: "sales-customer", label: "Sales by Customer", description: "Invoice totals grouped by customer." },
  { key: "expenses-category", label: "Expenses by Category", description: "Expenses and bills grouped by category." },
  { key: "ageing", label: "Receivable / Payable Ageing", description: "Open customer and supplier balances by due date." },
  { key: "tax-summary", label: "Tax Summary", description: "Tax collected from invoices at your configured rates." },
];

function rowAmount(record: BookkeepingRecord, key = "amount") {
  const amount = Number(record.data[key] ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function recordDate(record: BookkeepingRecord) {
  return record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.data.paymentDate || record.createdAt.slice(0, 10);
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function groupTotals(records: BookkeepingRecord[], groupKey: string) {
  const grouped = new Map<string, { count: number; amount: number }>();
  records.forEach((record) => {
    const name = record.data[groupKey] || "Uncategorized";
    const current = grouped.get(name) ?? { count: 0, amount: 0 };
    grouped.set(name, { count: current.count + 1, amount: current.amount + rowAmount(record) });
  });
  return [...grouped.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.amount - a.amount);
}

function buildReport(key: ReportKey, records: BookkeepingRecord[], asOfDate: string): { columns: string[]; rows: ReportRow[] } {
  const invoices = records.filter((record) => record.kind === "invoices" && !["Draft", "Cancelled"].includes(record.data.status ?? ""));
  const bills = records.filter((record) => record.kind === "bills" && record.data.status !== "Cancelled");
  const expenses = records.filter((record) => record.kind === "expenses");

  if (key === "profit-loss") {
    const income = invoices.reduce((sum, invoice) => sum + Math.max(0, rowAmount(invoice) - rowAmount(invoice, "creditApplied")), 0);
    const expenseTotal = [...bills, ...expenses].reduce((sum, expense) => sum + rowAmount(expense), 0);
    const costOfSales = bills.filter((bill) => bill.data.category?.toLowerCase().includes("cost")).reduce((sum, bill) => sum + rowAmount(bill), 0);
    return {
      columns: ["Account", "Total"],
      rows: [
        { Account: "Income · invoices", Total: income },
        { Account: "Direct costs", Total: costOfSales },
        { Account: "Operating expenses", Total: expenseTotal - costOfSales },
        { Account: "Net profit", Total: income - expenseTotal },
      ],
    };
  }

  if (key === "sales-customer") {
    const groups = groupTotals(invoices.map((record) => ({ ...record, data: { ...record.data, amount: String(Math.max(0, rowAmount(record) - rowAmount(record, "creditApplied"))) } })), "customer");
    return { columns: ["Customer", "Invoices", "Total"], rows: groups.map((row) => ({ Customer: row.name, Invoices: row.count, Total: row.amount })) };
  }

  if (key === "expenses-category") {
    const groups = groupTotals([...bills, ...expenses], "category");
    return { columns: ["Category", "Entries", "Total"], rows: groups.map((row) => ({ Category: row.name, Entries: row.count, Total: row.amount })) };
  }

  if (key === "cash-flow") {
    const totals = new Map<string, { inflow: number; outflow: number }>();
    const add = (date: string, amount: number, direction: "inflow" | "outflow") => {
      const month = date.slice(0, 7) || "Undated";
      const current = totals.get(month) ?? { inflow: 0, outflow: 0 };
      current[direction] += amount;
      totals.set(month, current);
    };
    records.forEach((record) => {
      if (record.kind === "transactions") add(recordDate(record), rowAmount(record), record.data.type === "Deposit" ? "inflow" : "outflow");
      if (record.kind === "payments") add(recordDate(record), rowAmount(record), "inflow");
      if (record.kind === "expenses") add(recordDate(record), rowAmount(record), "outflow");
      if (record.kind === "bills") add(recordDate(record), rowAmount(record, "paidAmount"), "outflow");
    });
    return {
      columns: ["Month", "Money in", "Money out", "Net cash"],
      rows: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ Month: month, "Money in": values.inflow, "Money out": values.outflow, "Net cash": values.inflow - values.outflow })),
    };
  }

  if (key === "trial-balance") {
    const accounts = records.filter((record) => record.kind === "accounts");
    const balances = new Map<string, { type: string; debit: number; credit: number }>();
    accounts.forEach((account) => {
      const normalCredit = ["Liability", "Equity", "Income"].includes(account.data.type ?? "");
      const balance = rowAmount(account, "openingBalance");
      balances.set(account.data.name || account.data.code || "Account", {
        type: account.data.type || "Unclassified",
        debit: normalCredit ? 0 : balance,
        credit: normalCredit ? balance : 0,
      });
    });
    records.filter((record) => record.kind === "journals").forEach((journal) => {
      const amount = rowAmount(journal);
      const debitName = journal.data.debitAccount || "Unassigned debit";
      const creditName = journal.data.creditAccount || "Unassigned credit";
      const debit = balances.get(debitName) ?? { type: "Journal", debit: 0, credit: 0 };
      debit.debit += amount;
      balances.set(debitName, debit);
      const credit = balances.get(creditName) ?? { type: "Journal", debit: 0, credit: 0 };
      credit.credit += amount;
      balances.set(creditName, credit);
    });
    const rows = [...balances.entries()].map(([name, value]) => ({ Account: name, Type: value.type, Debit: value.debit, Credit: value.credit }));
    const debitTotal = rows.reduce((sum, row) => sum + Number(row.Debit), 0);
    const creditTotal = rows.reduce((sum, row) => sum + Number(row.Credit), 0);
    rows.push({ Account: "Totals", Type: "", Debit: debitTotal, Credit: creditTotal });
    return { columns: ["Account", "Type", "Debit", "Credit"], rows };
  }

  if (key === "balance-sheet") {
    const accountRows = records.filter((record) => record.kind === "accounts").map((record) => ({
      Section: record.data.type || "Unclassified",
      Account: record.data.name || record.data.code || "Account",
      Balance: rowAmount(record, "openingBalance"),
    }));
    const cash = records.filter((record) => record.kind === "bank-accounts").reduce((sum, record) => sum + rowAmount(record, "openingBalance"), 0);
    const receivables = invoices.reduce((sum, record) => sum + Math.max(0, rowAmount(record) - rowAmount(record, "paidAmount")), 0);
    const payables = bills.reduce((sum, record) => sum + Math.max(0, rowAmount(record) - rowAmount(record, "paidAmount")), 0);
    const assetAccounts = accountRows.filter((row) => row.Section.toLowerCase() === "asset");
    const liabilityAccounts = accountRows.filter((row) => row.Section.toLowerCase() === "liability");
    const equityAccounts = accountRows.filter((row) => row.Section.toLowerCase() === "equity");
    const assetRows: ReportRow[] = [
      { Section: "Asset", Account: "Cash & bank opening balances", Balance: cash },
      { Section: "Asset", Account: "Accounts receivable", Balance: receivables },
      ...assetAccounts,
    ];
    const liabilityRows: ReportRow[] = [
      { Section: "Liability", Account: "Accounts payable", Balance: payables },
      ...liabilityAccounts,
    ];
    const totalAssets = assetRows.reduce((sum, row) => sum + Number(row.Balance ?? 0), 0);
    const totalLiabilities = liabilityRows.reduce((sum, row) => sum + Number(row.Balance ?? 0), 0);
    const recordedEquity = equityAccounts.reduce((sum, row) => sum + row.Balance, 0);
    const balancingEquity = totalAssets - totalLiabilities - recordedEquity;
    const totalEquity = recordedEquity + balancingEquity;
    const rows: ReportRow[] = [
      ...assetRows,
      { Section: "Asset", Account: "Total assets", Balance: totalAssets },
      ...liabilityRows,
      { Section: "Liability", Account: "Total liabilities", Balance: totalLiabilities },
      ...equityAccounts,
      { Section: "Equity", Account: "Unallocated equity (balancing amount)", Balance: balancingEquity },
      { Section: "Equity", Account: "Total equity", Balance: totalEquity },
      { Section: "Liabilities & equity", Account: "Total liabilities & equity", Balance: totalLiabilities + totalEquity },
    ];
    return { columns: ["Section", "Account", "Balance"], rows };
  }

  if (key === "ageing") {
    const openRows = [...invoices.map((record) => ({ record, party: record.data.customer || "Customer", type: "Receivable" })), ...bills.map((record) => ({ record, party: record.data.vendor || "Vendor", type: "Payable" }))];
    const rows: ReportRow[] = openRows.flatMap(({ record, party, type }) => {
      const outstanding = Math.max(0, rowAmount(record) - rowAmount(record, "paidAmount") - rowAmount(record, "creditApplied"));
      if (outstanding === 0) return [];
      const dueDate = record.data.dueDate || "";
      const days = dueDate ? Math.floor((new Date(`${asOfDate}T12:00:00`).getTime() - new Date(`${dueDate}T12:00:00`).getTime()) / 86400000) : -1;
      const band = days <= 0 ? "Current" : days <= 30 ? "1–30" : days <= 60 ? "31–60" : "61+";
      return [{ Party: party, Type: type, Due: dueDate || "Not set", "Days overdue": Math.max(0, days), [band]: outstanding }];
    });
    return { columns: ["Party", "Type", "Due", "Days overdue", "Current", "1–30", "31–60", "61+"], rows };
  }

  const taxRates = records.filter((record) => record.kind === "taxes" && record.data.enabled !== "false");
  const taxRows = taxRates.map((tax) => {
    const rate = Number(tax.data.rate) || 0;
    const taxableSales = invoices.reduce((sum, invoice) => {
      const invoiceRate = Number(invoice.data.taxRate) || 0;
      return invoiceRate === rate ? sum + Number(invoice.data.subtotal || invoice.data.amount || 0) : sum;
    }, 0);
    return {
      Tax: tax.data.name || tax.data.component || "Tax",
      Rate: `${rate}%`,
      "Taxable sales": taxableSales,
      "Tax collected": taxableSales * (rate / 100),
    };
  });
  return { columns: ["Tax", "Rate", "Taxable sales", "Tax collected"], rows: taxRows };
}

export default function ReportsWorkspace({ records, asOfDate }: ReportsWorkspaceProps) {
  const [reportKey, setReportKey] = useState<ReportKey>("profit-loss");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const option = reportOptions.find((item) => item.key === reportKey) ?? reportOptions[0];
  const filteredRecords = useMemo(() => records.filter((record) => {
    const date = recordDate(record);
    return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  }), [fromDate, records, toDate]);
  const report = buildReport(reportKey, filteredRecords, toDate || asOfDate);
  const currency = records.find((record) => record.kind === "settings")?.data.currency || "USD";

  const displayCell = (column: string, value: string | number) => {
    if (typeof value === "number" && ["Total", "Balance", "Debit", "Credit", "Money in", "Money out", "Net cash", "Taxable sales", "Tax collected", "Current", "1–30", "31–60", "61+"].includes(column)) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
      } catch {
        return `${currency} ${value.toFixed(2)}`;
      }
    }
    return String(value);
  };

  function exportReport() {
    const csv = [report.columns, ...report.rows.map((row) => report.columns.map((column) => String(row[column] ?? "")))].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${reportKey}.csv`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounting / Analysis</p><h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Reports</h1><p className="mt-1.5 text-sm text-muted-foreground">Read your books by period and export the figures when you need them.</p></div>
        <Button variant="outline" className="gap-2" onClick={exportReport}><ArrowDownToLine size={15} />Export CSV</Button>
      </section>

      <section className="mt-6 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,0.65fr)_minmax(160px,0.65fr)] sm:items-end">
        <div className="space-y-2"><label className="text-xs font-medium" htmlFor="report-type">Report</label><Select value={reportKey} onValueChange={(value) => setReportKey((value as ReportKey) ?? "profit-loss")}><SelectTrigger id="report-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{reportOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><label className="text-xs font-medium" htmlFor="report-from">From</label><Input id="report-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
        <div className="space-y-2"><label className="text-xs font-medium" htmlFor="report-to">To</label><Input id="report-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><CalendarRange size={17} /></span><div><h2 className="text-sm font-semibold">{option.label}</h2><p className="mt-1 text-xs text-muted-foreground">{option.description}</p></div></div>
          <span className="text-xs text-muted-foreground">{filteredRecords.length} matching records</span>
        </div>
        {report.rows.length ? (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{report.columns.map((column) => <TableHead key={column} className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{column}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {report.rows.map((row, rowIndex) => (
                  <TableRow key={`${String(row[report.columns[0]])}-${rowIndex}`}>
                    {report.columns.map((column) => <TableCell key={column} className={`whitespace-nowrap py-3 text-[13px] ${column === report.columns[0] ? "font-medium" : "tabular-nums"}`}>{displayCell(column, row[column] ?? "—")}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid min-h-56 place-items-center px-6 py-10 text-center"><div><p className="text-sm font-medium">No records in this report yet</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Add the related invoices, bills, journals, or tax rates to see actual figures here.</p></div></div>
        )}
      </section>
    </div>
  );
}
