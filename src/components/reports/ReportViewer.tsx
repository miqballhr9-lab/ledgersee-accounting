"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, FileDown, Printer, Save, SlidersHorizontal, Star } from "lucide-react";
import { toast } from "sonner";

import { saveBookkeepingRecord } from "@/app/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readableError } from "@/lib/action-error";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { buildLedger, type AccountingMethod } from "@/lib/ledger";
import { reportByKey, type ReportDefinition } from "@/lib/report-catalog";
import {
  ageingSummary, balanceSheet, balanceSheetAccountNames, cashFlows, earliestDate, periodPresets, pnlAccountNames, presetRange, profitAndLoss,
  salesByCustomer, taxSummary, transactionDetail, trialBalance,
  type ColumnsBy, type Compare, type PeriodPreset, type ReportLine, type ReportOptions, type ReportResult, type ZoomSpec,
} from "@/lib/reports";
import { useFavouriteReports } from "@/components/reports/use-favourite-reports";
import { buildListReport } from "@/lib/report-lists";
import { BudgetReport, BusinessSnapshot } from "@/components/reports/SummaryReports";

interface ReportViewerProps {
  reportKey: string;
  records: BookkeepingRecord[];
  today: string;
}

interface NumberFormat {
  divideBy1000: boolean;
  withoutCents: boolean;
  negative: "minus" | "brackets" | "red";
}

const sourceSlug: Record<string, string> = {
  invoices: "invoices", bills: "bills", expenses: "expenses", "credit-notes": "credit-notes", "supplier-credits": "supplier-credits",
  journals: "journals", transactions: "transactions", accounts: "accounts", payroll: "payroll",
  customers: "customers", vendors: "vendors", estimates: "estimates", "sales-orders": "sales-orders", "purchase-orders": "purchase-orders", items: "items",
  employees: "employees", "recurring-transactions": "recurring", "inventory-movements": "inventory", deposits: "deposits", "time-activities": "time-activities", mileage: "mileage",
};

const asOfEngines = new Set(["bs", "trial-balance", "ar-ageing", "ap-ageing"]);
/** List reports that show balances on one date rather than activity over a period. */
const asOfReports = new Set([
  "accounts-receivable-ageing-detail", "accounts-payable-ageing-detail", "collections-report", "customer-balance-summary", "customer-balance-detail",
  "supplier-balance-summary", "supplier-balance-detail", "open-invoices", "unpaid-bills", "open-purchase-order-list", "customer-contact-list", "supplier-contact-list",
  "inventory-valuation-summary", "stock-take-worksheet", "product-service-list",
  "employee-details", "loans-outstanding", "account-list", "reconciliation-reports", "recent-transactions",
]);
const isAsOfReport = (report: ReportDefinition) => asOfEngines.has(report.engine ?? "") || asOfReports.has(report.key);

function readOptions(params: URLSearchParams, report: ReportDefinition, today: string, fiscalStart: number, earliest: string, defaultMethod: AccountingMethod) {
  const defaults = report.defaults ?? {};
  const preset = (params.get("period") as PeriodPreset | null) ?? (isAsOfReport(report) ? "today" : "this-year-to-date");
  const range = preset === "custom" ? { from: params.get("from") ?? today, to: params.get("to") ?? today } : presetRange(preset, today, fiscalStart, earliest);
  const compare = (params.get("compare") as Compare | null) ?? defaults.compare ?? "none";
  const options: ReportOptions = {
    from: range.from,
    to: range.to,
    columnsBy: (params.get("cols") as ColumnsBy | null) ?? defaults.columnsBy ?? "total",
    compare,
    showChange: params.get("chg") !== "0",
    showPctChange: params.get("pctc") !== "0",
    allRows: params.get("rows") === "all",
    pctOfIncome: params.has("pcti") ? params.get("pcti") === "1" : Boolean(defaults.pctOfIncome),
    nameFilter: params.get("name") ?? undefined,
  };
  const method: AccountingMethod = params.get("method") === "cash" ? "cash" : params.get("method") === "accrual" ? "accrual" : defaultMethod;
  return { preset, options, method };
}

export default function ReportViewer({ reportKey, records, today }: ReportViewerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isZoom = reportKey === "transaction-report";
  const zoomTitle = params.get("title");
  const report: ReportDefinition = useMemo(() => (isZoom
    ? { key: reportKey, label: zoomTitle || "Transaction Report", description: "", ready: true }
    : reportByKey(reportKey) ?? { key: reportKey, label: "Report", description: "", ready: false }), [isZoom, reportKey, zoomTitle]);
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  const company = settings.companyName || "Your business";
  const currency = settings.currency || "USD";
  const defaultMethod: AccountingMethod = settings.accountingMethod === "Cash" ? "cash" : "accrual";
  const methodParam: AccountingMethod = params.get("method") === "cash" ? "cash" : params.get("method") === "accrual" ? "accrual" : defaultMethod;
  const ledger = useMemo(() => buildLedger(records, methodParam), [records, methodParam]);
  const query = params.toString();
  const { preset, options, method } = useMemo(() => readOptions(new URLSearchParams(query), report, today, ledger.fiscalYearStartMonth, earliestDate(ledger), defaultMethod), [query, report, today, ledger, defaultMethod]);
  const engine = report.engine;
  const isAsOf = isAsOfReport(report);

  const [draft, setDraft] = useState(() => ({ preset, from: options.from, to: options.to, columnsBy: options.columnsBy, compare: options.compare, showChange: options.showChange, showPctChange: options.showPctChange, allRows: options.allRows, method }));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [format, setFormat] = useState<NumberFormat>({ divideBy1000: false, withoutCents: false, negative: "minus" });
  const [header, setHeader] = useState({ company: true, title: true, period: true, footer: true });
  const [nameDraft, setNameDraft] = useState(options.nameFilter ?? "");
  const [notes, setNotes] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  /** Save customisation, as in QuickBooks: keeps this report's settings under a name in Custom reports. */
  async function saveCustomisation() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const settingsQuery = new URLSearchParams(params.toString());
      settingsQuery.delete("back");
      settingsQuery.delete("cname");
      await saveBookkeepingRecord("custom-reports", { name: saveName.trim().slice(0, 120), reportKey: report.key, reportLabel: report.label, query: settingsQuery.toString() });
      toast.success(`Saved “${saveName.trim()}” in Custom reports.`);
      setSaveOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t save this report.");
    } finally {
      setSaving(false);
    }
  }
  const [notesOpen, setNotesOpen] = useState(false);
  const { favourites, toggle } = useFavouriteReports();

  const zoom: ZoomSpec | null = useMemo(() => {
    if (!isZoom) return null;
    try {
      const parsed = JSON.parse(params.get("z") ?? "null") as ZoomSpec | null;
      return parsed && Array.isArray(parsed.accounts) ? parsed : null;
    } catch {
      return null;
    }
  }, [isZoom, params]);

  const result: ReportResult | null = useMemo(() => {
    if (zoom) return transactionDetail(ledger, zoom, false);
    switch (engine) {
      case "pnl": return profitAndLoss(ledger, options);
      case "bs": return balanceSheet(ledger, options);
      case "cf": return cashFlows(ledger, options);
      case "pnl-detail": return transactionDetail(ledger, { accounts: pnlAccountNames(ledger), from: options.from, to: options.to, name: options.nameFilter, nameField: options.nameFilter ? "name" : undefined }, false);
      case "bs-detail": return transactionDetail(ledger, { accounts: balanceSheetAccountNames(ledger), from: options.from, to: options.to }, true);
      case "general-ledger": return transactionDetail(ledger, { accounts: [...ledger.accounts.values()].map((account) => account.name), from: options.from, to: options.to }, true);
      case "trial-balance": return trialBalance(ledger, options);
      case "sales-by-customer": return salesByCustomer(ledger, options);
      case "ar-ageing": return ageingSummary(records, ledger, "receivable", options);
      case "ap-ageing": return ageingSummary(records, ledger, "payable", options);
      case "tax-summary": return taxSummary(ledger, options);
      case "list": return buildListReport(report.key, records, ledger, options);
      default: return null;
    }
  }, [engine, ledger, records, zoom, options, report.key]);

  const showCustomerColumns = engine === "pnl";
  const canCompare = draft.columnsBy === "total" || engine === "bs";
  const backHref = params.get("back");

  function run() {
    const next = new URLSearchParams();
    if (isZoom) {
      for (const key of ["z", "back", "title"]) { const value = params.get(key); if (value) next.set(key, value); }
    }
    next.set("period", draft.preset);
    if (draft.preset === "custom") { next.set("from", draft.from); next.set("to", draft.to); }
    if (draft.columnsBy !== "total") next.set("cols", draft.columnsBy);
    next.set("compare", canCompare ? draft.compare : "none");
    if (!draft.showChange) next.set("chg", "0");
    if (!draft.showPctChange) next.set("pctc", "0");
    if (draft.allRows) next.set("rows", "all");
    next.set("method", draft.method);
    if (params.has("pcti")) next.set("pcti", params.get("pcti")!);
    if (nameDraft.trim()) next.set("name", nameDraft.trim());
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function choosePreset(value: PeriodPreset) {
    if (value === "custom") { setDraft((current) => ({ ...current, preset: value })); return; }
    const range = presetRange(value, today, ledger.fiscalYearStartMonth, earliestDate(ledger));
    setDraft((current) => ({ ...current, preset: value, from: range.from, to: range.to }));
  }

  function zoomHref(spec: ZoomSpec, label: string) {
    const back = `${pathname}?${params.toString()}`;
    const next = new URLSearchParams({ z: JSON.stringify(spec), back, title: `Transaction Report · ${label}` });
    if (method === "cash") next.set("method", "cash");
    return `/app/reports/transaction-report?${next.toString()}`;
  }

  function money(value: number) {
    let amount = format.divideBy1000 ? value / 1000 : value;
    if (Math.abs(amount) < 0.005) amount = 0;
    const digits = format.withoutCents ? 0 : 2;
    const text = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(amount));
    if (amount >= 0) return text;
    return format.negative === "brackets" ? `(${text})` : `-${text}`;
  }

  function cellText(value: number | string | null, kind: string) {
    if (value === null || value === "") return "";
    if (typeof value === "string") return value;
    if (kind === "pct") return `${value.toFixed(2)} %`;
    if (kind === "count") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return money(value);
  }

  const visibleLines = useMemo(() => {
    if (!result) return [];
    const byId = new Map(result.lines.map((line) => [line.id, line]));
    const hidden = (line: ReportLine) => {
      let parent = line.parentId;
      while (parent) {
        if (collapsed.has(parent)) {
          // A collapsed section still shows its own total line in place of the header.
          return true;
        }
        parent = byId.get(parent)?.parentId;
      }
      return false;
    };
    const hasTotal = new Set(result.lines.filter((line) => line.kind === "total" && line.parentId).map((line) => line.parentId!));
    return result.lines.filter((line) => {
      // A collapsed section shows as one line: its total, under the section's name.
      if (line.kind === "section" && collapsed.has(line.id) && hasTotal.has(line.id)) return false;
      return !hidden(line) || (line.kind === "total" && line.parentId && collapsed.has(line.parentId) && !hiddenAbove(line.parentId));
    });
    function hiddenAbove(id: string): boolean {
      let parent = byId.get(id)?.parentId;
      while (parent) { if (collapsed.has(parent)) return true; parent = byId.get(parent)?.parentId; }
      return false;
    }
  }, [collapsed, result]);

  const sectionIds = useMemo(() => result?.lines.filter((line) => line.kind === "section").map((line) => line.id) ?? [], [result]);

  function exportRows() {
    if (!result) return [];
    const rows: (string | number)[][] = [];
    if (header.company) rows.push([company]);
    rows.push([report.label]);
    rows.push([result.period]);
    rows.push([]);
    rows.push(["", ...result.columns.map((column) => column.label)]);
    for (const line of result.lines) {
      rows.push([`${"  ".repeat(line.depth)}${line.label}`, ...line.values.map((value) => (value === null ? "" : typeof value === "number" ? Math.round(value * 100) / 100 : value))]);
    }
    rows.push([]);
    rows.push([`${method === "cash" ? "Cash" : "Accrual"} basis · ${currency}`]);
    return rows;
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet(exportRows());
    sheet["!cols"] = [{ wch: 44 }, ...(result?.columns ?? []).map(() => ({ wch: 16 }))];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, report.label.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    XLSX.writeFile(book, `${report.key}.xlsx`);
  }

  function exportCsv() {
    const csv = exportRows().map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.key}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!report.ready) {
    return (
      <main className="space-y-4 p-4 sm:p-6 lg:p-8">
        <Link href="/app/reports" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ChevronLeft size={15} />Back to report list</Link>
        <section className="rounded-lg border border-border bg-card px-6 py-12 text-center">
          <h1 className="text-lg font-semibold">{report.label}</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{report.description} This report is coming in the next update.</p>
        </section>
      </main>
    );
  }

  const isFavourite = favourites.includes(report.key);
  const preparedAt = new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="space-y-3 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link href={backHref || "/app/reports"} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ChevronLeft size={15} />{backHref ? "Back to summary report" : "Back to report list"}</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {report.label}
            {!isZoom ? (
              <button type="button" onClick={() => toggle(report.key)} aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}>
                <Star size={18} className={isFavourite ? "fill-amber-400 text-amber-500" : "text-muted-foreground/60 hover:text-amber-500"} />
              </button>
            ) : null}
          </h1>
        </div>
        {result ? <Button type="button" variant="outline" className="gap-1.5" onClick={() => setCustomiseOpen(true)}><SlidersHorizontal size={15} />Customise</Button> : null}
      </div>

      {engine !== "snapshot" && engine !== "budget-overview" && engine !== "budget-vs-actuals" ? (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 sm:p-4 print:hidden">
          <Field label={isAsOf ? "As of" : "Report period"}>
            <Select value={draft.preset} onValueChange={(value) => choosePreset(value as PeriodPreset)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{periodPresets.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {!isAsOf ? <Field label="From"><Input type="date" className="w-[150px]" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, preset: "custom", from: event.target.value }))} /></Field> : null}
          <Field label={isAsOf ? "Date" : "To"}><Input type="date" className="w-[150px]" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, preset: "custom", to: event.target.value }))} /></Field>
          {["pnl", "bs", "cf", "sales-by-customer"].includes(engine ?? "") ? (
            <Field label="Display columns by">
              <Select value={draft.columnsBy} onValueChange={(value) => setDraft((current) => ({ ...current, columnsBy: value as ColumnsBy }))}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total only</SelectItem>
                  <SelectItem value="months">Months</SelectItem>
                  <SelectItem value="quarters">Quarters</SelectItem>
                  <SelectItem value="years">Years</SelectItem>
                  {showCustomerColumns ? <SelectItem value="customers">Customers</SelectItem> : null}
                  {showCustomerColumns ? <SelectItem value="suppliers">Suppliers</SelectItem> : null}
                  {showCustomerColumns ? <SelectItem value="classes">Classes</SelectItem> : null}
                  {showCustomerColumns ? <SelectItem value="locations">Locations</SelectItem> : null}
                  {showCustomerColumns ? <SelectItem value="projects">Projects</SelectItem> : null}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {["pnl", "bs", "cf", "trial-balance", "sales-by-customer"].includes(engine ?? "") || isZoom ? (
            <Field label="Show non-zero or active only">
              <Select value={draft.allRows ? "all" : "active"} onValueChange={(value) => setDraft((current) => ({ ...current, allRows: value === "all" }))}>
                <SelectTrigger className="w-[175px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active rows only</SelectItem><SelectItem value="all">All rows</SelectItem></SelectContent>
              </Select>
            </Field>
          ) : null}
          {["pnl", "bs", "cf", "sales-by-customer"].includes(engine ?? "") ? (
            <Field label="Compare another period">
              <div className="flex items-center gap-2">
                <Select value={canCompare ? draft.compare : "none"} onValueChange={(value) => setDraft((current) => ({ ...current, compare: value as Compare }))} disabled={!canCompare}>
                  <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="pp">Previous period (PP)</SelectItem>
                    <SelectItem value="py">Previous year (PY)</SelectItem>
                  </SelectContent>
                </Select>
                {canCompare && draft.compare !== "none" ? (
                  <>
                    <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={draft.showChange} onCheckedChange={(checked) => setDraft((current) => ({ ...current, showChange: checked === true }))} />$ change</label>
                    <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={draft.showPctChange} onCheckedChange={(checked) => setDraft((current) => ({ ...current, showPctChange: checked === true }))} />% change</label>
                  </>
                ) : null}
              </div>
            </Field>
          ) : null}
          {engine !== "ar-ageing" && engine !== "ap-ageing" ? (
            <Field label="Accounting method">
              <Select value={draft.method} onValueChange={(value) => setDraft((current) => ({ ...current, method: value as AccountingMethod }))}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="accrual">Accrual</SelectItem><SelectItem value="cash">Cash</SelectItem></SelectContent>
              </Select>
            </Field>
          ) : null}
          <Button type="button" className="ml-auto" onClick={run}>Run report</Button>
        </section>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div className="flex flex-wrap gap-4 text-sm text-primary">
              {sectionIds.length ? (
                <button type="button" className="hover:underline" onClick={() => setCollapsed((current) => (current.size ? new Set() : new Set(sectionIds)))}>{collapsed.size ? "Expand" : "Collapse"}</button>
              ) : null}
              <button type="button" className="hover:underline" onClick={() => setNotesOpen((value) => !value)}>{notesOpen ? "Hide notes" : "Add notes"}</button>
            </div>
            <div className="flex gap-1.5">
              {!isZoom ? <Button type="button" variant="outline" className="gap-1.5" onClick={() => { setSaveName(params.get("cname") || report.label); setSaveOpen(true); }}><Save size={16} />Save customisation</Button> : null}
              <Button type="button" variant="outline" size="icon" aria-label="Print or save as PDF" onClick={() => window.print()}><Printer size={16} /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-1.5"><FileDown size={16} />Export<ChevronDown size={14} /></Button>} />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void exportExcel()}>Export to Excel</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()}>Export to PDF</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCsv}>Export to CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <section className="report-print overflow-hidden rounded-lg border border-border bg-card px-3 py-6 sm:px-8">
            <div className="text-center">
              {header.company ? <p className="text-lg font-semibold">{company}</p> : null}
              {header.title ? <p className="text-[15px]">{report.label}</p> : null}
              {header.period ? <p className="text-sm text-muted-foreground">{result.period}{options.nameFilter ? ` · ${options.nameFilter}` : ""}</p> : null}
            </div>
            {result.lines.length ? (
              <div className="mt-5 w-full overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-foreground text-xs">
                      <th className="px-3 py-2" aria-label="Account" />
                      {result.columns.map((column) => <th key={column.key} className={`whitespace-nowrap ${result.columns.length > 6 ? "px-2 text-[11px]" : "px-3"} py-2 font-semibold uppercase ${column.kind === "text" ? "text-left" : "text-right"}`}>{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLines.map((line) => {
                      const isCollapsedHeader = line.kind === "total" && line.parentId && collapsed.has(line.parentId);
                      const label = isCollapsedHeader ? result.lines.find((item) => item.id === line.parentId)?.label ?? line.label : line.label;
                      const isSection = line.kind === "section";
                      const bold = line.kind === "total" || line.kind === "grand" || isSection;
                      const border = line.kind === "grand" ? "border-t border-foreground" : line.kind === "total" && !isCollapsedHeader ? "border-t border-foreground/60" : "";
                      const pad = 12 + line.depth * 16;
                      return (
                        <tr key={line.id} className={`${line.source ? "cursor-pointer hover:bg-muted/50" : ""} ${line.kind === "grand" ? "bg-muted/30" : ""}`} onClick={line.source ? () => { const slug = sourceSlug[line.source!.kind]; if (slug) router.push(`/app/${slug}?open=${line.source!.id}`); } : undefined}>
                          <td className={`whitespace-nowrap py-1.5 pr-3 ${bold ? "font-semibold" : ""}`} style={{ paddingLeft: pad }}>
                            {isSection || isCollapsedHeader ? (
                              <button type="button" className="inline-flex items-center gap-1 print:pl-0" onClick={() => setCollapsed((current) => { const next = new Set(current); const id = isCollapsedHeader ? line.parentId! : line.id; if (next.has(id)) next.delete(id); else next.add(id); return next; })}>
                                {isCollapsedHeader ? <ChevronRight size={13} className="text-muted-foreground print:hidden" /> : <ChevronDown size={13} className="text-muted-foreground print:hidden" />}
                                {label}
                              </button>
                            ) : label}
                          </td>
                          {result.columns.map((column, index) => {
                            const value = line.values[index] ?? null;
                            const text = cellText(value, column.kind);
                            const zoomSpec = line.zooms?.[index];
                            const negative = typeof value === "number" && value < -0.004 && format.negative === "red";
                            return (
                              <td key={column.key} className={`whitespace-nowrap ${result.columns.length > 6 ? "px-2" : "px-3"} py-1.5 tabular-nums ${column.kind === "text" ? "text-left" : "text-right"} ${bold ? "font-semibold" : ""} ${border} ${negative ? "text-destructive" : ""} ${column.key === "memo" ? "max-w-[260px] truncate" : ""}`}>
                                {zoomSpec && text && !isSection ? <Link href={zoomHref(zoomSpec, line.label)} onClick={(event) => event.stopPropagation()} className="text-primary hover:underline print:text-foreground">{text}</Link> : text}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">{result.empty ?? "Nothing to show for this period."}</p>
            )}
            {notesOpen || notes ? (
              <div className="mt-5">
                {notesOpen ? <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes printed with this report" className="print:hidden" /> : null}
                {notes ? <p className="mt-2 hidden whitespace-pre-wrap text-sm print:block">{notes}</p> : null}
              </div>
            ) : null}
            {header.footer ? <p className="mt-6 text-center text-xs text-muted-foreground">{method === "cash" ? "Cash" : "Accrual"} basis · {currency} · <time suppressHydrationWarning>{preparedAt}</time></p> : null}
          </section>
          {!isZoom && result.lines.some((line) => line.zooms?.some(Boolean)) ? <p className="text-xs text-muted-foreground print:hidden">Click any amount to see the transactions behind it.</p> : null}
          {result.lines.some((line) => line.source) ? <p className="text-xs text-muted-foreground print:hidden">Click a transaction to open it.</p> : null}
        </>
      ) : engine === "snapshot" ? (
        <BusinessSnapshot ledger={ledger} today={today} currency={currency} />
      ) : engine === "budget-overview" || engine === "budget-vs-actuals" ? (
        <BudgetReport records={records} currency={currency} withActuals={engine === "budget-vs-actuals"} company={company} title={report.label} />
      ) : null}

      <Sheet open={customiseOpen} onOpenChange={setCustomiseOpen}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Customise report</SheetTitle>
            <SheetDescription>Number format, filters and what the header and footer show.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 p-4">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">General · Number format</h3>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={format.divideBy1000} onCheckedChange={(checked) => setFormat((current) => ({ ...current, divideBy1000: checked === true }))} />Divide by 1000</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={format.withoutCents} onCheckedChange={(checked) => setFormat((current) => ({ ...current, withoutCents: checked === true }))} />Without cents</label>
              <div className="space-y-1.5">
                <Label>Negative numbers</Label>
                <Select value={format.negative} onValueChange={(value) => setFormat((current) => ({ ...current, negative: value as NumberFormat["negative"] }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="minus">-100</SelectItem><SelectItem value="brackets">(100)</SelectItem><SelectItem value="red">-100 in red</SelectItem></SelectContent>
                </Select>
              </div>
            </section>
            {engine === "pnl" || engine === "pnl-detail" ? (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Rows/Columns</h3>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={options.pctOfIncome} onCheckedChange={(checked) => { const next = new URLSearchParams(params.toString()); next.set("pcti", checked === true ? "1" : "0"); router.replace(`${pathname}?${next.toString()}`, { scroll: false }); }} />% of income column</label>
              </section>
            ) : null}
            {engine === "pnl" || engine === "pnl-detail" || engine === "sales-by-customer" ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Filter</h3>
                <Label htmlFor="report-name-filter">Customer or supplier</Label>
                <Input id="report-name-filter" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="All" list="report-names" />
                <datalist id="report-names">{[...new Set(ledger.postings.map((posting) => posting.name).filter(Boolean))].sort().map((name) => <option key={name} value={name} />)}</datalist>
              </section>
            ) : null}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Header/Footer</h3>
              {([["company", "Company name"], ["title", "Report title"], ["period", "Report period"], ["footer", "Basis and date prepared"]] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={header[key]} onCheckedChange={(checked) => setHeader((current) => ({ ...current, [key]: checked === true }))} />{label}</label>
              ))}
            </section>
          </div>
          <SheetFooter className="border-t border-border">
            <Button type="button" onClick={() => { setCustomiseOpen(false); run(); }}>Run report</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save customisation</DialogTitle>
            <DialogDescription>Keep this report with its period, columns and filters. Open it again from Custom reports.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="custom-report-name">Custom report name</Label>
            <Input id="custom-report-name" value={saveName} maxLength={120} onChange={(event) => setSaveName(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => void saveCustomisation()} disabled={saving || !saveName.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

