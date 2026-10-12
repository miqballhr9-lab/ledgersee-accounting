"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CircleDollarSign, MoreHorizontal, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { deleteBookkeepingRecord, recordBillPayment, undoBillPayments } from "@/app/actions";
import PaymentDialog from "@/components/bookkeeping/PaymentDialog";
import { paymentAccountType } from "@/lib/payment-accounts";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import RecordDetailPanel from "@/components/bookkeeping/RecordDetailPanel";
import type { RecordMenuAction } from "@/components/bookkeeping/RecordTable";
import { StatusBadge } from "@/components/crm/crm-shared";
import BulkActionsMenu from "@/components/bookkeeping/BulkActionsMenu";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useNewRecordParam, useOpenRecordParam } from "@/hooks/use-new-record-param";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moduleBySlug, type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { expenseCategoryLabel, expenseLinesFromData } from "@/lib/expense-utils";
import { dueDateForTerms } from "@/lib/invoice-utils";

interface BillsWorkspaceProps {
  records: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
  /** Default terms for new bills, from Settings. */
  billTerms?: string;
  /** Products and services for the bill's Item details. */
  items?: BookkeepingRecord[];
}

type BillStatus = "Open" | "Partially Paid" | "Overdue" | "Paid" | "Cancelled";

function amountDue(record: BookkeepingRecord) {
  return Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));
}

function billStatus(record: BookkeepingRecord, asOfDate: string): BillStatus {
  const savedStatus = record.data.status;
  if (savedStatus === "Cancelled") return "Cancelled";
  if (amountDue(record) <= 0 || savedStatus === "Paid") return "Paid";
  if (record.data.dueDate && record.data.dueDate < asOfDate) return "Overdue";
  if (Number(record.data.paidAmount || 0) > 0) return "Partially Paid";
  return "Open";
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function BillsWorkspace({ records: initialRecords, vendors, accounts, currency, asOfDate, billTerms = "30 days", items = [] }: BillsWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BookkeepingRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const [defaults, setDefaults] = useState<Record<string, string>>({});

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  const categories = useMemo(() => [...new Set([
    ...accounts.filter((account) => account.kind === "accounts" && account.data.type === "Expense" && account.data.locked !== "true").map((account) => account.data.name),
    ...records.flatMap((record) => expenseLinesFromData(record.data).map((line) => line.category)),
  ].filter((name): name is string => Boolean(name?.trim())))].sort((left, right) => left.localeCompare(right)), [accounts, records]);

  const editorModule = useMemo(() => {
    const baseModule = moduleBySlug("bills");
    if (!baseModule) return null;
    return baseModule;
  }, []);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const status = billStatus(record, asOfDate);
      const matchesStatus = statusFilter === "all" || (statusFilter === "open" ? ["Open", "Partially Paid", "Overdue"].includes(status) : status.toLowerCase() === statusFilter);
      const matchesCategory = categoryFilter === "all" || expenseLinesFromData(record.data).some((line) => line.category === categoryFilter);
      const matchesSearch = !normalizedSearch || [record.data.billNumber, record.data.vendor, record.data.description, record.data.category]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
      return matchesStatus && matchesCategory && matchesSearch;
    }).sort((left, right) => (right.data.billDate || right.createdAt).localeCompare(left.data.billDate || left.createdAt));
  }, [asOfDate, categoryFilter, records, search, statusFilter]);

  const outstanding = records.filter((record) => !["Paid", "Cancelled"].includes(billStatus(record, asOfDate))).reduce((sum, record) => sum + amountDue(record), 0);
  const overdue = records.filter((record) => billStatus(record, asOfDate) === "Overdue").reduce((sum, record) => sum + amountDue(record), 0);
  const paidTotal = records.reduce((sum, record) => sum + Number(record.data.paidAmount || 0), 0);

  /** `added` counts a bill saved a moment ago that the list doesn't hold yet (Save and new). */
  function openNewBill(added = 0) {
    setEditingRecord(null);
    setDefaults({
      billNumber: `BILL-${String(records.length + 1 + added).padStart(4, "0")}`,
      billDate: asOfDate,
      dueDate: dueDateForTerms(asOfDate, billTerms) || asOfDate,
      paymentTerms: billTerms,
      paymentMethod: "Credit",
      paidAmount: "0",
      status: "Open",
    });
    setActionMessage("");
    setEditorOpen(true);
  }

  useNewRecordParam(openNewBill);
  useOpenRecordParam(setDetailId);

  function openEditBill(record: BookkeepingRecord) {
    setEditingRecord(record);
    setDefaults({});
    setActionMessage("");
    setEditorOpen(true);
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
  const selectedBills = records.filter((record) => selectedIds.has(record.id));

  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const [paymentTargets, setPaymentTargets] = useState<BookkeepingRecord[] | null>(null);

  function isPayable(record: BookkeepingRecord) {
    return !["Paid", "Cancelled"].includes(billStatus(record, asOfDate)) && amountDue(record) > 0;
  }

  async function runBulkAction(action: "pay" | "undo-payment" | "delete") {
    if (!selectedBills.length) return;
    if (action === "pay") {
      const payable = selectedBills.filter(isPayable);
      if (!payable.length) toast.info("The selected bills are already paid.");
      else setPaymentTargets(payable);
      return;
    }
    const count = selectedBills.length;
    const noun = count === 1 ? "bill" : "bills";
    if (!window.confirm(action === "delete" ? `Delete ${count} ${noun}? This can’t be undone.` : `Remove the payments recorded on ${count} ${noun}? They will show as unpaid again.`)) return;
    await processBills(selectedBills, action);
  }

  async function processBills(targets: BookkeepingRecord[], action: "pay" | "undo-payment" | "delete", payment?: { date: string; accountId: string; amount?: string }) {
    setBulkPending(true);
    setActionMessage("");
    const done: string[] = [];
    const failed: string[] = [];
    for (const record of targets) {
      const title = record.data.billNumber || "Bill";
      try {
        if (action === "delete") await deleteBookkeepingRecord("bills", record.id);
        else if (action === "undo-payment") await undoBillPayments(record.id);
        else if (payment) await recordBillPayment(record.id, payment.date, payment.accountId, payment.amount);
        done.push(record.id);
      } catch (error) {
        const message = error instanceof Error ? readableError(error) : "it couldn’t be updated.";
        failed.push(message.includes(title) ? message : `${title}: ${message}`);
      }
    }
    if (action === "delete") setRecords((current) => current.filter((record) => !done.includes(record.id)));
    setSelectedIds(new Set());
    setBulkPending(false);
    setPaymentTargets(null);
    const verb = action === "delete" ? "deleted" : action === "undo-payment" ? "reopened as unpaid" : "paid";
    if (done.length) toast.success(`${done.length} ${done.length === 1 ? "bill" : "bills"} ${verb}.`);
    if (failed.length) toast.error(failed.join(" "));
    router.refresh();
  }

  function handleMarkPaid(record: BookkeepingRecord) {
    setPaymentTargets([record]);
  }

  async function handleUndoPayment(record: BookkeepingRecord) {
    if (!window.confirm(`Undo the payment on ${record.data.billNumber || "this bill"}? It will show as unpaid so you can pay it again.`)) return;
    await processBills([record], "undo-payment");
  }

  async function handleDelete(record: BookkeepingRecord) {
    if (!window.confirm(`Delete ${record.data.billNumber || "this bill"}? This can’t be undone.`)) return;
    setPendingAction(true);
    setActionMessage("");
    try {
      await deleteBookkeepingRecord("bills", record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setActionMessage("Bill deleted.");
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "We couldn’t delete that bill.");
    } finally {
      setPendingAction(false);
    }
  }

  const detailRecord = records.find((record) => record.id === detailId) ?? null;
  const detailActions: RecordMenuAction[] = detailRecord ? [
    ...(["Paid", "Cancelled"].includes(billStatus(detailRecord, asOfDate)) ? [] : [{ key: "pay", label: "Record payment", icon: CircleDollarSign, primary: true, run: () => { setDetailId(null); handleMarkPaid(detailRecord); } }]),
    { key: "edit", label: "Edit", icon: Pencil, primary: true, run: () => { setDetailId(null); openEditBill(detailRecord); } },
    ...(Number(detailRecord.data.paidAmount) > 0 ? [{ key: "undo-payment", label: "Undo payment", icon: Undo2, run: () => { setDetailId(null); void handleUndoPayment(detailRecord); } }] : []),
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, run: () => { setDetailId(null); void handleDelete(detailRecord); } },
  ] : [];

  function exportCsv() {
    const headers = ["Bill number", "Vendor", "Bill date", "Due date", "Category", "Amount", "Paid", "Balance due", "Status"];
    const rows = filteredRecords.map((record) => [
      record.data.billNumber || "",
      record.data.vendor || "",
      record.data.billDate || "",
      record.data.dueDate || "",
      expenseCategoryLabel(record.data),
      record.data.amount || "0",
      record.data.paidAmount || "0",
      amountDue(record).toFixed(2),
      billStatus(record, asOfDate),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "mikledger-bills.csv";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Books / Purchases</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Bills</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Track what you owe vendors and keep due dates in view.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button>
          <Button className="gap-2" onClick={() => openNewBill()}><Plus size={16} />New bill</Button>
        </div>
      </section>

      <section aria-label="Bill summary" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Total outstanding", value: outstanding, detail: `${records.filter((record) => amountDue(record) > 0 && billStatus(record, asOfDate) !== "Cancelled").length} bills to pay`, tone: "text-foreground" },
          { label: "Overdue", value: overdue, detail: `${records.filter((record) => billStatus(record, asOfDate) === "Overdue").length} past due`, tone: "text-destructive" },
          { label: "Paid total", value: paidTotal, detail: `${records.filter((record) => Number(record.data.paidAmount || 0) > 0).length} bills with payments`, tone: "text-primary" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${item.tone}`}>{formatMoney(item.value, currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </section>

      {actionMessage ? <p role="status" className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{actionMessage}</p> : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Bills and payments</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filteredRecords.length} {filteredRecords.length === 1 ? "bill" : "bills"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:w-60 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search bills or vendors" className="pl-9" aria-label="Search bills or vendors" />
            </div>
            <BulkActionsMenu
              count={selectedBills.length}
              pending={bulkPending}
              noun="bills"
              items={[{ key: "pay", label: "Record payment", icon: CircleDollarSign }, { key: "undo-payment", label: "Undo payment", icon: Undo2 }, { key: "delete", label: "Delete", icon: Trash2, destructive: true }]}
              onSelect={(action) => void runBulkAction(action)}
            />
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "all")}>
              <SelectTrigger className="w-[145px]" aria-label="Filter bills by status"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Needs payment</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value ?? "all")}>
              <SelectTrigger className="w-[155px]" aria-label="Filter bills by category"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all bills shown"
                    checked={filteredRecords.length > 0 && filteredRecords.every((record) => selectedIds.has(record.id))}
                    indeterminate={filteredRecords.some((record) => selectedIds.has(record.id)) && !filteredRecords.every((record) => selectedIds.has(record.id))}
                    onCheckedChange={(checked) => setSelectedIds(checked === true ? new Set(filteredRecords.map((record) => record.id)) : new Set())}
                  />
                </TableHead>
                {["Vendor", "Bill no.", "Bill date", "Due date", "Category", "Total", "Balance due", "Payment account", "Status", ""].map((heading) => (
                  <TableHead key={heading || "actions"} className="whitespace-nowrap text-xs font-medium text-muted-foreground">{heading || <span className="sr-only">Actions</span>}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const status = billStatus(record, asOfDate);
                const canMarkPaid = !["Paid", "Cancelled"].includes(status);
                return (
                  <TableRow key={record.id} className="group cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, [role=checkbox], [role=menu]")) setDetailId(record.id); }} data-state={selectedIds.has(record.id) ? "selected" : undefined}>
                    <TableCell className="w-10"><Checkbox aria-label={`Select ${record.data.billNumber || "bill"}`} checked={selectedIds.has(record.id)} onCheckedChange={(checked) => toggleSelected(record.id, checked === true)} /></TableCell>
                    <TableCell className="max-w-[170px] truncate text-[13px] font-medium text-primary" title={record.data.vendor || ""}>{record.data.vendor || "—"}</TableCell>
                    <TableCell className="max-w-[120px] truncate text-[13px] text-muted-foreground" title={record.data.billNumber || ""}>{record.data.billNumber || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{formatDate(record.data.billDate || "")}</TableCell>
                    <TableCell className={`whitespace-nowrap text-[13px] ${status === "Overdue" ? "font-medium text-destructive" : ""}`}>{formatDate(record.data.dueDate || "")}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-[13px] text-muted-foreground" title={expenseCategoryLabel(record.data)}>{expenseCategoryLabel(record.data) || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-[13px] tabular-nums">{formatMoney(Number(record.data.amount || 0), currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-[13px] font-medium tabular-nums">{formatMoney(amountDue(record), currency)}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-[13px] text-muted-foreground" title={record.data.paymentAccountName || ""}>{record.data.paymentAccountName ? `${record.data.paymentMethod} · ${record.data.paymentAccountName}` : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap"><StatusBadge value={status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${record.data.billNumber || "bill"}`}><MoreHorizontal size={15} /></Button>} />
                        <DropdownMenuContent align="end" className="min-w-44">
                          {canMarkPaid ? <DropdownMenuItem disabled={pendingAction || bulkPending} onClick={() => handleMarkPaid(record)}><CircleDollarSign size={14} />Record payment</DropdownMenuItem> : null}
                          <DropdownMenuItem onClick={() => openEditBill(record)}><Pencil size={14} />Edit bill</DropdownMenuItem>
                          {Number(record.data.paidAmount) > 0 ? <DropdownMenuItem disabled={bulkPending} onClick={() => void handleUndoPayment(record)}><Undo2 size={14} />Undo payment</DropdownMenuItem> : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" disabled={pendingAction} onClick={() => void handleDelete(record)}><Trash2 size={14} />Delete bill</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filteredRecords.length ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-52 whitespace-normal text-center">
                    <div className="sticky left-0 w-[calc(100vw-4.5rem)] sm:static sm:mx-auto sm:w-auto sm:max-w-sm">
                      <p className="text-sm font-medium">{records.length ? "No bills match these filters" : "No bills yet"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{records.length ? "Try a different search, status, or category." : "Add your first vendor bill to start tracking due dates and balances."}</p>
                      {!records.length ? <Button className="mt-4 gap-2" onClick={() => openNewBill()}><Plus size={15} />New bill</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <PaymentDialog
        open={Boolean(paymentTargets)}
        onOpenChange={(open) => { if (!open) setPaymentTargets(null); }}
        title="Record bill payment"
        description={paymentTargets?.length === 1
          ? `${paymentTargets[0].data.billNumber || "Bill"} · ${paymentTargets[0].data.vendor || "Supplier"} · ${formatMoney(amountDue(paymentTargets[0]), currency)} due`
          : `${paymentTargets?.length ?? 0} bills · ${formatMoney((paymentTargets ?? []).reduce((sum, record) => sum + amountDue(record), 0), currency)} due`}
        submitLabel="Record payment"
        paymentAccounts={paymentAccounts}
        pending={bulkPending}
        amountDue={paymentTargets?.length === 1 ? amountDue(paymentTargets[0]) : undefined}
        onSubmit={(date, accountId, amount) => void processBills(paymentTargets ?? [], "pay", { date, accountId, amount })}
      />
      {editorModule ? (
        <RecordDetailPanel
          module={editorModule as ModuleDefinition}
          record={detailRecord ? { ...detailRecord, data: { ...detailRecord.data, status: billStatus(detailRecord, asOfDate) } } : null}
          currency={currency}
          actions={detailActions}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {editorModule ? (
        <RecordEditor
          key={`bills-${editingRecord?.id ?? "new"}`}
          module={editorModule as ModuleDefinition}
          record={editingRecord}
          customers={[]}
          vendors={vendors}
          items={items}
          accounts={accounts}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          onSaveComplete={async (saved, intent) => { if (intent === "save-and-new") openNewBill(records.some((record) => record.id === saved.id) ? 0 : 1); }}
        />
      ) : null}
    </div>
  );
}
