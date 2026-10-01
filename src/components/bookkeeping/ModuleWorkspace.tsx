"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowDownToLine, Plus, Search } from "lucide-react";

import {
  convertBookkeepingRecord,
  deleteBookkeepingRecord,
  applyCreditNote,
  generateRecurringInvoice,
  markRecordPaid,
  recordInvoicePayment,
  sendInvoiceRecord,
  toggleTransactionMatch,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import JournalEntryEditor from "@/components/bookkeeping/JournalEntryEditor";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import RecordTable, { type RecordActionKind } from "@/components/bookkeeping/RecordTable";

interface ModuleWorkspaceProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  customers: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
}

const pageSize = 10;

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createDefaults(module: ModuleDefinition, records: BookkeepingRecord[]) {
  const values = Object.fromEntries(module.fields.map((field) => [field.key, field.type === "checkbox" ? "false" : ""]));
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(today.getDate() + 30);
  const settings = records.find((record) => record.kind === "settings")?.data;
  const sequence = Math.max(1, Number(settings?.nextInvoiceNumber) || records.filter((record) => record.kind === "invoices").length + 1);
  const prefix = settings?.invoicePrefix || "INV-";

  if (module.kind === "invoices") {
    values.invoiceNumber = `${prefix}${String(sequence).padStart(4, "0")}`;
    values.issueDate = dateString(today);
    values.dueDate = dateString(dueDate);
    values.currency = settings?.currency || "USD";
    values.exchangeRate = "1";
    values.paidAmount = "0";
    values.status = "Draft";
  }
  if (module.kind === "estimates") {
    values.estimateNumber = `EST-${String(records.filter((record) => record.kind === "estimates").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.status = "Draft";
  }
  if (module.kind === "sales-orders") {
    values.orderNumber = `SO-${String(records.filter((record) => record.kind === "sales-orders").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.status = "Draft";
  }
  if (module.kind === "purchase-orders") {
    values.poNumber = `PO-${String(records.filter((record) => record.kind === "purchase-orders").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.status = "Draft";
  }
  if (module.kind === "credit-notes") {
    values.creditNumber = `CN-${String(records.filter((record) => record.kind === "credit-notes").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.status = "Draft";
  }
  if (module.kind === "bills") {
    values.billNumber = `BILL-${String(records.filter((record) => record.kind === "bills").length + 1).padStart(4, "0")}`;
    values.billDate = dateString(today);
    values.paidAmount = "0";
    values.status = "Open";
  }
  if (module.kind === "expenses" || module.kind === "transactions" || module.kind === "journals") values.date = dateString(today);
  if (module.kind === "journals") {
    values.reference = `JRN-${String(records.filter((record) => record.kind === "journals").length + 1).padStart(4, "0")}`;
  }
  if (module.kind === "expenses") values.expenseDate = dateString(today);
  if (module.kind === "transactions") {
    values.matched = "false";
    values.type = "Deposit";
  }
  if (module.kind === "bank-rules" || module.kind === "taxes" || module.kind === "team-members") values.enabled = "true";
  if (module.kind === "team-members") values.canApprove = "false";
  if (module.kind === "bank-accounts") values.currency = settings?.currency || "USD";
  if (module.kind === "settings") {
    values.companyName = settings?.companyName || "";
    values.currency = settings?.currency || "USD";
    values.fiscalYear = settings?.fiscalYear || "January";
    values.invoicePrefix = settings?.invoicePrefix || "INV-";
    values.nextInvoiceNumber = settings?.nextInvoiceNumber || "1";
    values.emailTemplate = settings?.emailTemplate || "Hello {{customer}}, your invoice {{invoice}} for {{amount}} is ready. — {{company}}";
  }
  return values;
}

function toCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

export default function ModuleWorkspace({ module, records: initialRecords, customers, vendors, accounts }: ModuleWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BookkeepingRecord | null>(null);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [paymentRecord, setPaymentRecord] = useState<BookkeepingRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank transfer");
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  const filterKey = ["status", "category", "type", "role", "accountType", "enabled"].find((key) => records.some((record) => record.data[key]));
  const filterOptions = filterKey
    ? [...new Set(records.map((record) => record.data[filterKey]).filter((value): value is string => Boolean(value)))].sort()
    : [];

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesSearch = !normalizedSearch || Object.values(record.data).some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesFilter = filter === "all" || !filterKey || record.data[filterKey] === filter;
      return matchesSearch && matchesFilter;
    });
  }, [filter, filterKey, records, search]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((page - 1) * pageSize, page * pageSize);
  const canExport = module.kind !== "settings";
  const currency = records.find((record) => record.data.currency)?.data.currency || "USD";

  useEffect(() => setPage(1), [search, filter]);

  function openNewRecord() {
    const existingSettings = module.kind === "settings" ? records[0] : undefined;
    if (existingSettings) {
      openEditRecord(existingSettings);
      return;
    }
    setEditingRecord(null);
    setDefaults(createDefaults(module, records));
    setActionMessage("");
    setEditorOpen(true);
  }

  function openEditRecord(record: BookkeepingRecord) {
    setEditingRecord(record);
    setDefaults({});
    setActionMessage("");
    setEditorOpen(true);
  }

  function handleSaved(record: BookkeepingRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    router.refresh();
  }

  async function handleDelete(record: BookkeepingRecord) {
    const title = record.data[module.titleKey] || module.label.toLowerCase();
    if (!window.confirm(`Delete “${title}”? This can’t be undone.`)) return;
    setActionMessage("");
    try {
      await deleteBookkeepingRecord(module.kind, record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setActionMessage(`${module.label} deleted.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "We couldn’t delete that record.");
    }
  }

  async function handleAction(kind: RecordActionKind, record: BookkeepingRecord) {
    setActionMessage("");
    if (kind === "payment") {
      const remaining = Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));
      setPaymentRecord(record);
      setPaymentAmount(remaining.toFixed(2));
      setPaymentDate(dateString(new Date()));
      setPaymentError("");
      return;
    }

    setPendingAction(true);
    try {
      if (kind === "convert") {
        await convertBookkeepingRecord(record.id);
        setActionMessage(`Converted to ${module.kind === "purchase-orders" ? "a bill" : "an invoice"}.`);
      } else if (kind === "send") {
        await sendInvoiceRecord(record.id);
        setActionMessage("Invoice emailed to the customer and marked as sent.");
      } else if (kind === "apply-credit") {
        await applyCreditNote(record.id);
        setActionMessage("Credit applied to the matching invoice balance.");
      } else if (kind === "generate") {
        await generateRecurringInvoice(record.id);
        setActionMessage("Invoice created and the next billing date advanced.");
      } else if (kind === "mark-paid") {
        if (!window.confirm("Mark this bill as paid in full?")) return;
        await markRecordPaid(module.kind, record.id);
        setActionMessage("Bill marked as paid.");
      } else if (kind === "match") {
        await toggleTransactionMatch(record.id);
        setActionMessage(record.data.matched === "true" ? "Transaction marked as unmatched." : "Transaction matched.");
      }
      router.refresh();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "That action couldn’t be completed.");
    } finally {
      setPendingAction(false);
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentRecord) return;
    setPendingAction(true);
    setPaymentError("");
    try {
      await recordInvoicePayment(paymentRecord.id, paymentAmount, paymentDate, paymentMethod);
      setPaymentRecord(null);
      setActionMessage("Payment recorded and invoice balance updated.");
      router.refresh();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "We couldn’t record the payment.");
    } finally {
      setPendingAction(false);
    }
  }

  function exportCsv() {
    const rows = [module.columns, ...filteredRecords.map((record) => module.columns.map((key) => record.data[key] ?? ""))];
    const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${module.slug}.csv`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Books / {module.plural}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">{module.plural}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{module.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canExport ? <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button> : null}
          <Button className="gap-2" onClick={openNewRecord}><Plus size={16} />{module.kind === "settings" ? "Edit company profile" : `New ${module.label.toLowerCase()}`}</Button>
        </div>
      </section>

      {module.kind === "invoices" || module.kind === "bills" ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { label: module.kind === "invoices" ? "Open balance" : "Outstanding", value: records.filter((record) => !["Paid", "Cancelled"].includes(record.data.status ?? "")).reduce((sum, record) => sum + Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0)), 0) },
              { label: "Paid", value: records.filter((record) => record.data.status === "Paid").reduce((sum, record) => sum + Number(record.data.paidAmount || record.data.amount || 0), 0) },
            { label: "Documents", value: records.length, count: true },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{item.count ? item.value : formatCurrency(item.value, currency)}</p>
            </div>
          ))}
        </div>
      ) : null}

      {actionMessage ? <p role="status" className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{actionMessage}</p> : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">All {module.plural.toLowerCase()}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filteredRecords.length} {filteredRecords.length === 1 ? "record" : "records"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${module.plural.toLowerCase()}`} className="pl-9" aria-label={`Search ${module.plural}`} />
            </div>
            {filterKey && filterOptions.length ? (
              <Select value={filter} onValueChange={(value) => setFilter(value ?? "all")}>
                <SelectTrigger className="w-[150px]" aria-label="Filter records"><SelectValue placeholder="All records" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All records</SelectItem>
                  {filterOptions.map((option) => <SelectItem key={option} value={option}>{option === "true" ? "Enabled" : option === "false" ? "Disabled" : option}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <RecordTable
          module={module}
          records={visibleRecords}
          onEdit={openEditRecord}
          onDelete={(record) => void handleDelete(record)}
          onAction={(kind, record) => void handleAction(kind, record)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Showing {filteredRecords.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
          </div>
        </div>
      </section>

      {module.kind === "journals" ? (
        <JournalEntryEditor
          key={`journals-${editingRecord?.id ?? "new"}`}
          accounts={accounts}
          record={editingRecord}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
        />
      ) : (
        <RecordEditor
          key={`${module.kind}-${editingRecord?.id ?? "new"}`}
          module={module}
          record={editingRecord}
          customers={customers}
          vendors={vendors}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
        />
      )}

      <Dialog open={Boolean(paymentRecord)} onOpenChange={(open) => { if (!open) setPaymentRecord(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record invoice payment</DialogTitle>
            <DialogDescription>{paymentRecord?.data.invoiceNumber} · {paymentRecord?.data.customer}</DialogDescription>
          </DialogHeader>
          <form id="invoice-payment-form" onSubmit={submitPayment} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="payment-amount">Amount received</Label><Input id="payment-amount" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="payment-date">Payment date</Label><Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></div>
            <div className="space-y-2">
              <Label htmlFor="payment-method">Payment method</Label>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "Bank transfer")}>
                <SelectTrigger id="payment-method" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{["Bank transfer", "Cash", "Card", "Cheque", "Other"].map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {paymentError ? <p role="alert" className="text-sm text-destructive">{paymentError}</p> : null}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentRecord(null)}>Cancel</Button>
            <Button type="submit" form="invoice-payment-form" disabled={pendingAction}>{pendingAction ? "Recording…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {module.kind === "settings" && records[0]?.data.logo ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <Image unoptimized width={40} height={40} src={records[0].data.logo} alt={`${records[0].data.companyName || "Company"} logo`} className="size-10 rounded-md border border-border object-contain" />
          <div className="min-w-0"><p className="text-sm font-medium">Company logo</p><p className="truncate text-xs text-muted-foreground">{records[0].data.logoName || "Uploaded image"}</p></div>
        </div>
      ) : null}
    </div>
  );
}
