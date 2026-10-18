"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CalendarDays, CircleDollarSign, MoreHorizontal, Plus, Printer, Search } from "lucide-react";

import ReceivePaymentDialog, { invoiceBalance, isOpenInvoice } from "@/components/bookkeeping/ReceivePaymentDialog";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import { StatusBadge } from "@/components/crm/crm-shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { salesReceiptModule } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount, homeRate } from "@/lib/invoice-utils";

interface SalesHubProps {
  invoices: BookkeepingRecord[];
  estimates: BookkeepingRecord[];
  salesOrders: BookkeepingRecord[];
  creditNotes: BookkeepingRecord[];
  payments: BookkeepingRecord[];
  customers: BookkeepingRecord[];
  items: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
}

type SaleType = "Invoice" | "Sales receipt" | "Payment" | "Estimate" | "Sales order" | "Credit note";

interface SaleRow {
  key: string;
  type: SaleType;
  date: string;
  number: string;
  customer: string;
  dueDate: string;
  /** Balance and total in the home currency. */
  balance: number;
  total: number;
  /** The total as entered, in the document's own currency. */
  docTotal: number;
  docCurrency: string;
  status: string;
  href: string;
  printHref: string;
  /** An open invoice payment can be received against. */
  invoice?: BookkeepingRecord;
}

const typeFilters: Array<{ value: string; label: string; types: SaleType[] }> = [
  { value: "all", label: "All transactions", types: ["Invoice", "Sales receipt", "Payment", "Estimate", "Sales order", "Credit note"] },
  { value: "invoices", label: "All invoices", types: ["Invoice"] },
  { value: "receipts", label: "Sales receipts", types: ["Sales receipt"] },
  { value: "payments", label: "Money received", types: ["Payment"] },
  { value: "estimates", label: "Estimates", types: ["Estimate"] },
  { value: "orders", label: "Sales orders", types: ["Sales order"] },
  { value: "credits", label: "Credit notes", types: ["Credit note"] },
];

const statusFilters = ["All statuses", "Open", "Overdue", "Paid", "Draft", "Closed"];

const datePresets = [
  { value: "365", label: "Last 365 days", days: 365 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "all", label: "All dates", days: 0 },
];

function shiftDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** The QuickBooks money bar: one coloured segment per bucket, sized by its amount. */
function MoneyBar({ segments }: { segments: Array<{ label: string; amount: string; caption: string; tone: string; onClick: () => void }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {segments.map((segment) => (
        <button key={segment.label} type="button" onClick={segment.onClick} className="group rounded-lg border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/40">
          <p className="text-xl font-semibold tracking-tight tabular-nums">{segment.amount}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{segment.caption}</p>
          <span className={`mt-3 block h-2 rounded-full ${segment.tone}`} />
          <p className="mt-2 text-xs text-muted-foreground group-hover:text-foreground">{segment.label}</p>
        </button>
      ))}
    </div>
  );
}

export default function SalesHub({ invoices, estimates, salesOrders, creditNotes, payments, customers, items, accounts, currency, asOfDate }: SalesHubProps) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [datePreset, setDatePreset] = useState("365");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [receiving, setReceiving] = useState<{ customer: string; invoiceId: string } | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptKey, setReceiptKey] = useState(0);
  const [lastReceipt, setLastReceipt] = useState(0);
  const receiptModule = useMemo(() => salesReceiptModule(), []);
  const pageSize = 25;

  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);

  const rows = useMemo<SaleRow[]>(() => {
    const result: SaleRow[] = [];
    for (const invoice of invoices) {
      const receipt = invoice.data.docType === "Sales receipt";
      const balance = receipt ? 0 : invoiceBalance(invoice);
      const draft = ["Draft", "Void", "Cancelled"].includes(invoice.data.status ?? "");
      const overdue = !receipt && !draft && balance > 0.005 && Boolean(invoice.data.dueDate) && invoice.data.dueDate < asOfDate;
      const status = receipt ? "Paid" : draft ? invoice.data.status : balance <= 0.005 ? "Paid" : overdue ? "Overdue" : (Number(invoice.data.paidAmount) || 0) > 0 ? "Partially paid" : "Open";
      // Every amount here is in the home currency, whatever currency the invoice is in.
      const rate = homeRate(invoice.data, currency);
      result.push({
        key: `invoice-${invoice.id}`,
        type: receipt ? "Sales receipt" : "Invoice",
        date: invoice.data.issueDate || invoice.createdAt.slice(0, 10),
        number: invoice.data.invoiceNumber || "",
        customer: invoice.data.customer || "",
        dueDate: receipt ? "" : invoice.data.dueDate || "",
        balance: balance * rate,
        total: (Number(invoice.data.amount) || 0) * rate,
        docTotal: Number(invoice.data.amount) || 0,
        docCurrency: invoice.data.currency || currency,
        status,
        href: `/app/invoices?open=${invoice.id}`,
        printHref: `/app/invoices/${invoice.id}/print`,
        invoice: isOpenInvoice(invoice) ? invoice : undefined,
      });
    }
    for (const payment of payments) {
      const invoice = payment.data.invoiceId ? invoiceById.get(payment.data.invoiceId) : undefined;
      // A sales receipt's money is part of the receipt itself.
      if (!invoice || invoice.data.docType === "Sales receipt") continue;
      result.push({
        key: `payment-${payment.id}`,
        type: "Payment",
        date: payment.data.paymentDate || payment.createdAt.slice(0, 10),
        number: payment.data.referenceNumber || "",
        customer: payment.data.customer || invoice.data.customer || "",
        dueDate: "",
        balance: 0,
        total: (Number(payment.data.amount) || 0) * homeRate({ currency: invoice.data.currency ?? "", exchangeRate: payment.data.exchangeRate || invoice.data.exchangeRate || "" }, currency),
        docTotal: Number(payment.data.amount) || 0,
        docCurrency: invoice.data.currency || currency,
        status: "Closed",
        href: `/app/invoices?open=${invoice.id}`,
        printHref: "",
      });
    }
    const documents: Array<[BookkeepingRecord[], SaleType, string, string, string]> = [
      [estimates, "Estimate", "estimateNumber", "expiryDate", "estimates"],
      [salesOrders, "Sales order", "orderNumber", "deliveryDate", "sales-orders"],
      [creditNotes, "Credit note", "creditNumber", "", "credit-notes"],
    ];
    for (const [records, type, numberKey, dueKey, slug] of documents) {
      for (const record of records) {
        const entered = Number(record.data.amount) || 0;
        const amount = entered * homeRate(record.data, currency);
        result.push({
          key: `${slug}-${record.id}`,
          type,
          date: record.data.date || record.createdAt.slice(0, 10),
          number: record.data[numberKey] || "",
          customer: record.data.customer || "",
          dueDate: dueKey ? record.data[dueKey] || "" : "",
          balance: 0,
          total: type === "Credit note" ? -amount : amount,
          docTotal: type === "Credit note" ? -entered : entered,
          docCurrency: record.data.currency || currency,
          status: record.data.status || (type === "Credit note" ? "Open" : "Draft"),
          href: `/app/${slug}?open=${record.id}`,
          printHref: `/app/documents/${slug}/${record.id}/print`,
        });
      }
    }
    return result.sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key));
  }, [invoices, payments, estimates, salesOrders, creditNotes, invoiceById, asOfDate, currency]);

  // The money bar, over the last 365 days like QuickBooks.
  const yearAgo = shiftDate(asOfDate, 365);
  const monthAgo = shiftDate(asOfDate, 30);
  const unbilled = estimates.filter((estimate) => !["Converted", "Declined"].includes(estimate.data.status ?? "") && (estimate.data.date || estimate.createdAt.slice(0, 10)) >= yearAgo);
  const unbilledTotal = unbilled.reduce((sum, estimate) => sum + (Number(estimate.data.amount) || 0) * homeRate(estimate.data, currency), 0);
  const openRows = rows.filter((row) => row.type === "Invoice" && row.balance > 0.005 && !["Draft", "Void", "Cancelled"].includes(row.status) && row.date >= yearAgo);
  const overdueRows = openRows.filter((row) => row.status === "Overdue");
  const overdueTotal = overdueRows.reduce((sum, row) => sum + row.balance, 0);
  const notDueTotal = openRows.reduce((sum, row) => sum + row.balance, 0) - overdueTotal;
  const paidLast30 = rows
    .filter((row) => (row.type === "Payment" || row.type === "Sales receipt") && row.date >= monthAgo)
    .reduce((sum, row) => sum + row.total, 0);

  const allowedTypes = typeFilters.find((filter) => filter.value === typeFilter)?.types ?? typeFilters[0].types;
  const days = datePresets.find((preset) => preset.value === datePreset)?.days ?? 0;
  const from = days ? shiftDate(asOfDate, days) : "";
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!allowedTypes.includes(row.type)) return false;
    if (from && row.date < from) return false;
    if (statusFilter === "Open" && !(row.balance > 0.005 && row.status !== "Draft")) return false;
    if (statusFilter === "Overdue" && row.status !== "Overdue") return false;
    if (statusFilter === "Paid" && row.status !== "Paid") return false;
    if (statusFilter === "Draft" && row.status !== "Draft") return false;
    if (statusFilter === "Closed" && !["Closed", "Paid", "Converted", "Applied", "Refunded", "Fulfilled"].includes(row.status)) return false;
    if (needle && ![row.number, row.customer, row.type, row.status].some((value) => value.toLowerCase().includes(needle))) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function show(type: string, status: string) {
    setTypeFilter(type);
    setStatusFilter(status);
    setDatePreset("365");
    setPage(1);
  }

  function exportCsv() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [["Date", "Type", "No.", "Customer", "Due date", "Balance", "Total", "Status"], ...filtered.map((row) => [row.date, row.type, row.number, row.customer, row.dueDate, row.balance.toFixed(2), row.total.toFixed(2), row.status])]
      .map((line) => line.map(escape).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sales.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Numbers run on from the highest SR- number, including one saved a moment ago that the list doesn't hold yet.
  const receiptNumber = (value: string | undefined) => Number(/^SR-(\d+)$/.exec(value ?? "")?.[1] ?? 0);
  const nextReceipt = Math.max(lastReceipt, ...invoices.map((invoice) => receiptNumber(invoice.data.invoiceNumber))) + 1;
  const receiptDefaults = useMemo(() => ({
    docType: "Sales receipt",
    invoiceNumber: `SR-${String(nextReceipt).padStart(4, "0")}`,
    issueDate: asOfDate,
    paymentTerms: "Due on receipt",
    currency,
    exchangeRate: "1",
  }), [nextReceipt, asOfDate, currency]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Sales</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">All sales</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Invoices, sales receipts, payments, estimates and credit notes in one list.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button className="gap-2"><Plus size={16} />New transaction</Button>} />
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem render={<Link href="/app/invoices?new=1" />}>Invoice</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReceiving({ customer: "", invoiceId: "" })}>Receive payment</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/estimates?new=1" />}>Estimate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReceiptOpen(true)} disabled={!receiptModule}>Sales receipt</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/credit-notes?new=1" />}>Credit note</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/sales-orders?new=1" />}>Sales order</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="mt-6" aria-label="Money bar">
        <MoneyBar
          segments={[
            { label: `${unbilled.length} ${unbilled.length === 1 ? "estimate" : "estimates"}`, amount: unbilledTotal, caption: "Unbilled · last 365 days", tone: "bg-sky-500", onClick: () => show("estimates", "All statuses") },
            { label: `${overdueRows.length} overdue ${overdueRows.length === 1 ? "invoice" : "invoices"}`, amount: overdueTotal, caption: "Overdue", tone: "bg-orange-500", onClick: () => show("invoices", "Overdue") },
            { label: `${openRows.length - overdueRows.length} not due yet`, amount: notDueTotal, caption: "Open invoices · not due", tone: "bg-slate-400", onClick: () => show("invoices", "Open") },
            { label: "Payments and sales receipts", amount: paidLast30, caption: "Paid · last 30 days", tone: "bg-emerald-500", onClick: () => { show("all", "All statuses"); setDatePreset("30"); } },
          ].map((segment) => ({ ...segment, amount: currencyAmount(segment.amount, currency) }))}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Sales transactions</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 basis-full sm:w-56 sm:flex-none sm:basis-auto">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by no. or customer" className="pl-9" aria-label="Search sales" />
            </div>
            <Select value={typeFilter} onValueChange={(value) => { setTypeFilter(value ?? "all"); setPage(1); }}>
              <SelectTrigger className="w-[170px]" aria-label="Type"><SelectValue>{typeFilters.find((filter) => filter.value === typeFilter)?.label}</SelectValue></SelectTrigger>
              <SelectContent>{typeFilters.map((filter) => <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value ?? "All statuses"); setPage(1); }}>
              <SelectTrigger className="w-[140px]" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>{statusFilters.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={datePreset} onValueChange={(value) => { setDatePreset(value ?? "365"); setPage(1); }}>
              <SelectTrigger className="w-[160px]" aria-label="Dates"><CalendarDays size={15} className="text-muted-foreground" /><SelectValue>{datePresets.find((preset) => preset.value === datePreset)?.label}</SelectValue></SelectTrigger>
              <SelectContent>{datePresets.map((preset) => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {["Date", "Type", "No.", "Customer", "Due date", `Balance (${currency})`, "Total", `Total (${currency})`, "Status", "Action"].map((heading) => (
                  <TableHead key={heading} className={`whitespace-nowrap text-xs font-medium text-muted-foreground ${heading.startsWith("Balance") || heading.startsWith("Total") || heading === "Action" ? "text-right" : ""}`}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow key={row.key} className="cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, [role=menu]")) router.push(row.href); }}>
                  <TableCell className="whitespace-nowrap text-[13px]">{formatDate(row.date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">{row.type}</TableCell>
                  <TableCell className="text-[13px] font-medium text-primary"><Link href={row.href}>{row.number || "—"}</Link></TableCell>
                  <TableCell className="max-w-[200px] text-[13px]"><span className="block truncate" title={row.customer}>{row.customer || "—"}</span></TableCell>
                  <TableCell className={`whitespace-nowrap text-[13px] ${row.status === "Overdue" ? "text-destructive" : ""}`}>{formatDate(row.dueDate)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{currencyAmount(row.balance, currency)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{currencyAmount(row.docTotal, row.docCurrency)}</TableCell>
                  <TableCell className="text-right text-[13px] font-medium tabular-nums">{currencyAmount(row.total, currency)}</TableCell>
                  <TableCell className="text-[13px]"><StatusBadge value={row.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {row.invoice ? (
                        <Button variant="link" size="sm" className="h-auto px-1" onClick={() => setReceiving({ customer: row.customer, invoiceId: row.invoice!.id })}>Receive payment</Button>
                      ) : (
                        <Button variant="link" size="sm" className="h-auto px-1" nativeButton={false} render={<Link href={row.href} />}>View</Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.type.toLowerCase()} ${row.number}`}><MoreHorizontal size={15} /></Button>} />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem render={<Link href={row.href} />}>Open</DropdownMenuItem>
                          {row.printHref ? <DropdownMenuItem render={<Link href={row.printHref} target="_blank" rel="noreferrer" />}><Printer size={14} />Print</DropdownMenuItem> : null}
                          {row.invoice ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setReceiving({ customer: row.customer, invoiceId: row.invoice!.id })}><CircleDollarSign size={14} />Receive payment</DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!pageRows.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-40 whitespace-normal text-center">
                    <p className="text-sm font-medium">{rows.length ? "No sales match these filters" : "No sales yet"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{rows.length ? "Change the type, status or dates to see more." : "Create an invoice or a sales receipt to get started."}</p>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{currentPage} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        </div>
      </section>

      {receiving ? (
        <ReceivePaymentDialog
          key={`${receiving.customer}-${receiving.invoiceId}`}
          open
          onOpenChange={(open) => { if (!open) setReceiving(null); }}
          customers={customers}
          invoices={invoices}
          accounts={accounts}
          currency={currency}
          asOfDate={asOfDate}
          initialCustomer={receiving.customer}
          initialInvoiceId={receiving.invoiceId}
          onDone={() => router.refresh()}
        />
      ) : null}

      {receiptModule && receiptOpen ? (
        <RecordEditor
          key={receiptKey}
          module={receiptModule}
          record={null}
          customers={customers}
          vendors={[]}
          items={items}
          accounts={accounts}
          defaultCurrency={currency}
          defaults={receiptDefaults}
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          onSaved={(saved) => { setLastReceipt((current) => Math.max(current, receiptNumber(saved.data.invoiceNumber))); router.refresh(); }}
          onSaveComplete={async (_saved, intent) => { if (intent === "save-and-new") setReceiptKey((current) => current + 1); }}
        />
      ) : null}
    </div>
  );
}
