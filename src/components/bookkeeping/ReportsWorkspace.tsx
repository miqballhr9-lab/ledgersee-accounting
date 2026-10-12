"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, CalendarRange, Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseLinesFromData } from "@/lib/expense-utils";

interface ReportsWorkspaceProps {
  records: BookkeepingRecord[];
  asOfDate: string;
}

type ReportKey = "profit-loss" | "balance-sheet" | "cash-flow" | "trial-balance" | "sales-customer" | "expenses-category" | "ageing" | "tax-summary";
type ReportGroupKey = "standard" | "sales" | "expenses" | "customers";
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

const reportGroups: { key: ReportGroupKey; label: string; reports: ReportKey[] }[] = [
  { key: "standard", label: "Standard reports", reports: ["profit-loss", "balance-sheet", "cash-flow", "trial-balance", "tax-summary"] },
  { key: "sales", label: "Sales reports", reports: ["sales-customer"] },
  { key: "expenses", label: "Expense reports", reports: ["expenses-category"] },
  { key: "customers", label: "Customer & vendor reports", reports: ["ageing"] },
];

function sourceRecordCount(key: ReportKey, records: BookkeepingRecord[]) {
  const sourceKinds: Record<ReportKey, string[]> = {
    "profit-loss": ["invoices", "bills", "expenses"],
    "balance-sheet": ["accounts", "invoices", "bills", "expenses", "journals"],
    "cash-flow": ["transactions", "payments", "expenses", "bills"],
    "trial-balance": ["accounts", "journals"],
    "sales-customer": ["invoices"],
    "expenses-category": ["bills", "expenses"],
    ageing: ["invoices", "bills"],
    "tax-summary": ["invoices", "taxes"],
  };
  return records.filter((record) => sourceKinds[key].includes(record.kind)).length;
}

function rowAmount(record: BookkeepingRecord, key = "amount") {
  const amount = Number(record.data[key] ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function journalEntries(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const line = entry as Record<string, unknown>;
      const account = typeof line.account === "string" ? line.account : "";
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      if (!account || !Number.isFinite(debit) || !Number.isFinite(credit)) return [];
      return [{ account, debit, credit }];
    });
  } catch {
    return [];
  }
}

function recordDate(record: BookkeepingRecord) {
  return record.data.openingBalanceDate || record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.data.paymentDate || record.createdAt.slice(0, 10);
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function groupTotals(records: BookkeepingRecord[], groupKey: string) {
  const grouped = new Map<string, { count: number; amount: number }>();
  records.forEach((record) => {
    const categories = groupKey === "category" && (record.kind === "expenses" || record.kind === "bills")
      ? expenseLinesFromData(record.data).map((line) => ({ name: line.category || "Uncategorized", amount: line.amount }))
      : [{ name: record.data[groupKey] || "Uncategorized", amount: rowAmount(record) }];
    categories.forEach(({ name, amount }) => {
      const current = grouped.get(name) ?? { count: 0, amount: 0 };
      grouped.set(name, { count: current.count + 1, amount: current.amount + amount });
    });
  });
  return [...grouped.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.amount - a.amount);
}

function buildReport(key: ReportKey, records: BookkeepingRecord[], asOfDate: string): { columns: string[]; rows: ReportRow[] } {
  const invoices = records.filter((record) => record.kind === "invoices" && !["Draft", "Cancelled"].includes(record.data.status ?? ""));
  const bills = records.filter((record) => record.kind === "bills" && record.data.status !== "Cancelled");
  const expenses = records.filter((record) => record.kind === "expenses");

  if (key === "profit-loss") {
    const income = invoices.reduce((sum, invoice) => sum + Math.max(0, rowAmount(invoice) - rowAmount(invoice, "creditApplied")), 0);
    // Supplier credits applied to bills reduce what the bills cost, as customer credits reduce income.
    const expenseTotal = [...bills, ...expenses].reduce((sum, expense) => sum + Math.max(0, rowAmount(expense) - rowAmount(expense, "creditApplied")), 0);
    const billCostOfSales = bills.reduce((sum, record) => sum + expenseLinesFromData(record.data)
      .filter((line) => line.category.toLowerCase().includes("cost") || line.category.toLowerCase().includes("direct"))
      .reduce((lineSum, line) => lineSum + line.amount, 0), 0);
    const expenseCostOfSales = expenses.reduce((sum, record) => sum + expenseLinesFromData(record.data)
      .filter((line) => line.category.toLowerCase().includes("cost") || line.category.toLowerCase().includes("direct"))
      .reduce((lineSum, line) => lineSum + line.amount, 0), 0);
    const costOfSales = billCostOfSales + expenseCostOfSales;
    const grossProfit = income - costOfSales;
    const operatingExpenses = expenseTotal - costOfSales;
    return {
      columns: ["Account", "Total"],
      rows: [
        { Account: "Revenue · invoices", Total: income },
        { Account: "Cost of goods sold", Total: costOfSales },
        { Account: "Gross profit", Total: grossProfit },
        { Account: "Operating expenses", Total: operatingExpenses },
        { Account: "Net income", Total: grossProfit - operatingExpenses },
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
      balances.set(account.data.name || "Unnamed account", {
        type: account.data.type || "Unclassified",
        debit: normalCredit ? 0 : balance,
        credit: normalCredit ? balance : 0,
      });
    });
    records.filter((record) => record.kind === "journals").forEach((journal) => {
      const entries = journalEntries(journal.data.lines);
      if (entries.length) {
        entries.forEach((entry) => {
          const account = balances.get(entry.account) ?? { type: "Journal", debit: 0, credit: 0 };
          account.debit += entry.debit;
          account.credit += entry.credit;
          balances.set(entry.account, account);
        });
        return;
      }
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
  const [groupKey, setGroupKey] = useState<ReportGroupKey>("standard");
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const option = reportOptions.find((item) => item.key === reportKey) ?? reportOptions[0];
  const reportGroup = reportGroups.find((group) => group.key === groupKey) ?? reportGroups[0];
  const filteredRecords = useMemo(() => records.filter((record) => {
    if (record.kind === "accounts") {
      const openingDate = record.data.openingBalanceDate || record.createdAt.slice(0, 10);
      return !toDate || openingDate <= toDate;
    }
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
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounting / Analysis</p><h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Reports</h1><p className="mt-1.5 text-sm text-muted-foreground">Read your books by period and export the figures when you need them.</p></div>
        <Button variant="outline" className="gap-2" onClick={exportReport}><ArrowDownToLine size={15} />Export CSV</Button>
      </section>

      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-card p-3">
          <h2 className="px-2 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Reports & analytics</h2>
          <nav aria-label="Report categories" className="mt-1 space-y-1">
            {reportGroups.map((group) => (
              <Button
                key={group.key}
                type="button"
                variant={group.key === groupKey ? "secondary" : "ghost"}
                className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-left"
                onClick={() => {
                  setGroupKey(group.key);
                  if (!group.reports.includes(reportKey)) setReportKey(group.reports[0]);
                }}
                aria-current={group.key === groupKey ? "true" : undefined}
              >
                <span className="min-w-0 truncate">{group.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{group.reports.length}</span>
              </Button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(220px,1.2fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)] sm:items-end">
            <div className="min-w-0 space-y-2">
              <label className="text-xs font-medium" htmlFor="report-picker">Report</label>
              <Popover open={reportPickerOpen} onOpenChange={setReportPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button id="report-picker" type="button" variant="outline" role="combobox" aria-expanded={reportPickerOpen} className="w-full justify-between gap-2 font-normal">
                      <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                      <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" />
                    </Button>
                  }
                />
                <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
                  <Command>
                    <CommandInput placeholder="Type report name here" />
                    <CommandList>
                      <CommandEmpty>No reports found in this category.</CommandEmpty>
                      <CommandGroup heading={reportGroup.label}>
                        {reportOptions.filter((item) => reportGroup.reports.includes(item.key)).map((item) => (
                          <CommandItem key={item.key} value={`${item.label} ${item.description}`} onSelect={() => { setReportKey(item.key); setReportPickerOpen(false); }}>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            <Check size={16} className={reportKey === item.key ? "opacity-100" : "opacity-0"} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2"><label className="text-xs font-medium" htmlFor="report-from">From</label><Input id="report-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
            <div className="space-y-2"><label className="text-xs font-medium" htmlFor="report-to">To</label><Input id="report-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><CalendarRange size={17} /></span><div className="min-w-0"><h2 className="text-sm font-semibold">{option.label}</h2><p className="mt-1 text-xs text-muted-foreground">{option.description}</p></div></div>
              <span className="shrink-0 text-xs text-muted-foreground">{sourceRecordCount(reportKey, filteredRecords)} source records</span>
            </div>
            {report.rows.length ? (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{report.columns.map((column) => <TableHead key={column} className={`whitespace-nowrap text-xs font-medium text-muted-foreground ${column === report.columns[0] ? "" : "text-right"}`}>{column}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {report.rows.map((row, rowIndex) => (
                      <TableRow key={`${String(row[report.columns[0]])}-${rowIndex}`}>
                        {report.columns.map((column) => <TableCell key={column} className={`whitespace-nowrap py-3 text-[13px] ${column === report.columns[0] ? "font-medium" : "text-right tabular-nums"}`}>{displayCell(column, row[column] ?? "—")}</TableCell>)}
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
      </div>
    </div>
  );
}
