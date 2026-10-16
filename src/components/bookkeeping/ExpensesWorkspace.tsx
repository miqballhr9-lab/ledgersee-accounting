"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Ban, CalendarDays, CircleDollarSign, Undo2, Filter, MoreHorizontal, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { readableError } from "@/lib/action-error";

import { deleteBookkeepingRecord, recordBillPayment, recordExpensePayment, undoBillPayments, undoExpensePayment, voidBookkeepingRecord } from "@/app/actions";
import PaymentDialog from "@/components/bookkeeping/PaymentDialog";
import PayBillsDialog from "@/components/bookkeeping/PayBillsDialog";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import RecordDetailPanel from "@/components/bookkeeping/RecordDetailPanel";
import type { RecordMenuAction } from "@/components/bookkeeping/RecordTable";
import { StatusBadge } from "@/components/crm/crm-shared";
import BulkActionsMenu from "@/components/bookkeeping/BulkActionsMenu";
import { Checkbox } from "@/components/ui/checkbox";
import { useNewRecordParam, useOpenRecordParam } from "@/hooks/use-new-record-param";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moduleBySlug, type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseCategoryLabel, expenseLinesFromData } from "@/lib/expense-utils";
import { dueDateForTerms } from "@/lib/invoice-utils";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";

interface ExpensesWorkspaceProps {
  expenses: BookkeepingRecord[];
  bills: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
  /** Products and services for Item details. */
  items?: BookkeepingRecord[];
}

type DatePreset = "last30" | "last90" | "last12" | "thisYear" | "all" | "custom";

const datePresets: { value: Exclude<DatePreset, "custom">; label: string }[] = [
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "last12", label: "Last 12 months" },
  { value: "thisYear", label: "This year" },
  { value: "all", label: "All dates" },
];

function getRecordDate(record: BookkeepingRecord) {
  return record.kind === "bills"
    ? record.data.billDate || record.createdAt.slice(0, 10)
    : record.data.expenseDate || record.createdAt.slice(0, 10);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMoney(value: string, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function escapeCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

/** A check is an expense paid from a bank account, numbered like a cheque book. */
function checkModule(module: ModuleDefinition | undefined, check: boolean | "card-credit"): ModuleDefinition | undefined {
  if (!module || !check) return module;
  // A credit card credit is a refund to a credit card: it lowers the card balance and the expense.
  if (check === "card-credit") return { ...module, label: "Credit card credit", plural: "Credit card credits", description: "A refund to a company credit card." };
  const labels: Record<string, string> = { expenseDate: "Payment date", referenceNumber: "Check no." };
  return { ...module, label: "Check", plural: "Checks", description: "Pay a supplier by check from a bank account.", fields: module.fields.map((field) => (labels[field.key] ? { ...field, label: labels[field.key] } : field)) };
}

/** The number after the highest check number used so far, starting at 1001. */
function nextCheckNumber(records: BookkeepingRecord[]) {
  const used = records.filter((record) => record.data.docType === "Check").map((record) => Number(record.data.referenceNumber)).filter((value) => Number.isInteger(value) && value > 0);
  return String(used.length ? Math.max(...used) + 1 : 1001);
}

function dateCutoff(preset: DatePreset, asOfDate: string) {
  const today = new Date(`${asOfDate}T00:00:00`);
  if (preset === "all" || preset === "custom") return "";
  if (preset === "thisYear") return `${today.getFullYear()}-01-01`;
  if (preset === "last30") today.setDate(today.getDate() - 30);
  if (preset === "last90") today.setDate(today.getDate() - 90);
  if (preset === "last12") today.setMonth(today.getMonth() - 12);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function createDefaults(kind: "bills" | "expenses", records: BookkeepingRecord[], asOfDate: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (kind === "expenses") {
    values.expenseDate = asOfDate;
  } else {
    const nextNumber = records.filter((record) => record.kind === "bills").length + 1;
    values.billNumber = `BILL-${String(nextNumber).padStart(4, "0")}`;
    values.billDate = asOfDate;
    values.paymentTerms = "30 days";
    values.dueDate = dueDateForTerms(asOfDate, "30 days");
    values.paymentMethod = "Credit";
    values.paidAmount = "0";
    values.status = "Open";
  }
  return values;
}

export default function ExpensesWorkspace({ expenses: initialExpenses, bills: initialBills, vendors, accounts, currency, asOfDate, items = [] }: ExpensesWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState([...initialBills, ...initialExpenses]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("last12");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draftCategory, setDraftCategory] = useState("all");
  const [draftStatus, setDraftStatus] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editorModule, setEditorModule] = useState<ModuleDefinition | null>(null);
  const [payBillsOpen, setPayBillsOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BookkeepingRecord | null>(null);
  const [editorDefaults, setEditorDefaults] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [actionMessage, setActionMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const pageSize = 10;
  const expenseCategories = accounts.filter((account) => account.kind === "accounts" && account.data.type === "Expense" && account.data.locked !== "true");
  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const transactionCategories = [...new Set(records.flatMap((record) => expenseLinesFromData(record.data).map((line) => line.category).filter(Boolean)))].sort((left, right) => left.localeCompare(right));
  const statuses = [...new Set(records.map((record) => record.data.status).filter((status): status is string => Boolean(status)))].sort();
  const cutoff = dateCutoff(datePreset, asOfDate);

  useEffect(() => setRecords([...initialBills, ...initialExpenses]), [initialBills, initialExpenses]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return records
      .filter((record) => {
        const date = getRecordDate(record);
        const matchesType = typeFilter === "all" || record.kind === typeFilter;
        const matchesDate = datePreset === "custom"
          ? (!customStart || date >= customStart) && (!customEnd || date <= customEnd)
          : !cutoff || date >= cutoff;
        const matchesCategory = categoryFilter === "all" || expenseLinesFromData(record.data).some((line) => line.category === categoryFilter);
        const matchesStatus = statusFilter === "all" || record.data.status === statusFilter;
        const matchesSearch = !normalizedSearch || Object.values(record.data).some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
        return matchesType && matchesDate && matchesCategory && matchesStatus && matchesSearch;
      })
      .sort((left, right) => getRecordDate(right).localeCompare(getRecordDate(left)));
  }, [categoryFilter, customEnd, customStart, cutoff, datePreset, records, search, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const pageRecords = filteredRecords.slice((page - 1) * pageSize, page * pageSize);
  const outstandingBills = records
    .filter((record) => record.kind === "bills" && !["Paid", "Cancelled"].includes(record.data.status || ""))
    .reduce((total, record) => total + Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0)), 0);
  const expensesTotal = records
    .filter((record) => record.kind === "expenses")
    .reduce((total, record) => total + (Number(record.data.amount) || 0), 0);

  useEffect(() => setPage(1), [categoryFilter, customEnd, customStart, datePreset, search, statusFilter, typeFilter]);

  function getEditorModule(kind: "bills" | "expenses", record: BookkeepingRecord | null, check: boolean | "card-credit" = false) {
    const baseModule = checkModule(moduleBySlug(kind), check);
    if (!baseModule) return null;
    const categoryOptions = [...new Set([
      ...expenseCategories.map((account) => account.data.name),
      record?.data.category,
    ].filter((name): name is string => Boolean(name?.trim())))].sort((left, right) => left.localeCompare(right));
    const paymentOptions = [...new Set([
      ...paymentAccounts.map(paymentAccountLabel),
      record?.data.paymentAccount,
    ].filter((name): name is string => Boolean(name?.trim())))].sort((left, right) => left.localeCompare(right));
    return {
      ...baseModule,
      fields: baseModule.fields.map((field) => {
        if (field.key === "category") {
          return {
            ...field,
            type: "select" as const,
            options: categoryOptions,
            help: categoryOptions.length
              ? "Choose an expense category from Chart of accounts."
              : "Add an Expense account in Chart of accounts before recording this transaction.",
          };
        }
        if (kind === "expenses" && field.key === "paymentAccount") {
          return { ...field, type: "select" as const, options: paymentOptions, help: "Optional. Choose the Cash, Bank, or Credit card account used." };
        }
        return field;
      }),
    };
  }

  function openNewTransaction(kind: "bills" | "expenses", check: boolean | "card-credit" = false) {
    const module = getEditorModule(kind, null, check);
    if (!module) return;
    setEditorModule(module);
    setEditingRecord(null);
    setEditorDefaults(check === "card-credit"
      ? { ...createDefaults(kind, records, asOfDate), docType: "Credit card credit" }
      : check ? { ...createDefaults(kind, records, asOfDate), docType: "Check", referenceNumber: nextCheckNumber(records) } : createDefaults(kind, records, asOfDate));
    setActionMessage("");
  }

  useNewRecordParam(() => openNewTransaction("expenses"));
  useOpenRecordParam((id) => {
    const record = records.find((item) => item.id === id);
    if (record) setDetailKey(`${record.kind}-${record.id}`);
  });

  function openEditTransaction(record: BookkeepingRecord) {
    if (record.kind !== "bills" && record.kind !== "expenses") return;
    const module = getEditorModule(record.kind, record, record.data.docType === "Credit card credit" ? "card-credit" : record.data.docType === "Check");
    if (!module) return;
    setEditorModule(module);
    setEditingRecord(record);
    setEditorDefaults({});
    setActionMessage("");
  }

  function handleSaved(record: BookkeepingRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    router.refresh();
  }


  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, setBulkPending] = useState(false);
  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const selectedTransactions = records.filter((record) => selectedIds.has(`${record.kind}-${record.id}`));

  const [paymentTargets, setPaymentTargets] = useState<BookkeepingRecord[] | null>(null);
  const billDue = (record: BookkeepingRecord) => Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));

  function isUnpaid(record: BookkeepingRecord) {
    if (record.kind === "bills") return !["Paid", "Cancelled", "Void", "Pending approval"].includes(record.data.status ?? "") && billDue(record) > 0;
    return !["Paid", "Void"].includes(record.data.status ?? "") && (record.data.status === "Partially Paid" || !record.data.paymentAccount);
  }

  /** Whether anything has been paid, so the payment can be undone. */
  function hasPayment(record: BookkeepingRecord) {
    return Number(record.data.paidAmount || 0) > 0 || record.data.status === "Paid" || (record.kind === "expenses" && !isUnpaid(record));
  }

  /** What is still to pay on a bill or expense. */
  function stillDue(record: BookkeepingRecord) {
    return record.kind === "bills" ? billDue(record) : Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0));
  }

  async function undoPayment(record: BookkeepingRecord) {
    const title = record.kind === "bills" ? record.data.billNumber || "this bill" : record.data.description || "this expense";
    if (!window.confirm(`Undo the payment on ${title}? You can then record it again from another account.`)) return;
    setBulkPending(true);
    try {
      if (record.kind === "bills") await undoBillPayments(record.id);
      else await undoExpensePayment(record.id);
      toast.success(`Payment removed from ${title}.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t undo that payment.");
    } finally {
      setBulkPending(false);
    }
  }

  async function runBulkAction(action: "pay" | "delete") {
    if (!selectedTransactions.length) return;
    if (action === "pay") {
      const payable = selectedTransactions.filter(isUnpaid);
      if (!payable.length) toast.info("The selected transactions are already paid.");
      else setPaymentTargets(payable);
      return;
    }
    const count = selectedTransactions.length;
    if (!window.confirm(`Delete ${count} ${count === 1 ? "transaction" : "transactions"}? This can’t be undone.`)) return;
    await processTransactions(selectedTransactions, "delete");
  }

  async function processTransactions(targets: BookkeepingRecord[], action: "pay" | "delete", payment?: { date: string; accountId: string; amount?: string }) {
    setBulkPending(true);
    setActionMessage("");
    const done: string[] = [];
    const failed: string[] = [];
    for (const record of targets) {
      const title = record.kind === "bills" ? record.data.billNumber || "Bill" : record.data.description || "Expense";
      try {
        if (action === "delete") await deleteBookkeepingRecord(record.kind, record.id);
        else if (payment) await (record.kind === "bills" ? recordBillPayment(record.id, payment.date, payment.accountId, payment.amount) : recordExpensePayment(record.id, payment.date, payment.accountId, payment.amount));
        done.push(`${record.kind}-${record.id}`);
      } catch (error) {
        const message = error instanceof Error ? readableError(error) : "it couldn’t be updated.";
        failed.push(message.includes(title) ? message : `${title}: ${message}`);
      }
    }
    if (action === "delete") setRecords((current) => current.filter((record) => !done.includes(`${record.kind}-${record.id}`)));
    setSelectedIds(new Set());
    setBulkPending(false);
    setPaymentTargets(null);
    if (done.length) toast.success(`${done.length} ${done.length === 1 ? "transaction" : "transactions"} ${action === "delete" ? "deleted" : "paid"}.`);
    if (failed.length) toast.error(failed.join(" "));
    router.refresh();
  }

  async function handleVoid(record: BookkeepingRecord) {
    if (!window.confirm(`Void this ${record.kind === "bills" ? "bill" : "expense"}? It stays on file but no longer counts in your books.`)) return;
    setPendingDelete(record.id);
    setActionMessage("");
    try {
      await voidBookkeepingRecord(record.kind, record.id);
      setRecords((current) => current.map((item) => (item.id === record.id ? { ...item, data: { ...item.data, status: "Void" } } : item)));
      router.refresh();
      setActionMessage(`${record.kind === "bills" ? "Bill" : "Expense"} voided.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "That transaction couldn’t be voided.");
    } finally {
      setPendingDelete(null);
    }
  }

  async function handleDelete(record: BookkeepingRecord) {
    if (!window.confirm(`Delete this ${record.kind === "bills" ? "bill" : "expense"}? This can’t be undone.`)) return;
    setPendingDelete(record.id);
    setActionMessage("");
    try {
      await deleteBookkeepingRecord(record.kind, record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      router.refresh();
      setActionMessage(`${record.kind === "bills" ? "Bill" : "Expense"} deleted.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "That transaction couldn’t be deleted.");
    } finally {
      setPendingDelete(null);
    }
  }

  const detailRecord = records.find((record) => `${record.kind}-${record.id}` === detailKey) ?? null;
  const detailModule = detailRecord ? moduleBySlug(detailRecord.kind) : undefined;
  const detailActions: RecordMenuAction[] = detailRecord ? [
    ...(isUnpaid(detailRecord) ? [{ key: "pay", label: "Record payment", icon: CircleDollarSign, primary: true, run: () => { setDetailKey(null); setPaymentTargets([detailRecord]); } }] : []),
    ...(hasPayment(detailRecord) ? [{ key: "undo-payment", label: "Undo payment", icon: Undo2, run: () => { setDetailKey(null); void undoPayment(detailRecord); } }] : []),
    { key: "edit", label: "Edit", icon: Pencil, primary: true, run: () => { setDetailKey(null); openEditTransaction(detailRecord); } },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, run: () => { setDetailKey(null); void handleDelete(detailRecord); } },
  ] : [];

  function applyFilters() {
    setCategoryFilter(draftCategory);
    setStatusFilter(draftStatus);
    setDatePreset("custom");
    setFiltersOpen(false);
  }

  function exportCsv() {
    const headings = ["Date", "Type", "No. or description", "Payee", "Category", "Payment account", "Amount", "Status"];
    const rows = filteredRecords.map((record) => [
      getRecordDate(record),
      record.kind === "bills" ? "Bill" : record.data.docType === "Check" ? "Check" : record.data.docType === "Credit card credit" ? "Credit card credit" : "Expense",
      record.kind === "bills" ? record.data.billNumber || record.data.description || "" : record.data.description || "",
      record.kind === "bills" ? record.data.vendor || "" : record.data.payee || "",
      expenseCategoryLabel(record.data),
      record.kind === "bills" ? record.data.paymentAccountName || record.data.paymentMethod || "" : record.data.paymentAccount || "",
      record.data.amount || "",
      record.data.status || "",
    ]);
    const csv = [headings, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "expenses.csv";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  const dateLabel = datePreset === "custom"
    ? "Custom dates"
    : datePresets.find((preset) => preset.value === datePreset)?.label || "Last 12 months";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Books / Expenses</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Expenses</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Bills to pay and money already spent, together in one place.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button className="gap-2"><Plus size={16} />New transaction</Button>} />
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => openNewTransaction("bills")}>Bill</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNewTransaction("expenses")}>Expense</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNewTransaction("expenses", true)}>Check</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNewTransaction("expenses", "card-credit")}>Credit card credit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPayBillsOpen(true)}>Pay bills</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3.5">
          <p className="text-xs font-medium text-muted-foreground">Bills to pay</p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{formatMoney(String(outstandingBills), currency)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3.5">
          <p className="text-xs font-medium text-muted-foreground">Expenses recorded</p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{formatMoney(String(expensesTotal), currency)}</p>
        </div>
      </section>

      {actionMessage ? <p role="status" className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{actionMessage}</p> : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Transactions</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filteredRecords.length} {filteredRecords.length === 1 ? "record" : "records"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:w-56 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" className="pl-9" aria-label="Search transactions" />
            </div>
            <BulkActionsMenu
              count={selectedTransactions.length}
              pending={bulkPending}
              noun="transactions"
              items={[{ key: "pay", label: "Record payment", icon: CircleDollarSign }, { key: "delete", label: "Delete", icon: Trash2, destructive: true }]}
              onSelect={(action) => void runBulkAction(action)}
            />
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value ?? "all")}>
              <SelectTrigger className="w-[150px]" aria-label="Transaction type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="bills">Bills</SelectItem>
                <SelectItem value="expenses">Expenses</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={() => { setDraftCategory(categoryFilter); setDraftStatus(statusFilter); setFiltersOpen(true); }}>
              <Filter size={15} />Filter
              {categoryFilter !== "all" || statusFilter !== "all" ? <span className="size-1.5 rounded-full bg-primary" /> : null}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="gap-2"><CalendarDays size={15} /><span className="hidden sm:inline">Dates:</span><span>{dateLabel}</span></Button>} />
              <DropdownMenuContent align="end" className="min-w-48">
                {datePresets.map((preset) => (
                  <DropdownMenuItem key={preset.value} onClick={() => setDatePreset(preset.value)}>{preset.label}</DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => { setDraftCategory(categoryFilter); setDraftStatus(statusFilter); setFiltersOpen(true); }}>Custom range…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all transactions on this page"
                    checked={pageRecords.length > 0 && pageRecords.every((record) => selectedIds.has(`${record.kind}-${record.id}`))}
                    indeterminate={pageRecords.some((record) => selectedIds.has(`${record.kind}-${record.id}`)) && !pageRecords.every((record) => selectedIds.has(`${record.kind}-${record.id}`))}
                    onCheckedChange={(checked) => setSelectedIds((current) => {
                      const next = new Set(current);
                      pageRecords.forEach((record) => (checked === true ? next.add(`${record.kind}-${record.id}`) : next.delete(`${record.kind}-${record.id}`)));
                      return next;
                    })}
                  />
                </TableHead>
                {["Date", "Type", "No. / Description", "Payee", "Category", "Payment account", "Amount", "Status", ""].map((heading) => (
                  <TableHead key={heading || "actions"} className="whitespace-nowrap text-xs font-medium text-muted-foreground">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRecords.map((record) => {
                const isBill = record.kind === "bills";
                const payee = isBill ? record.data.vendor : record.data.payee;
                const title = isBill ? record.data.billNumber || record.data.description : record.data.description;
                const payment = isBill
                  ? record.data.paymentAccountName ? `${record.data.paymentMethod} · ${record.data.paymentAccountName}` : record.data.paymentMethod === "Credit" ? "Credit · unpaid" : record.data.paymentMethod
                  : record.data.paymentAccount;
                return (
                  <TableRow key={`${record.kind}-${record.id}`} className="cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, [role=checkbox], [role=menu]")) setDetailKey(`${record.kind}-${record.id}`); }} data-state={selectedIds.has(`${record.kind}-${record.id}`) ? "selected" : undefined}>
                    <TableCell className="w-10"><Checkbox aria-label={`Select ${title || (isBill ? "bill" : "expense")}`} checked={selectedIds.has(`${record.kind}-${record.id}`)} onCheckedChange={(checked) => toggleSelected(`${record.kind}-${record.id}`, checked === true)} /></TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{formatDate(getRecordDate(record))}</TableCell>
                    <TableCell className="text-[13px]">{isBill ? "Bill" : record.data.docType === "Check" ? "Check" : record.data.docType === "Credit card credit" ? "Credit card credit" : "Expense"}</TableCell>
                    <TableCell className="max-w-[240px] text-[13px] font-medium text-primary"><span className="block truncate" title={title || ""}>{title || "—"}</span></TableCell>
                    <TableCell className="max-w-[180px] text-[13px]"><span className="block truncate" title={payee || ""}>{payee || "—"}</span></TableCell>
                    <TableCell className="max-w-[200px] text-[13px]"><span className="block truncate" title={expenseCategoryLabel(record.data)}>{expenseCategoryLabel(record.data) || "—"}</span></TableCell>
                    <TableCell className="max-w-[200px] text-[13px]"><span className="block truncate" title={payment || ""}>{payment || "—"}</span></TableCell>
                    <TableCell className="text-right text-[13px] font-medium tabular-nums">{formatMoney(record.data.amount || "", currency)}</TableCell>
                    <TableCell className="text-[13px]">
                      <StatusBadge value={record.data.status || (isUnpaid(record) ? "Unpaid" : "Paid")} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More transaction actions"><MoreHorizontal size={15} /></Button>} />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditTransaction(record)}><Pencil size={14} />Edit</DropdownMenuItem>
                            {isUnpaid(record) ? <DropdownMenuItem disabled={bulkPending} onClick={() => setPaymentTargets([record])}><CircleDollarSign size={14} />Record payment</DropdownMenuItem> : null}
                            {hasPayment(record) ? <DropdownMenuItem disabled={bulkPending} onClick={() => void undoPayment(record)}><Undo2 size={14} />Undo payment</DropdownMenuItem> : null}
                            <DropdownMenuSeparator />
                            {record.data.docType === "Check" ? <DropdownMenuItem onClick={() => { const opened = window.open(`/app/documents/expenses/${record.id}/print`, "_blank"); if (opened) opened.opener = null; }}><Printer size={14} />Print check</DropdownMenuItem> : null}
                            {record.data.status !== "Void" && !hasPayment(record) ? <DropdownMenuItem disabled={pendingDelete === record.id} onClick={() => void handleVoid(record)}><Ban size={14} />Void</DropdownMenuItem> : null}
                            <DropdownMenuItem variant="destructive" disabled={pendingDelete === record.id} onClick={() => void handleDelete(record)}><Trash2 size={14} />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!pageRecords.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 whitespace-normal text-center">
                    <div className="sticky left-0 w-[calc(100vw-4.5rem)] sm:static sm:mx-auto sm:w-auto sm:max-w-sm">
                      <p className="text-sm font-medium">{records.length ? "No transactions match these filters" : "No expenses or bills yet"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{records.length ? "Change the date, type, or filters to see more results." : "Add a bill you need to pay or record a purchase already paid."}</p>
                      {!records.length ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button className="mt-4 gap-2"><Plus size={15} />New transaction</Button>} />
                          <DropdownMenuContent align="center">
                            <DropdownMenuItem onClick={() => openNewTransaction("bills")}>Bill</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openNewTransaction("expenses")}>Expense</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Showing {filteredRecords.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
          </div>
        </div>
      </section>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Filter transactions</DialogTitle>
            <DialogDescription>Narrow the list by account category or bill status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="expense-category-filter" className="text-sm font-medium">Category</label>
              <Select value={draftCategory} onValueChange={(value) => setDraftCategory(value ?? "all")}>
                <SelectTrigger id="expense-category-filter" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {transactionCategories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="expense-status-filter" className="text-sm font-medium">Status</label>
              <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value ?? "all")}>
                <SelectTrigger id="expense-status-filter" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><label htmlFor="custom-start-date" className="text-sm font-medium">From</label><Input id="custom-start-date" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></div>
              <div className="space-y-2"><label htmlFor="custom-end-date" className="text-sm font-medium">To</label><Input id="custom-end-date" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDraftCategory("all"); setDraftStatus("all"); setCategoryFilter("all"); setStatusFilter("all"); setCustomStart(""); setCustomEnd(""); setDatePreset("last12"); }}>Clear filters</Button>
            <Button type="button" onClick={applyFilters}>Apply filters</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDialog
        open={Boolean(paymentTargets)}
        onOpenChange={(open) => { if (!open) setPaymentTargets(null); }}
        title="Record payment"
        description={`${paymentTargets?.length ?? 0} ${paymentTargets?.length === 1 ? "transaction" : "transactions"} · ${formatMoney(String((paymentTargets ?? []).reduce((sum, record) => sum + stillDue(record), 0)), currency)} · paid from Bank, Cash or Credit card`}
        submitLabel="Record payment"
        paymentAccounts={paymentAccounts}
        pending={bulkPending}
        amountDue={paymentTargets?.length === 1 ? stillDue(paymentTargets[0]) : undefined}
        onSubmit={(date, accountId, amount) => void processTransactions(paymentTargets ?? [], "pay", { date, accountId, amount })}
      />

      {detailModule ? (
        <RecordDetailPanel
          module={detailModule}
          record={detailRecord ? { ...detailRecord, data: { ...detailRecord.data, status: detailRecord.data.status || (isUnpaid(detailRecord) ? "Unpaid" : "Paid") } } : null}
          currency={currency}
          actions={detailActions}
          onClose={() => setDetailKey(null)}
        />
      ) : null}

      {payBillsOpen ? <PayBillsDialog open onOpenChange={setPayBillsOpen} bills={records.filter((record) => record.kind === "bills")} accounts={accounts} currency={currency} asOfDate={asOfDate} onDone={() => router.refresh()} /> : null}
      {editorModule ? (
        <RecordEditor
          key={`${editorModule.kind}-${editingRecord?.id ?? "new"}`}
          module={editorModule}
          record={editingRecord}
          customers={[]}
          vendors={vendors}
          items={items}
          accounts={accounts}
          defaultCurrency={currency}
          defaults={editorDefaults}
          open={Boolean(editorModule)}
          onOpenChange={(open) => { if (!open) setEditorModule(null); }}
          onSaved={handleSaved}
          onSaveComplete={async (saved, intent) => {
            if (intent !== "save-and-new") return;
            setEditingRecord(null);
            setEditorDefaults(createDefaults(editorModule.kind as "bills" | "expenses", [saved, ...records.filter((record) => record.id !== saved.id)], asOfDate));
          }}
        />
      ) : null}
    </div>
  );
}
