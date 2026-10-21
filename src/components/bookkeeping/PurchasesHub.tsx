"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, CalendarDays, ChevronDown, CircleDollarSign, MoreHorizontal, Plus, Printer, Search, Trash2 } from "lucide-react";

import { deleteBookkeepingRecord } from "@/app/actions";
import PayBillsDialog, { billBalance } from "@/components/bookkeeping/PayBillsDialog";
import { StatusBadge } from "@/components/crm/crm-shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { currencyAmount, homeRate } from "@/lib/invoice-utils";

interface PurchasesHubProps {
  bills: BookkeepingRecord[];
  expenses: BookkeepingRecord[];
  purchaseOrders: BookkeepingRecord[];
  supplierCredits: BookkeepingRecord[];
  /** Payments made against bills. */
  billPayments: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
}

type PurchaseType = "Bill" | "Bill payment" | "Expense" | "Check" | "Credit card credit" | "Purchase order" | "Supplier credit";

interface PurchaseRow {
  key: string;
  /** The record behind the row, for deleting it; bill payments are removed from their bill instead. */
  kind: RecordKind | "";
  id: string;
  type: PurchaseType;
  date: string;
  number: string;
  payee: string;
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
  /** An open bill that can be paid. */
  payable: boolean;
}

const typeFilters: Array<{ value: string; label: string; types: PurchaseType[] }> = [
  { value: "all", label: "All transactions", types: ["Bill", "Bill payment", "Expense", "Check", "Credit card credit", "Purchase order", "Supplier credit"] },
  { value: "bills", label: "All bills", types: ["Bill"] },
  { value: "payments", label: "Bill payments", types: ["Bill payment"] },
  { value: "expenses", label: "Expenses", types: ["Expense", "Credit card credit"] },
  { value: "checks", label: "Checks", types: ["Check"] },
  { value: "orders", label: "Purchase orders", types: ["Purchase order"] },
  { value: "credits", label: "Supplier credits", types: ["Supplier credit"] },
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

const inactive = ["Draft", "Void", "Cancelled", "Pending approval"];

/** Every purchase in one list, as All sales is for sales: bills, payments, expenses, checks, orders and supplier credits. */
export default function PurchasesHub({ bills, expenses, purchaseOrders, supplierCredits, billPayments, vendors, accounts, currency, asOfDate }: PurchasesHubProps) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [datePreset, setDatePreset] = useState("365");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [paying, setPaying] = useState(false);
  const pageSize = 25;

  const vendorId = new Map(vendors.map((vendor) => [(vendor.data.name ?? "").trim().toLowerCase(), vendor.id]));
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const rows: PurchaseRow[] = [];
  for (const bill of bills) {
    const balance = billBalance(bill);
    const stored = bill.data.status ?? "";
    const overdue = !inactive.includes(stored) && balance > 0.005 && Boolean(bill.data.dueDate) && bill.data.dueDate < asOfDate;
    const status = inactive.includes(stored) ? stored : balance <= 0.005 ? "Paid" : overdue ? "Overdue" : (Number(bill.data.paidAmount) || 0) > 0 ? "Partially paid" : "Open";
    const rate = homeRate(bill.data, currency);
    rows.push({
      key: `bill-${bill.id}`, kind: "bills", id: bill.id, type: "Bill",
      date: bill.data.billDate || bill.createdAt.slice(0, 10), number: bill.data.billNumber || "", payee: bill.data.vendor || "", dueDate: bill.data.dueDate || "",
      balance: inactive.includes(stored) ? 0 : balance * rate, total: (Number(bill.data.amount) || 0) * rate, docTotal: Number(bill.data.amount) || 0, docCurrency: bill.data.currency || currency,
      status, href: `/app/bills?open=${bill.id}`, printHref: "", payable: !inactive.includes(stored) && balance > 0.005,
    });
  }
  for (const payment of billPayments) {
    const bill = billById.get(payment.data.billId ?? "");
    if (!bill) continue;
    const rate = homeRate({ currency: bill.data.currency ?? "", exchangeRate: payment.data.exchangeRate || bill.data.exchangeRate || "" }, currency);
    rows.push({
      key: `payment-${payment.id}`, kind: "", id: payment.id, type: "Bill payment",
      date: payment.data.paymentDate || payment.createdAt.slice(0, 10), number: payment.data.referenceNumber || bill.data.billNumber || "", payee: payment.data.vendor || bill.data.vendor || "", dueDate: "",
      balance: 0, total: (Number(payment.data.amount) || 0) * rate, docTotal: Number(payment.data.amount) || 0, docCurrency: bill.data.currency || currency,
      status: "Closed", href: `/app/bills?open=${bill.id}`, printHref: "", payable: false,
    });
  }
  for (const expense of expenses) {
    const type: PurchaseType = expense.data.docType === "Check" ? "Check" : expense.data.docType === "Credit card credit" ? "Credit card credit" : "Expense";
    const rate = homeRate(expense.data, currency);
    const entered = Number(expense.data.amount) || 0;
    const unpaid = ["Unpaid", "Partially Paid"].includes(expense.data.status ?? "");
    const sign = type === "Credit card credit" ? -1 : 1;
    rows.push({
      key: `expense-${expense.id}`, kind: "expenses", id: expense.id, type,
      date: expense.data.expenseDate || expense.createdAt.slice(0, 10), number: expense.data.referenceNumber || "", payee: expense.data.payee || expense.data.vendor || "", dueDate: "",
      balance: unpaid ? Math.max(0, entered - (Number(expense.data.paidAmount) || 0)) * rate : 0, total: sign * entered * rate, docTotal: sign * entered, docCurrency: expense.data.currency || currency,
      status: expense.data.status === "Void" ? "Void" : unpaid ? (expense.data.status === "Unpaid" ? "Open" : "Partially paid") : "Paid",
      href: `/app/expenses?open=${expense.id}`, printHref: type === "Check" ? `/app/documents/expenses/${expense.id}/print` : "", payable: false,
    });
  }
  for (const order of purchaseOrders) {
    const entered = Number(order.data.amount) || 0;
    rows.push({
      key: `order-${order.id}`, kind: "purchase-orders", id: order.id, type: "Purchase order",
      date: order.data.date || order.createdAt.slice(0, 10), number: order.data.poNumber || "", payee: order.data.vendor || "", dueDate: order.data.expectedDate || "",
      balance: 0, total: entered * homeRate(order.data, currency), docTotal: entered, docCurrency: order.data.currency || currency,
      status: order.data.status || "Draft", href: `/app/purchase-orders?open=${order.id}`, printHref: "", payable: false,
    });
  }
  for (const credit of supplierCredits) {
    const entered = Number(credit.data.amount) || 0;
    rows.push({
      key: `credit-${credit.id}`, kind: "supplier-credits", id: credit.id, type: "Supplier credit",
      date: credit.data.date || credit.createdAt.slice(0, 10), number: credit.data.creditNumber || credit.data.billNumber || "", payee: credit.data.vendor || "", dueDate: "",
      balance: 0, total: -entered * homeRate(credit.data, currency), docTotal: -entered, docCurrency: credit.data.currency || currency,
      status: credit.data.status || "Open", href: `/app/supplier-credits?open=${credit.id}`, printHref: "", payable: false,
    });
  }
  rows.sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key));

  // The money bar, over the last 365 days.
  const yearAgo = shiftDate(asOfDate, 365);
  const monthAgo = shiftDate(asOfDate, 30);
  const openOrders = rows.filter((row) => row.type === "Purchase order" && ["Purchase Order", "Partially received"].includes(row.status) && row.date >= yearAgo);
  const openOrdersTotal = openOrders.reduce((sum, row) => sum + row.total, 0);
  const openBills = rows.filter((row) => row.type === "Bill" && row.payable && row.date >= yearAgo);
  const overdueBills = openBills.filter((row) => row.status === "Overdue");
  const overdueTotal = overdueBills.reduce((sum, row) => sum + row.balance, 0);
  const notDueTotal = openBills.reduce((sum, row) => sum + row.balance, 0) - overdueTotal;
  const paidLast30 = rows
    .filter((row) => (row.type === "Bill payment" || ((row.type === "Expense" || row.type === "Check") && row.status === "Paid")) && row.date >= monthAgo)
    .reduce((sum, row) => sum + row.total, 0);

  const allowedTypes = typeFilters.find((filter) => filter.value === typeFilter)?.types ?? typeFilters[0].types;
  const days = datePresets.find((preset) => preset.value === datePreset)?.days ?? 0;
  const from = days ? shiftDate(asOfDate, days) : "";
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (removed.has(row.key)) return false;
    if (!allowedTypes.includes(row.type)) return false;
    if (from && row.date < from) return false;
    if (statusFilter === "Open" && !(row.balance > 0.005)) return false;
    if (statusFilter === "Overdue" && row.status !== "Overdue") return false;
    if (statusFilter === "Paid" && row.status !== "Paid") return false;
    if (statusFilter === "Draft" && row.status !== "Draft") return false;
    if (statusFilter === "Closed" && !["Closed", "Paid", "Received", "Applied", "Refunded"].includes(row.status)) return false;
    if (needle && ![row.number, row.payee, row.type, row.status].some((value) => value.toLowerCase().includes(needle))) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const chosen = filtered.filter((row) => selected.has(row.key));
  const pageChecked = pageRows.length > 0 && pageRows.every((row) => selected.has(row.key));
  const toggle = (key: string, on: boolean) => setSelected((current) => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; });

  function show(type: string, status: string) {
    setTypeFilter(type);
    setStatusFilter(status);
    setDatePreset("365");
    setPage(1);
  }

  function exportCsv(list: PurchaseRow[] = filtered) {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [["Date", "Type", "No.", "Payee", "Due date", "Balance", "Total", "Status"], ...list.map((row) => [row.date, row.type, row.number, row.payee, row.dueDate, row.balance.toFixed(2), row.total.toFixed(2), row.status])]
      .map((line) => line.map(escape).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "purchases.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function deleteChosen() {
    const deletable = chosen.filter((row) => row.kind);
    const skipped = chosen.length - deletable.length;
    if (!deletable.length) return toast.error("Bill payments can't be deleted here. Open the bill and remove the payment there.");
    if (!window.confirm(`Delete ${deletable.length} ${deletable.length === 1 ? "transaction" : "transactions"}? This can’t be undone.${skipped ? ` ${skipped} bill payment${skipped === 1 ? "" : "s"} will be left as they are.` : ""}`)) return;
    setWorking(true);
    const done: string[] = [];
    const failed: string[] = [];
    for (const row of deletable) {
      try {
        await deleteBookkeepingRecord(row.kind, row.id);
        done.push(row.key);
      } catch (error) {
        failed.push(`${row.type} ${row.number || ""}: ${error instanceof Error ? readableError(error) : "it couldn’t be deleted."}`.trim());
      }
    }
    setRemoved((current) => new Set([...current, ...done]));
    setSelected(new Set());
    setWorking(false);
    if (done.length) toast.success(`${done.length} ${done.length === 1 ? "transaction" : "transactions"} deleted.`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" · "));
    router.refresh();
  }

  async function deleteOne(row: PurchaseRow) {
    if (!row.kind || !window.confirm(`Delete ${[row.type.toLowerCase(), row.number].filter(Boolean).join(" ")}? This can’t be undone.`)) return;
    setWorking(true);
    try {
      await deleteBookkeepingRecord(row.kind, row.id);
      setRemoved((current) => new Set([...current, row.key]));
      toast.success(`${row.type} deleted.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "It couldn’t be deleted.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Purchases</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">All purchases</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Bills, bill payments, expenses, checks, purchase orders and supplier credits in one list.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => exportCsv()}><ArrowDownToLine size={15} />Export</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button className="gap-2"><Plus size={16} />New transaction</Button>} />
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem render={<Link href="/app/bills?new=1" />}>Bill</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPaying(true)}>Pay bills</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/expenses?new=1" />}>Expense</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/purchase-orders?new=1" />}>Purchase order</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/app/supplier-credits?new=1" />}>Supplier credit</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="mt-6" aria-label="Money bar">
        <MoneyBar
          segments={[
            { label: `${openOrders.length} open ${openOrders.length === 1 ? "order" : "orders"}`, amount: openOrdersTotal, caption: "Purchase orders · last 365 days", tone: "bg-sky-500", onClick: () => show("orders", "All statuses") },
            { label: `${overdueBills.length} overdue ${overdueBills.length === 1 ? "bill" : "bills"}`, amount: overdueTotal, caption: "Overdue", tone: "bg-orange-500", onClick: () => show("bills", "Overdue") },
            { label: `${openBills.length - overdueBills.length} not due yet`, amount: notDueTotal, caption: "Open bills · not due", tone: "bg-slate-400", onClick: () => show("bills", "Open") },
            { label: "Bill payments and paid expenses", amount: paidLast30, caption: "Paid · last 30 days", tone: "bg-emerald-500", onClick: () => { show("all", "All statuses"); setDatePreset("30"); } },
          ].map((segment) => ({ ...segment, amount: currencyAmount(segment.amount, currency) }))}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Purchase transactions</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {chosen.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5" disabled={working}>Actions ({chosen.length})<ChevronDown size={14} /></Button>} />
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem onClick={() => exportCsv(chosen)}><ArrowDownToLine size={14} />Export to Excel (CSV)</DropdownMenuItem>
                  {chosen.some((row) => row.payable) ? <DropdownMenuItem onClick={() => setPaying(true)}><CircleDollarSign size={14} />Pay bills</DropdownMenuItem> : null}
                  {chosen.some((row) => row.printHref) ? <DropdownMenuItem onClick={() => { for (const row of chosen.filter((item) => item.printHref).slice(0, 10)) { const opened = window.open(row.printHref, "_blank"); if (opened) opened.opener = null; } }}><Printer size={14} />Print checks</DropdownMenuItem> : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => void deleteChosen()}><Trash2 size={14} />Delete</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelected(new Set())}>Clear selection</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <div className="relative min-w-0 basis-full sm:w-56 sm:flex-none sm:basis-auto">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by no. or payee" className="pl-9" aria-label="Search purchases" />
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
                <TableHead className="w-10"><Checkbox checked={pageChecked} aria-label="Select all on this page" onCheckedChange={(on) => setSelected((current) => { const next = new Set(current); for (const row of pageRows) { if (on) next.add(row.key); else next.delete(row.key); } return next; })} /></TableHead>
                {["Date", "Type", "No.", "Payee", "Due date", `Balance (${currency})`, "Total", `Total (${currency})`, "Status", "Action"].map((heading) => (
                  <TableHead key={heading} className={`whitespace-nowrap text-xs font-medium text-muted-foreground ${heading.startsWith("Balance") || heading.startsWith("Total") || heading === "Action" ? "text-right" : ""}`}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow key={row.key} data-state={selected.has(row.key) ? "selected" : undefined} className="cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, [role=menu], [role=checkbox]")) router.push(row.href); }}>
                  <TableCell className="w-10" onClick={(event) => event.stopPropagation()}><Checkbox checked={selected.has(row.key)} aria-label={`Select ${row.type.toLowerCase()} ${row.number}`} onCheckedChange={(on) => toggle(row.key, Boolean(on))} /></TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">{formatDate(row.date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">{row.type}</TableCell>
                  <TableCell className="text-[13px] font-medium text-primary"><Link href={row.href}>{row.number || "—"}</Link></TableCell>
                  <TableCell className="max-w-[200px] text-[13px]">{row.payee && vendorId.has(row.payee.trim().toLowerCase()) ? <Link href={`/app/vendors?open=${vendorId.get(row.payee.trim().toLowerCase())}`} className="block truncate hover:text-primary hover:underline" title={row.payee}>{row.payee}</Link> : <span className="block truncate" title={row.payee}>{row.payee || "—"}</span>}</TableCell>
                  <TableCell className={`whitespace-nowrap text-[13px] ${row.status === "Overdue" ? "text-destructive" : ""}`}>{formatDate(row.dueDate)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{currencyAmount(row.balance, currency)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{currencyAmount(row.docTotal, row.docCurrency)}</TableCell>
                  <TableCell className="text-right text-[13px] font-medium tabular-nums">{currencyAmount(row.total, currency)}</TableCell>
                  <TableCell className="text-[13px]"><StatusBadge value={row.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {row.payable ? (
                        <Button variant="link" size="sm" className="h-auto px-1" onClick={() => setPaying(true)}>Pay bill</Button>
                      ) : (
                        <Button variant="link" size="sm" className="h-auto px-1" nativeButton={false} render={<Link href={row.href} />}>View</Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.type.toLowerCase()} ${row.number}`}><MoreHorizontal size={15} /></Button>} />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem render={<Link href={row.href} />}>Open</DropdownMenuItem>
                          {row.printHref ? <DropdownMenuItem render={<Link href={row.printHref} target="_blank" rel="noreferrer" />}><Printer size={14} />Print check</DropdownMenuItem> : null}
                          {row.kind ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => void deleteOne(row)}><Trash2 size={14} />Delete</DropdownMenuItem>
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
                  <TableCell colSpan={11} className="h-40 whitespace-normal text-center">
                    <p className="text-sm font-medium">{rows.length ? "No purchases match these filters" : "No purchases yet"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{rows.length ? "Change the type, status or dates to see more." : "Enter a bill or an expense to get started."}</p>
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

      {paying ? (
        <PayBillsDialog open onOpenChange={setPaying} bills={bills} accounts={accounts} currency={currency} asOfDate={asOfDate} onDone={() => router.refresh()} />
      ) : null}
    </div>
  );

}
