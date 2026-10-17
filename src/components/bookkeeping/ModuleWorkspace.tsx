"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { ArrowDownToLine, ArrowRightLeft, BadgeCheck, ChevronDown, CircleDollarSign, ClipboardList, FileCheck2, FileText, FolderOpen, ListChecks, Plus, Printer, Search, Share, SlidersHorizontal, Trash2, Undo2, WalletCards } from "lucide-react";
import { readableError } from "@/lib/action-error";

import {
  advancePurchaseOrder,
  convertBookkeepingRecord,
  convertPurchaseOrderToExpense,
  createCustomerDocumentShareLink,
  createInvoiceShareLink,
  deleteBookkeepingRecord,
  duplicateCustomerDocumentRecord,
  duplicateInvoiceRecord,
  applyCreditNote,
  applySupplierCredit,
  undoInvoicePayments,
  voidBookkeepingRecord,
  refundSupplierCredit,
  generateRecurringInvoice,
  recordInvoicePayment,
  sendCustomerDocumentRecord,
  sendInvoiceRecord,
  toggleTransactionMatch,
} from "@/app/actions";
import { createInvoiceFromCharges, createInvoiceFromTime, refundCustomerCredit, sendCustomerStatement, sendInvoiceReminder } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { navigationGroups, type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";
import { currencyAmount, dueDateForTerms } from "@/lib/invoice-utils";
import { paymentAccountLabel, paymentAccountType, receivingAccountType } from "@/lib/payment-accounts";
import { budgetActualRecords, recordsWithinBudgetDates, type BudgetLine } from "@/lib/budget-utils";
import JournalEntryEditor from "@/components/bookkeeping/JournalEntryEditor";
import ItemsBulkImport from "@/components/bookkeeping/ItemsBulkImport";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import PaymentDialog from "@/components/bookkeeping/PaymentDialog";
import { useNewRecordParam, useOpenRecordParam } from "@/hooks/use-new-record-param";
import RecordTable, { recordActions, type RecordActionKind } from "@/components/bookkeeping/RecordTable";
import RecordDetailPanel from "@/components/bookkeeping/RecordDetailPanel";

interface ModuleWorkspaceProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  customers: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  /** Names of employees on payroll, offered as journal line names. */
  employeeNames?: string[];
  accounts: BookkeepingRecord[];
  items: BookkeepingRecord[];
  defaultCurrency: string;
  sourceFilter?: { startDate: string; endDate: string; budgetHead: string };
  /** A customer's or supplier's documents and payments, for their page. */
  related?: BookkeepingRecord[];
}

const DEFAULT_PAGE_SIZE = 10;
interface ListColumnOption {
  key: string;
  label: string;
}

/** A list whose columns and page size each viewer can choose; the choice is kept in this browser. */
interface ListCustomization {
  storageKey: string;
  options: readonly ListColumnOption[];
  defaultColumns: readonly string[];
  requiredColumn: string;
  pageSizes: readonly number[];
  defaultPageSize: number;
}

interface ListPreferences {
  columns: string[];
  pageSize: number;
}

const LIST_CUSTOMIZATIONS: Partial<Record<string, ListCustomization>> = {
  customers: {
    storageKey: "mikledger:customer-list-preferences:v1",
    options: [
      { key: "name", label: "Name" },
      { key: "company", label: "Company" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
      { key: "openingBalance", label: "Opening balance" },
    ],
    defaultColumns: ["name", "company", "email", "phone", "openingBalance"],
    requiredColumn: "name",
    pageSizes: [50, 75, 100, 150, 300],
    defaultPageSize: 50,
  },
  journals: {
    storageKey: "mikledger:journal-list-preferences:v1",
    options: [
      { key: "date", label: "Date" },
      { key: "entryType", label: "Type" },
      { key: "reference", label: "Ref no." },
      { key: "contact", label: "Contact" },
      { key: "dueDate", label: "Due date" },
      { key: "balance", label: "Balance" },
      { key: "amount", label: "Amount" },
      { key: "memo", label: "Memo/Description" },
      { key: "debitAccount", label: "Debit account" },
      { key: "creditAccount", label: "Credit account" },
      { key: "lastModified", label: "Last modified date" },
      { key: "status", label: "Status" },
    ],
    defaultColumns: ["date", "entryType", "reference", "contact", "dueDate", "balance", "amount", "memo", "lastModified", "status"],
    requiredColumn: "reference",
    pageSizes: [10, 25, 50, 100],
    defaultPageSize: 25,
  },
};

function readListPreferences(customization: ListCustomization): ListPreferences | null {
  try {
    const stored = window.localStorage.getItem(customization.storageKey);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const preferences = parsed as Record<string, unknown>;
    const columns = Array.isArray(preferences.columns)
      ? customization.options.map((option) => option.key).filter((key) => (preferences.columns as unknown[]).includes(key))
      : [...customization.defaultColumns];
    if (!columns.includes(customization.requiredColumn)) columns.unshift(customization.requiredColumn);
    const pageSize = customization.pageSizes.find((size) => size === preferences.pageSize) ?? customization.defaultPageSize;
    return { columns, pageSize };
  } catch {
    return null;
  }
}

/** Journals store their lines as JSON; the list shows a few values worked out from them. */
function withJournalListFields(record: BookkeepingRecord): BookkeepingRecord {
  let names: string[] = [];
  try {
    const lines: unknown = JSON.parse(record.data.lines || "[]");
    if (Array.isArray(lines)) names = lines.map((line) => (typeof line?.name === "string" ? line.name.trim() : "")).filter(Boolean);
  } catch {
    names = [];
  }
  return {
    ...record,
    data: {
      ...record.data,
      entryType: "Journal",
      contact: [...new Set(names)].join(", "),
      balance: "0",
      lastModified: record.updatedAt ? record.updatedAt.replace("T", " ").slice(0, 16) : "",
      status: record.data.status || "Posted",
    },
  };
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createDefaults(module: ModuleDefinition, records: BookkeepingRecord[], defaultCurrency: string) {
  const values = Object.fromEntries(module.fields.map((field) => [field.key, field.type === "checkbox" ? "false" : ""]));
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(today.getDate() + 30);
  const settings = records.find((record) => record.kind === "settings")?.data;
  const sequence = Math.max(1, Number(settings?.nextInvoiceNumber) || records.filter((record) => record.kind === "invoices").length + 1);
  const prefix = settings?.invoicePrefix || "INV-";

  if (module.kind === "items") values.itemType = "Inventory";
  if (module.kind === "invoices") {
    values.invoiceNumber = `${prefix}${String(sequence).padStart(4, "0")}`;
    values.issueDate = dateString(today);
    values.paymentTerms = settings?.invoiceTerms || "30 days";
    values.dueDate = dueDateForTerms(values.issueDate, values.paymentTerms) || dateString(dueDate);
    values.currency = defaultCurrency;
    values.exchangeRate = "1";
    values.paidAmount = "0";
    values.paymentMethod = "Credit";
    values.status = "Draft";
  }
  if (module.kind === "estimates") {
    values.estimateNumber = `EST-${String(records.filter((record) => record.kind === "estimates").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.currency = defaultCurrency;
    values.exchangeRate = "1";
    values.status = "Draft";
  }
  if (module.kind === "sales-orders") {
    values.orderNumber = `SO-${String(records.filter((record) => record.kind === "sales-orders").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.currency = defaultCurrency;
    values.exchangeRate = "1";
    values.status = "Draft";
  }
  if (module.kind === "purchase-orders") {
    values.poNumber = `PO-${String(records.filter((record) => record.kind === "purchase-orders").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.currency = defaultCurrency;
    values.status = "Draft";
  }
  if (module.kind === "credit-notes") {
    values.creditNumber = `CN-${String(records.filter((record) => record.kind === "credit-notes").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.currency = defaultCurrency;
    values.exchangeRate = "1";
    values.status = "Draft";
  }
  if (module.kind === "supplier-credits") {
    values.creditNumber = `SC-${String(records.filter((record) => record.kind === "supplier-credits").length + 1).padStart(4, "0")}`;
    values.date = dateString(today);
    values.status = "Open";
  }
  if (module.kind === "bills") {
    values.billNumber = `BILL-${String(records.filter((record) => record.kind === "bills").length + 1).padStart(4, "0")}`;
    values.billDate = dateString(today);
    values.paidAmount = "0";
    values.paymentMethod = "Credit";
    values.status = "Open";
  }
  if (module.kind === "expenses" || module.kind === "transactions" || module.kind === "journals") values.date = dateString(today);
  if (module.kind === "delayed-charges") Object.assign(values, { date: dateString(today), chargeType: "Charge", quantity: "1", status: "Open" });
  if (module.kind === "employees") {
    values.employeeId = `EMP-${String(records.filter((record) => record.kind === "employees").length + 1).padStart(3, "0")}`;
    values.status = "Active";
    values.currency = defaultCurrency;
  }
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

/** QuickBooks' customer and supplier centre: balances and every transaction with them. */
function partyCentre(kind: "customers" | "vendors", party: BookkeepingRecord, related: BookkeepingRecord[], currency: string) {
  const name = (party.data.name ?? "").trim().toLowerCase();
  const isTheirs = (data: Record<string, string>) => {
    const value = (kind === "customers" ? data.customer : data.vendor || data.payee) ?? "";
    return data.customerId === party.id || data.vendorId === party.id || data.openingBalanceFor === party.id || (Boolean(name) && value.trim().toLowerCase() === name);
  };
  const today = new Date().toISOString().slice(0, 10);
  const docs = related.filter((record) => record.kind !== "payments" && isTheirs(record.data));
  const docIds = new Set(docs.map((doc) => doc.id));
  const payments = related.filter((record) => record.kind === "payments" && docIds.has(record.data.invoiceId || record.data.billId || record.data.expenseId || ""));
  const balance = (data: Record<string, string>) => Math.max(0, Number(data.amount || 0) - Number(data.paidAmount || 0) - Number(data.creditApplied || 0));
  const openDocs = docs.filter((doc) => (doc.kind === "invoices" || doc.kind === "bills") && !["Draft", "Void", "Cancelled", "Paid", "Pending approval"].includes(doc.data.status ?? ""));
  const open = openDocs.reduce((sum, doc) => sum + balance(doc.data), 0);
  const overdue = openDocs.filter((doc) => doc.data.dueDate && doc.data.dueDate < today).reduce((sum, doc) => sum + balance(doc.data), 0);
  const typeOf = (record: BookkeepingRecord) => ({ invoices: record.data.docType || "Invoice", "credit-notes": "Credit note", estimates: "Estimate", bills: "Bill", expenses: record.data.docType || "Expense", "supplier-credits": "Supplier credit", payments: kind === "customers" ? "Payment" : "Bill payment" } as Record<string, string>)[record.kind] ?? record.kind;
  const dateOf = (data: Record<string, string>) => data.issueDate || data.billDate || data.expenseDate || data.paymentDate || data.date || "";
  const numberOf = (data: Record<string, string>) => data.invoiceNumber || data.billNumber || data.creditNumber || data.estimateNumber || data.referenceNumber || "";
  const rows = [...docs, ...payments].sort((a, b) => dateOf(b.data).localeCompare(dateOf(a.data))).slice(0, 50);
  const money = (value: number) => currencyAmount(value, currency);
  const page = (record: BookkeepingRecord) => (record.kind === "payments" ? (kind === "customers" ? `/app/invoices?open=${record.data.invoiceId}` : `/app/bills?open=${record.data.billId || record.data.expenseId}`) : `/app/${record.kind}?open=${record.id}`);
  return {
    stats: [["Open balance", money(open)], ["Overdue", money(overdue)], ["Transactions", String(docs.length + payments.length)]] as Array<[string, string]>,
    children: (
      <section className="rounded-lg border border-border">
        <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Transactions</h3>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">No.</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 text-right font-medium">Open</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 tabular-nums">{dateOf(record.data)}</td>
                    <td className="px-4 py-2"><a href={page(record)} className="text-primary hover:underline">{typeOf(record)}</a></td>
                    <td className="px-4 py-2">{numberOf(record.data)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(Number(record.data.amount || 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{record.kind === "invoices" || record.kind === "bills" ? money(balance(record.data)) : "—"}</td>
                    <td className="px-4 py-2">{record.kind === "payments" ? "Received" : record.data.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 py-5 text-sm text-muted-foreground">No transactions yet.</p>}
      </section>
    ),
  };
}

export default function ModuleWorkspace({ module, records: initialRecords, customers, vendors, employeeNames = [], accounts, items, defaultCurrency, sourceFilter, related = [] }: ModuleWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [storedListPreferences, setStoredListPreferences] = useState<ListPreferences | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BookkeepingRecord | null>(null);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [paymentRecord, setPaymentRecord] = useState<BookkeepingRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentRate, setPaymentRate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [expenseConversionRecord, setExpenseConversionRecord] = useState<BookkeepingRecord | null>(null);
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [expensePaymentAccountId, setExpensePaymentAccountId] = useState("");
  const [expenseConversionError, setExpenseConversionError] = useState("");
  // Money received from customers can also go to Undeposited funds, banked later with a bank deposit.
  const paymentAccounts = accounts.filter((account) => (module.kind === "invoices" ? receivingAccountType(account) : paymentAccountType(account)));
  const expenseAccounts = accounts.filter((account) => account.kind === "accounts" && account.data.type === "Expense" && account.data.locked !== "true");
  const customization = LIST_CUSTOMIZATIONS[module.kind];
  const listPreferences = customization ? storedListPreferences ?? { columns: [...customization.defaultColumns], pageSize: customization.defaultPageSize } : null;
  const pageSize = listPreferences?.pageSize ?? DEFAULT_PAGE_SIZE;

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  useEffect(() => {
    const current = LIST_CUSTOMIZATIONS[module.kind];
    setStoredListPreferences(current ? readListPreferences(current) : null);
  }, [module.kind]);

  const filterKey = ["status", "category", "type", "role", "accountType", "enabled"].find((key) => records.some((record) => record.data[key]));
  const filterOptions = filterKey
    ? [...new Set(records.map((record) => record.data[filterKey]).filter((value): value is string => Boolean(value)))].sort()
    : [];

  const listRecords = useMemo(() => (module.kind === "journals" ? records.map(withJournalListFields) : records), [module.kind, records]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const budgetLine: BudgetLine | null = sourceFilter ? {
      category: module.kind === "invoices" ? "Sales" : "Expenses",
      budgetHead: sourceFilter.budgetHead,
      type: module.kind === "invoices" ? "Income" : "Expense",
      expected: "0",
      description: "",
    } : null;
    return listRecords.filter((record) => {
      const matchesSearch = !normalizedSearch || Object.values(record.data).some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesFilter = filter === "all" || !filterKey || record.data[filterKey] === filter;
      const matchesDateRange = !sourceFilter || recordsWithinBudgetDates([record], sourceFilter.startDate, sourceFilter.endDate).length > 0;
      const matchesBudgetHead = !budgetLine || budgetActualRecords(budgetLine, [record]).length > 0;
      return matchesSearch && matchesFilter && matchesDateRange && matchesBudgetHead;
    });
  }, [filter, filterKey, listRecords, module.kind, search, sourceFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((page - 1) * pageSize, page * pageSize);
  const tableRecords = ["invoices", "estimates", "sales-orders", "credit-notes"].includes(module.kind)
    ? visibleRecords.map((record) => {
        const customer = customers.find((item) => item.id === record.data.customerId || item.id === record.data.customer)
          ?? customers.find((item) => item.data.name?.trim().toLowerCase() === record.data.customer?.trim().toLowerCase());
        return customer?.data.name ? { ...record, data: { ...record.data, customer: customer.data.name } } : record;
      })
    : visibleRecords;
  const visibleColumns = listPreferences?.columns ?? module.columns;
  const listColumnLabels = customization ? Object.fromEntries(customization.options.map((option) => [option.key, option.label])) : undefined;
  const canExport = module.kind !== "settings";
  const currency = records.find((record) => record.data.currency)?.data.currency || defaultCurrency || "USD";
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRecord = detailId ? records.find((record) => record.id === detailId) ?? null : null;
  const groupLabel = navigationGroups.find((group) => group.items.some((item) => item.slug === module.slug))?.label ?? "Books";
  const summaryCards = useMemo(() => {
    const money = (value: number) => formatCurrency(value, currency);
    const total = (list: BookkeepingRecord[]) => list.reduce((sum, record) => sum + Number(record.data.amount || 0), 0);
    const balanceOf = (record: BookkeepingRecord) => Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));
    const thisMonth = new Date().toISOString().slice(0, 7);
    const withStatus = (...statuses: string[]) => records.filter((record) => statuses.includes(record.data.status ?? ""));
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    type Card = { label: string; value: string; note?: string; tone?: "bad" };
    if (module.kind === "invoices" || module.kind === "bills") {
      const open = records.filter((record) => !["Paid", "Cancelled", "Draft"].includes(record.data.status ?? "") && balanceOf(record) > 0);
      const overdue = records.filter((record) => record.data.status === "Overdue" || (record.data.dueDate && record.data.dueDate < new Date().toISOString().slice(0, 10) && open.includes(record)));
      const paidThisMonth = records.filter((record) => record.data.status === "Paid" && (record.data.paidDate || record.data.issueDate || record.data.billDate || "").startsWith(thisMonth));
      return [
        { label: module.kind === "invoices" ? "Open balance" : "Outstanding", value: money(open.reduce((sum, record) => sum + balanceOf(record), 0)), note: count(open.length, "unpaid", "unpaid") },
        { label: "Overdue", value: money(overdue.reduce((sum, record) => sum + balanceOf(record), 0)), note: count(overdue.length, module.label.toLowerCase(), module.plural.toLowerCase()), tone: overdue.length ? "bad" : undefined },
        { label: "Paid this month", value: money(paidThisMonth.reduce((sum, record) => sum + Number(record.data.paidAmount || record.data.amount || 0), 0)), note: count(paidThisMonth.length, module.label.toLowerCase(), module.plural.toLowerCase()) },
        { label: "Drafts", value: String(withStatus("Draft").length), note: "Not sent yet" },
      ] satisfies Card[];
    }
    if (module.kind === "estimates") {
      const open = withStatus("Draft", "Sent");
      return [
        { label: "Open quotes", value: money(total(open)), note: count(open.length, "estimate", "estimates") },
        { label: "Accepted", value: money(total(withStatus("Accepted"))), note: count(withStatus("Accepted").length, "estimate", "estimates") },
        { label: "Converted", value: String(withStatus("Converted").length), note: "Turned into invoices or orders" },
        { label: "Declined", value: String(withStatus("Declined").length), tone: withStatus("Declined").length ? "bad" : undefined },
      ] satisfies Card[];
    }
    if (module.kind === "sales-orders" || module.kind === "purchase-orders") {
      const open = records.filter((record) => !["Fulfilled", "Converted", "Cancelled", "Received", "Billed"].includes(record.data.status ?? "") && !record.data.convertedKind);
      return [
        { label: "Open orders", value: money(total(open)), note: count(open.length, "order", "orders") },
        { label: "This month", value: money(total(records.filter((record) => (record.data.date ?? "").startsWith(thisMonth)))) },
        { label: module.kind === "sales-orders" ? "Converted" : "Billed", value: String(records.filter((record) => record.data.status === "Converted" || record.data.convertedKind).length) },
        { label: "All orders", value: String(records.length) },
      ] satisfies Card[];
    }
    if (module.kind === "credit-notes" || module.kind === "supplier-credits") {
      const open = records.filter((record) => !["Applied", "Refunded"].includes(record.data.status ?? ""));
      return [
        { label: "Not yet applied", value: money(total(open)), note: count(open.length, "credit note", "credit notes") },
        { label: "Applied", value: money(total(withStatus("Applied"))) },
        { label: "Refunded", value: money(total(withStatus("Refunded"))) },
        { label: "All credit notes", value: String(records.length) },
      ] satisfies Card[];
    }
    if (module.kind === "customers") {
      const withEmail = records.filter((record) => record.data.email).length;
      return [
        { label: "Customers", value: String(records.length) },
        { label: "Businesses", value: String(records.filter((record) => record.data.customerType === "Business").length) },
        { label: "With email", value: String(withEmail), note: "Can be emailed invoices" },
        { label: "Opening balances", value: money(records.reduce((sum, record) => sum + Number(record.data.openingBalance || 0), 0)) },
      ] satisfies Card[];
    }
    if (module.kind === "recurring-invoices") {
      const active = withStatus("Active");
      return [
        { label: "Active schedules", value: String(active.length) },
        { label: "Billed each cycle", value: money(total(active)) },
        { label: "Due now", value: String(active.filter((record) => record.data.nextDate && record.data.nextDate <= new Date().toISOString().slice(0, 10)).length) },
        { label: "Paused", value: String(withStatus("Paused").length) },
      ] satisfies Card[];
    }
    if (module.kind === "transactions") {
      const deposits = records.filter((record) => record.data.type === "Deposit");
      const withdrawals = records.filter((record) => record.data.type === "Withdrawal");
      return [
        { label: "Money in", value: money(total(deposits)), note: count(deposits.length, "deposit", "deposits") },
        { label: "Money out", value: money(total(withdrawals)), note: count(withdrawals.length, "withdrawal", "withdrawals") },
        { label: "To match", value: String(records.filter((record) => record.data.matched !== "true").length), tone: records.some((record) => record.data.matched !== "true") ? "bad" : undefined },
        { label: "Matched", value: String(records.filter((record) => record.data.matched === "true").length) },
      ] satisfies Card[];
    }
    return [] as Card[];
  }, [module.kind, module.label, module.plural, records, currency]);

  useEffect(() => setPage(1), [search, filter]);

  function saveListPreferences(next: ListPreferences) {
    if (!customization) return;
    setStoredListPreferences(next);
    setPage(1);
    try {
      window.localStorage.setItem(customization.storageKey, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage; the choice still applies until the page reloads.
    }
  }

  function updateListColumn(column: string, visible: boolean) {
    if (!customization || !listPreferences || (column === customization.requiredColumn && !visible)) return;
    const chosen = new Set(listPreferences.columns);
    if (visible) chosen.add(column);
    else chosen.delete(column);
    saveListPreferences({ ...listPreferences, columns: customization.options.map((option) => option.key).filter((key) => chosen.has(key)) });
  }

  function openNewRecord() {
    const existingSettings = module.kind === "settings" ? records[0] : undefined;
    if (existingSettings) {
      openEditRecord(existingSettings);
      return;
    }
    setEditingRecord(null);
    setDefaults(createDefaults(module, records, defaultCurrency));
    setActionMessage("");
    setEditorOpen(true);
  }

  useNewRecordParam(openNewRecord);
  useOpenRecordParam((id) => {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    if (module.kind === "journals" || module.kind === "settings") openEditRecord(record);
    else setDetailId(id);
  });

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

  async function handleInvoiceSaveComplete(record: BookkeepingRecord, intent: "save-and-new" | "save-and-copy") {
    if (intent === "save-and-new") {
      const nextRecords = [record, ...records.filter((item) => item.id !== record.id)];
      setEditingRecord(null);
      setDefaults(createDefaults(module, nextRecords, defaultCurrency));
      setActionMessage("");
      setEditorOpen(true);
      return;
    }

    const copy = module.kind === "invoices"
      ? await duplicateInvoiceRecord(record.id)
      : await duplicateCustomerDocumentRecord(record.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
    handleSaved(copy);
    setEditingRecord(copy);
    setDefaults({});
    setActionMessage(`${module.label} copied as a draft with a new number.`);
    setEditorOpen(true);
  }

  async function handleDelete(record: BookkeepingRecord) {
    const title = record.data[module.titleKey] || module.label.toLowerCase();
    if (!window.confirm(`Delete “${title}”? This can’t be undone.`)) return false;
    setActionMessage("");
    try {
      await deleteBookkeepingRecord(module.kind, record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setActionMessage(`${module.label} deleted.`);
      return true;
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "We couldn’t delete that record.");
      return false;
    }
  }

  // Actions on several checked records at once, offered from the toolbar menu.
  type BulkAction = "estimates" | "sales-orders" | "invoices" | "expense" | "pay" | "undo-payment" | "apply-credit" | "refund" | "open" | "delete" | "invoice-time";
  const bulkMenu: { label: string; items: { action: BulkAction; label: string }[] } | null = module.kind === "sales-orders"
    ? { label: "Convert", items: [{ action: "estimates", label: "Convert to estimate" }, { action: "invoices", label: "Convert to invoice" }] }
    : module.kind === "estimates"
      ? { label: "Convert", items: [{ action: "sales-orders", label: "Convert to sales order" }, { action: "invoices", label: "Convert to invoice" }] }
      : module.kind === "purchase-orders"
      ? { label: "Convert", items: [{ action: "expense", label: "Convert to expense" }] }
      : module.kind === "invoices"
        ? { label: "Actions", items: [{ action: "pay", label: "Record payment" }, { action: "undo-payment", label: "Undo payment" }] }
        : module.kind === "credit-notes"
          ? { label: "Actions", items: [{ action: "apply-credit", label: "Apply credit" }, { action: "refund", label: "Refund to customer" }] }
          : module.kind === "time-activities" || module.kind === "delayed-charges"
            ? { label: "Actions", items: [{ action: "invoice-time", label: "Create invoice" }] }
          : module.kind === "supplier-credits"
            ? { label: "Actions", items: [{ action: "refund", label: "Record refund" }] }
            : module.kind === "journals"
              ? { label: "Actions", items: [{ action: "open", label: "Open" }] }
              : null;
  const supportsBulkActions = Boolean(bulkMenu);
  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
  const [bulkExpenseIds, setBulkExpenseIds] = useState<string[]>([]);
  const [refundTargets, setRefundTargets] = useState<BookkeepingRecord[] | null>(null);

  async function processRefunds(date: string, accountId: string) {
    const targets = refundTargets ?? [];
    setBulkPending(true);
    const failed: string[] = [];
    let done = 0;
    for (const record of targets) {
      try {
        if (module.kind === "credit-notes") await refundCustomerCredit(record.id, date, accountId);
        else await refundSupplierCredit(record.id, date, accountId);
        done += 1;
      } catch (error) {
        failed.push(error instanceof Error ? readableError(error) : `${record.data.creditNumber || "Credit note"} couldn’t be refunded.`);
      }
    }
    setBulkPending(false);
    setRefundTargets(null);
    setSelectedIds(new Set());
    if (done) toast.success(`${done} ${done === 1 ? "credit note" : "credit notes"} recorded as refunded.`);
    if (failed.length) toast.error(failed.join(" "));
    router.refresh();
  }
  const [bulkPaymentDate, setBulkPaymentDate] = useState("");
  const [bulkPaymentAccount, setBulkPaymentAccount] = useState("");
  const selectedRecords = records.filter((record) => selectedIds.has(record.id));

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const remainingBalance = (record: BookkeepingRecord) =>
    Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));

  function openBulkPayment() {
    setBulkPaymentDate(dateString(new Date()));
    setBulkPaymentAccount(paymentAccounts[0]?.id ?? "");
    setBulkPaymentOpen(true);
  }

  async function runBulkAction(action: BulkAction) {
    if (!selectedRecords.length) return;
    if (action === "open") {
      if (selectedRecords.length > 1) toast.info(`Opening ${selectedRecords[0].data[module.titleKey] || module.label.toLowerCase()}, the first one selected.`);
      openEditRecord(selectedRecords[0]);
      return;
    }
    if (action === "pay" && !bulkPaymentOpen) {
      openBulkPayment();
      return;
    }
    if (action === "invoice-time") {
      setBulkPending(true);
      try {
        const charges = module.kind === "delayed-charges";
        const created = await (charges ? createInvoiceFromCharges : createInvoiceFromTime)(selectedRecords.map((record) => record.id));
        toast.success(`Draft invoice ${created.number} created from ${selectedRecords.length} ${charges ? (selectedRecords.length === 1 ? "charge" : "charges") : `time ${selectedRecords.length === 1 ? "entry" : "entries"}`}.`);
        setSelectedIds(new Set());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? readableError(error) : "That invoice couldn’t be created.");
      } finally {
        setBulkPending(false);
      }
      return;
    }
    if (action === "refund") {
      const refundable = selectedRecords.filter((record) => !["Applied", "Refunded"].includes(record.data.status ?? ""));
      if (!refundable.length) toast.info("The selected credit notes are already applied or refunded.");
      else setRefundTargets(refundable);
      return;
    }
    if (action === "expense") {
      // Reuses the single "Record as expense" dialog to pick the category and account for every selected order.
      const vendor = vendors.find((item) => item.data.name?.trim().toLowerCase() === selectedRecords[0]?.data.vendor?.trim().toLowerCase());
      setBulkExpenseIds(selectedRecords.map((record) => record.id));
      setExpenseConversionRecord(selectedRecords[0]);
      setExpenseCategoryId(expenseAccounts.find((account) => account.id === vendor?.data.defaultExpenseAccount)?.id ?? expenseAccounts[0]?.id ?? "");
      setExpensePaymentAccountId("");
      setExpenseConversionError("");
      return;
    }
    const count = selectedRecords.length;
    const noun = count === 1 ? module.label.toLowerCase() : module.plural.toLowerCase();
    if (action === "delete" && !window.confirm(`Delete ${count} ${noun}? This can’t be undone.`)) return;
    if (action === "undo-payment" && !window.confirm(`Remove the payments recorded on ${count} ${noun}? They will show as unpaid again.`)) return;
    setBulkPending(true);
    setActionMessage("");
    const done: string[] = [];
    const failed: string[] = [];
    for (const record of selectedRecords) {
      const title = record.data[module.titleKey] || module.label;
      try {
        if (action === "delete") {
          await deleteBookkeepingRecord(module.kind, record.id);
        } else if (action === "undo-payment") await undoInvoicePayments(record.id);
        else if (action === "apply-credit") await (module.kind === "supplier-credits" ? applySupplierCredit(record.id) : applyCreditNote(record.id));
        else if (action === "pay") {
          const balance = remainingBalance(record);
          if (balance <= 0) throw new Error(`${title} is already paid.`);
          await recordInvoicePayment(record.id, balance.toFixed(2), bulkPaymentDate, bulkPaymentAccount);
        } else await convertBookkeepingRecord(record.id, action);
        done.push(record.id);
      } catch (error) {
        const message = error instanceof Error ? readableError(error) : "it couldn’t be processed.";
        failed.push(message.includes(title) ? message : `${title}: ${message}`);
      }
    }
    if (action === "delete") setRecords((current) => current.filter((record) => !done.includes(record.id)));
    setSelectedIds(new Set());
    setBulkPending(false);
    setBulkPaymentOpen(false);
    const verbs: Record<BulkAction, string> = {
      estimates: "converted to estimates",
      "sales-orders": "converted to sales orders",
      invoices: "converted to invoices",
      expense: "recorded as expenses",
      pay: "marked paid",
      "undo-payment": "reopened as unpaid",
      "apply-credit": "applied",
      refund: "refunded",
      "invoice-time": "invoiced",
      open: "opened",
      delete: "deleted",
    };
    if (done.length) toast.success(`${done.length} ${done.length === 1 ? module.label.toLowerCase() : module.plural.toLowerCase()} ${verbs[action]}.`);
    if (failed.length) toast.error(failed.join(" "));
    router.refresh();
  }

  async function handleAction(kind: RecordActionKind, record: BookkeepingRecord) {
    setActionMessage("");
    if (kind === "convert-expense") {
      const vendor = vendors.find((item) => item.id === record.data.vendorId || item.id === record.data.vendor)
        ?? vendors.find((item) => item.data.name?.trim().toLowerCase() === record.data.vendor?.trim().toLowerCase());
      const preferredCategory = expenseAccounts.find((account) => account.id === vendor?.data.defaultExpenseAccount);
      setExpenseConversionRecord(record);
      setExpenseCategoryId(preferredCategory?.id ?? expenseAccounts[0]?.id ?? "");
      setExpensePaymentAccountId("");
      setExpenseConversionError("");
      return;
    }
    if (kind === "undo-payment") {
      if (!window.confirm(`Undo the payment on ${record.data.invoiceNumber || "this invoice"}? It will show as unpaid so you can edit it or record the payment again.`)) return;
      try {
        await undoInvoicePayments(record.id);
        toast.success(`Payment removed from ${record.data.invoiceNumber || "the invoice"}. You can now edit it or record a new payment.`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? readableError(error) : "We couldn’t undo that payment.");
      }
      return;
    }
    // "Mark paid" records the full payment through the same dialog, so it lands in an account.
    if (kind === "payment" || kind === "mark-paid") {
      const remaining = Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));
      setPaymentRecord(record);
      setPaymentAmount(remaining.toFixed(2));
      setPaymentDate(dateString(new Date()));
      setPaymentMethod(paymentAccounts[0]?.id ?? "");
      setPaymentRate(record.data.exchangeRate || "1");
      setPaymentError("");
      return;
    }
    if (kind === "refund") {
      setRefundTargets([record]);
      return;
    }
    let progressPercent = 0;
    if (kind === "progress") {
      const invoiced = Number(record.data.invoicedPercent || 0);
      const answer = window.prompt(`What percent of ${record.data.estimateNumber || "this estimate"} do you want to invoice now? ${invoiced ? `${invoiced}% is already invoiced.` : ""}`.trim(), String(Math.max(0, 100 - invoiced)));
      if (answer === null) return;
      progressPercent = Number(answer);
      if (!Number.isFinite(progressPercent) || progressPercent <= 0 || progressPercent > 100 - invoiced + 0.001) {
        toast.error(`Enter a percent between 1 and ${Math.max(0, 100 - invoiced)}.`);
        return;
      }
    }
    if (kind === "cancel-order" && !window.confirm(`Cancel purchase order ${record.data.poNumber || ""}?`)) return;

    setPendingAction(true);
    try {
      if (["send-rfq", "confirm-order", "receive-order", "cancel-order"].includes(kind)) {
        const transition = kind === "send-rfq" ? "send-rfq" : kind === "confirm-order" ? "confirm" : kind === "receive-order" ? "receive" : "cancel";
        const result = await advancePurchaseOrder(record.id, transition);
        setRecords((current) => current.map((item) => item.id === record.id ? { ...item, data: { ...item.data, status: result.status } } : item));
        setPage(1);
        const messages = {
          "RFQ Sent": `RFQ emailed to ${record.data.vendor}.`,
          "Purchase Order": "Purchase order confirmed and ready for receiving.",
          Received: "Items marked received and linked product stock updated.",
          Cancelled: "Purchase order cancelled.",
        };
        setActionMessage(messages[result.status as keyof typeof messages]);
      } else if (kind === "convert") {
        await convertBookkeepingRecord(record.id);
        setActionMessage(`Converted to ${module.kind === "purchase-orders" ? "a bill" : "an invoice"}.`);
      } else if (kind === "send") {
        if (module.kind === "invoices") await sendInvoiceRecord(record.id);
        else await sendCustomerDocumentRecord(record.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
        setActionMessage(`${module.label} emailed to the customer.`);
      } else if (kind === "duplicate") {
        const duplicate = module.kind === "invoices"
          ? await duplicateInvoiceRecord(record.id)
          : await duplicateCustomerDocumentRecord(record.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
        handleSaved(duplicate);
        setEditingRecord(duplicate);
        setDefaults({});
        setEditorOpen(true);
        setActionMessage(`${module.label} copy created as a draft.`);
      } else if (kind === "share") {
        const link = module.kind === "invoices"
          ? await createInvoiceShareLink(record.id)
          : await createCustomerDocumentShareLink(record.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
        try {
          await navigator.clipboard.writeText(link);
          setActionMessage(`${module.label} link copied. Anyone with the link can view this document.`);
        } catch {
          setActionMessage(`Copy this ${module.label.toLowerCase()} link to share: ${link}`);
        }
      } else if (kind === "print") {
        const printPath = module.kind === "invoices"
          ? `/app/invoices/${record.id}/print`
          : `/app/documents/${module.kind}/${record.id}/print`;
        const printWindow = window.open(printPath, "_blank");
        if (printWindow) printWindow.opener = null;
        else setActionMessage(`Allow pop-ups to open this ${module.label.toLowerCase()} for printing.`);
      } else if (kind === "apply-credit" && module.kind === "supplier-credits") {
        await applySupplierCredit(record.id);
        setActionMessage("Credit applied to the supplier’s bill balance.");
        toast.success(`Credit applied to bill ${record.data.billNumber}.`);
      } else if (kind === "apply-credit") {
        await applyCreditNote(record.id);
        setActionMessage("Credit applied to the matching invoice balance.");
      } else if (kind === "generate") {
        await generateRecurringInvoice(record.id);
        setActionMessage("Invoice created and the next billing date advanced.");
      } else if (kind === "remind") {
        await sendInvoiceReminder(record.id);
        toast.success(`Reminder sent for ${record.data.invoiceNumber || "the invoice"}.`);
      } else if (kind === "statement") {
        const result = await sendCustomerStatement(record.id);
        toast.success(`Statement sent: ${result.invoices} open ${result.invoices === 1 ? "invoice" : "invoices"}, ${formatCurrency(result.balance, currency)} due.`);
      } else if (kind === "progress") {
        await convertBookkeepingRecord(record.id, "invoices", progressPercent);
        setActionMessage(`Draft invoice created for ${progressPercent}% of the estimate.`);
      } else if (kind === "void") {
        if (!window.confirm(`Void ${record.data.invoiceNumber || record.data.creditNumber || `this ${module.label.toLowerCase()}`}? It stays on file but no longer counts in your books.`)) return;
        await voidBookkeepingRecord(module.kind, record.id);
        setActionMessage(`${module.label} voided.`);
      } else if (kind === "match") {
        await toggleTransactionMatch(record.id);
        setActionMessage(record.data.matched === "true" ? "Transaction marked as unmatched." : "Transaction matched.");
      }
      router.refresh();
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "That action couldn’t be completed.");
    } finally {
      setPendingAction(false);
    }
  }

  const paymentForeign = Boolean(paymentRecord?.data.currency && defaultCurrency && paymentRecord.data.currency !== defaultCurrency);

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentRecord) return;
    setPendingAction(true);
    setPaymentError("");
    try {
      await recordInvoicePayment(paymentRecord.id, paymentAmount, paymentDate, paymentMethod, "", paymentForeign ? paymentRate : "");
      setPaymentRecord(null);
      setActionMessage("Payment recorded and invoice balance updated.");
      toast.success("Payment recorded and invoice balance updated.");
      router.refresh();
    } catch (error) {
      setPaymentError(error instanceof Error ? readableError(error) : "We couldn’t record the payment.");
    } finally {
      setPendingAction(false);
    }
  }

  async function submitExpenseConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expenseConversionRecord || !expenseCategoryId) {
      setExpenseConversionError("Choose an expense category to continue.");
      return;
    }
    setPendingAction(true);
    setExpenseConversionError("");
    if (bulkExpenseIds.length) {
      const failed: string[] = [];
      let done = 0;
      for (const id of bulkExpenseIds) {
        const order = records.find((record) => record.id === id);
        try {
          await convertPurchaseOrderToExpense(id, expenseCategoryId, expensePaymentAccountId || undefined);
          done += 1;
        } catch (error) {
          failed.push(`${order?.data.poNumber || "Purchase order"}: ${error instanceof Error ? readableError(error) : "it couldn’t be recorded."}`);
        }
      }
      setBulkExpenseIds([]);
      setExpenseConversionRecord(null);
      setSelectedIds(new Set());
      setPendingAction(false);
      if (done) toast.success(`${done} ${done === 1 ? "purchase order" : "purchase orders"} recorded as expenses.`);
      if (failed.length) toast.error(failed.join(" "));
      router.refresh();
      return;
    }
    try {
      await convertPurchaseOrderToExpense(expenseConversionRecord.id, expenseCategoryId, expensePaymentAccountId || undefined);
      setExpenseConversionRecord(null);
      setActionMessage("Purchase order recorded as an expense.");
      router.refresh();
    } catch (error) {
      setExpenseConversionError(error instanceof Error ? readableError(error) : "We couldn’t record this purchase order as an expense.");
    } finally {
      setPendingAction(false);
    }
  }

  function exportCsv() {
    const rows = [visibleColumns.map((key) => listColumnLabels?.[key] ?? key), ...filteredRecords.map((record) => visibleColumns.map((key) => key === "address" ? formatCustomerAddress(record.data).replaceAll("\n", ", ") : record.data[key] ?? ""))];
    const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${module.slug}.csv`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  function handleItemsImported(importedRecords: BookkeepingRecord[]) {
    setRecords((current) => [...importedRecords, ...current]);
    setPage(1);
    setSearch("");
    setFilter("all");
    setActionMessage(`${importedRecords.length} ${importedRecords.length === 1 ? "item or service" : "items and services"} added from Excel.`);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{groupLabel} / {module.plural}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">{module.plural}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{module.description}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          {canExport ? <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button> : null}
          {module.kind === "items" ? <ItemsBulkImport onImported={handleItemsImported} /> : null}
          <Button className="gap-2" onClick={openNewRecord}><Plus size={16} />{module.kind === "settings" ? "Edit company profile" : `New ${module.label.toLowerCase()}`}</Button>
        </div>
      </section>

      {summaryCards.length ? (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${card.tone === "bad" ? "text-destructive" : ""}`}>{card.value}</p>
              {card.note ? <p className="mt-0.5 text-xs text-muted-foreground">{card.note}</p> : null}
            </div>
          ))}
        </div>
      ) : null}


      {actionMessage ? <p role="status" className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{actionMessage}</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:w-60 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${module.plural.toLowerCase()}`} className="pl-9" aria-label={`Search ${module.plural}`} />
            </div>
            {bulkMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="outline" className="gap-2" disabled={!selectedRecords.length || bulkPending} title={selectedRecords.length ? undefined : `Select ${module.plural.toLowerCase()} with the checkboxes first`}>
                      {bulkMenu.label === "Convert" ? <ArrowRightLeft size={15} /> : <ListChecks size={15} />}
                      {bulkPending ? "Working…" : `${bulkMenu.label}${selectedRecords.length ? ` (${selectedRecords.length})` : ""}`}<ChevronDown size={14} />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="min-w-48">
                  {bulkMenu.items.map((item) => {
                    const Icon = item.action === "expense" ? WalletCards
                      : item.action === "invoices" ? FileText
                      : item.action === "estimates" ? FileCheck2
                        : item.action === "sales-orders" ? ClipboardList
                          : item.action === "pay" ? CircleDollarSign
                            : item.action === "undo-payment" ? Undo2
                              : item.action === "refund" ? CircleDollarSign
                              : item.action === "open" ? FolderOpen
                              : BadgeCheck;
                    return <DropdownMenuItem key={item.action} onClick={() => void runBulkAction(item.action)}><Icon size={15} />{item.label}</DropdownMenuItem>;
                  })}
                  {bulkMenu.items.length ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem variant="destructive" onClick={() => void runBulkAction("delete")}><Trash2 size={15} />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {filterKey && filterOptions.length ? (
              <Select value={filter} onValueChange={(value) => setFilter(value ?? "all")}>
                <SelectTrigger className="w-[150px]" aria-label="Filter records"><SelectValue placeholder="All records" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All records</SelectItem>
                  {filterOptions.map((option) => <SelectItem key={option} value={option}>{option === "true" ? "Enabled" : option === "false" ? "Disabled" : option}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
            {module.kind === "customers" && customization && listPreferences ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2"><SlidersHorizontal size={15} />Columns</Button>} />
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                      {customization.options.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.key}
                          checked={listPreferences.columns.includes(column.key)}
                          disabled={column.key === customization.requiredColumn}
                          onCheckedChange={(checked) => updateListColumn(column.key, checked === true)}
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select
                  value={String(listPreferences.pageSize)}
                  onValueChange={(value) => {
                    const nextPageSize = customization.pageSizes.find((size) => String(size) === value);
                    if (nextPageSize) saveListPreferences({ ...listPreferences, pageSize: nextPageSize });
                  }}
                >
                  <SelectTrigger className="w-[128px]" aria-label="Customers per page"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {customization.pageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            ) : module.kind === "journals" && customization && listPreferences ? (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label="Print list" title="Print" onClick={() => window.print()}><Printer size={17} /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Export list as CSV" title="Export" onClick={exportCsv}><Share size={17} /></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="ghost" className="gap-2"><SlidersHorizontal size={16} />Customise</Button>} />
                  <DropdownMenuContent align="end" className="min-w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Columns</DropdownMenuLabel>
                      {customization.options.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.key}
                          checked={listPreferences.columns.includes(column.key)}
                          disabled={column.key === customization.requiredColumn}
                          onCheckedChange={(checked) => updateListColumn(column.key, checked === true)}
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Rows per page</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={String(listPreferences.pageSize)}
                        onValueChange={(value) => {
                          const nextPageSize = customization.pageSizes.find((size) => String(size) === value);
                          if (nextPageSize) saveListPreferences({ ...listPreferences, pageSize: nextPageSize });
                        }}
                      >
                        {customization.pageSizes.map((size) => <DropdownMenuRadioItem key={size} value={String(size)}>{size}</DropdownMenuRadioItem>)}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => saveListPreferences({ columns: [...customization.defaultColumns], pageSize: customization.defaultPageSize })}>Reset to default</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
      </div>

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <RecordTable
          module={module}
          records={tableRecords}
          columns={visibleColumns}
          columnLabels={listColumnLabels}
          onEdit={openEditRecord}
          openOnRowClick={module.kind !== "settings"}
          onOpen={module.kind === "journals" ? undefined : (record) => setDetailId(record.id)}
          onDelete={(record) => void handleDelete(record)}
          onAction={(kind, record) => void handleAction(kind, record)}
          selection={supportsBulkActions ? {
            selectedIds,
            onToggle: toggleSelected,
            onToggleAll: (checked) => setSelectedIds((current) => {
              const next = new Set(current);
              tableRecords.forEach((record) => (checked ? next.add(record.id) : next.delete(record.id)));
              return next;
            }),
          } : undefined}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Showing {filteredRecords.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length} {filteredRecords.length === 1 ? module.label.toLowerCase() : module.plural.toLowerCase()}{selectedRecords.length ? ` · ${selectedRecords.length} selected` : ""}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
          </div>
        </div>
      </section>

      <RecordDetailPanel
        module={module}
        record={detailRecord}
        currency={currency}
        onClose={() => setDetailId(null)}
        {...(detailRecord && (module.kind === "customers" || module.kind === "vendors") ? partyCentre(module.kind, detailRecord, related, currency) : {})}
        actions={detailRecord ? recordActions(module, detailRecord, (kind, record) => void handleAction(kind, record), {
          onEdit: () => { setDetailId(null); openEditRecord(detailRecord); },
          onDelete: () => { setDetailId(null); void handleDelete(detailRecord); },
        }) : []}
      />

      {module.kind === "journals" ? (
        <JournalEntryEditor
          key={`journals-${editingRecord?.id ?? "new"}`}
          accounts={accounts}
          record={editingRecord}
          defaults={defaults}
          currency={defaultCurrency}
          customers={customers}
          vendors={vendors}
          employeeNames={employeeNames}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          onSaveAndNew={(saved) => void handleInvoiceSaveComplete(saved, "save-and-new")}
          onStartFrom={(values) => {
            setEditingRecord(null);
            setDefaults({ ...createDefaults(module, records, defaultCurrency), ...values });
          }}
          onDelete={handleDelete}
        />
      ) : (
        <RecordEditor
          key={`${module.kind}-${editingRecord?.id ?? "new"}`}
          module={module}
          record={editingRecord}
          customers={customers}
          vendors={vendors}
          items={items}
          accounts={accounts}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          onSaveComplete={handleInvoiceSaveComplete}
        />
      )}

      <PaymentDialog
        open={Boolean(refundTargets)}
        onOpenChange={(open) => { if (!open) setRefundTargets(null); }}
        title={module.kind === "credit-notes" ? "Refund to customer" : "Record supplier refund"}
        description={`${refundTargets?.length ?? 0} ${refundTargets?.length === 1 ? "credit note" : "credit notes"} · ${formatCurrency((refundTargets ?? []).reduce((sum, record) => sum + Number(record.data.amount || 0), 0), currency)} ${module.kind === "credit-notes" ? "paid back to the customer" : "refunded to you"}`}
        accountLabel={module.kind === "credit-notes" ? "Refund paid from" : "Refund received into"}
        submitLabel="Record refund"
        paymentAccounts={paymentAccounts}
        pending={bulkPending}
        onSubmit={(date, accountId) => void processRefunds(date, accountId)}
      />

      <Dialog open={bulkPaymentOpen} onOpenChange={(open) => { if (!bulkPending) setBulkPaymentOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Pays the full remaining balance of {selectedRecords.length} selected {selectedRecords.length === 1 ? "invoice" : "invoices"}
              {" "}({formatCurrency(selectedRecords.reduce((sum, record) => sum + remainingBalance(record), 0), currency)}).
            </DialogDescription>
          </DialogHeader>
          <form id="bulk-payment-form" onSubmit={(event) => { event.preventDefault(); void runBulkAction("pay"); }} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="bulk-payment-date">Payment date</Label><Input id="bulk-payment-date" type="date" value={bulkPaymentDate} onChange={(event) => setBulkPaymentDate(event.target.value)} required /></div>
            <div className="space-y-2">
              <Label htmlFor="bulk-payment-method">Payment method / deposit to</Label>
              <Select value={bulkPaymentAccount || undefined} onValueChange={(value) => setBulkPaymentAccount(value ?? "")}>
                <SelectTrigger id="bulk-payment-method" className="w-full"><SelectValue placeholder="Choose a payment account" /></SelectTrigger>
                <SelectContent>{paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
              </Select>
              {!paymentAccounts.length ? <NoAccountsNotice message="You need a Cash, Bank or Credit card account to record where this payment went." /> : null}
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkPaymentOpen(false)} disabled={bulkPending}>Cancel</Button>
            <Button type="submit" form="bulk-payment-form" disabled={bulkPending || !bulkPaymentAccount}>{bulkPending ? "Recording…" : "Record payments"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentRecord)} onOpenChange={(open) => { if (!open) setPaymentRecord(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record invoice payment</DialogTitle>
            <DialogDescription>{paymentRecord?.data.invoiceNumber} · {paymentRecord?.data.customer}</DialogDescription>
          </DialogHeader>
          <form id="invoice-payment-form" onSubmit={submitPayment} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="payment-amount">Amount received</Label><Input id="payment-amount" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="payment-date">Payment date</Label><Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></div>
            {paymentForeign ? (
              <div className="space-y-2">
                <Label htmlFor="payment-rate">Exchange rate (1 {paymentRecord?.data.currency} = ? {defaultCurrency})</Label>
                <Input id="payment-rate" type="number" min="0.000001" step="any" value={paymentRate} onChange={(event) => setPaymentRate(event.target.value)} required />
                <p className="text-xs text-muted-foreground">Invoiced at {paymentRecord?.data.exchangeRate || "1"}. A different rate books the difference as an exchange gain or loss.</p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="payment-method">Deposit to account</Label>
              <Select value={paymentMethod || undefined} onValueChange={(value) => setPaymentMethod(value ?? "")}>
                <SelectTrigger id="payment-method" className="w-full"><SelectValue placeholder="Choose a payment account" /></SelectTrigger>
                <SelectContent>{paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
              </Select>
              {!paymentAccounts.length ? <NoAccountsNotice message="You need a Cash, Bank or Credit card account to record where this payment went." /> : null}
            </div>
            {paymentError ? <p role="alert" className="text-sm text-destructive">{paymentError}</p> : null}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentRecord(null)}>Cancel</Button>
            <Button type="submit" form="invoice-payment-form" disabled={pendingAction || !paymentMethod}>{pendingAction ? "Recording…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(expenseConversionRecord)} onOpenChange={(open) => { if (!open) { setExpenseConversionRecord(null); setBulkExpenseIds([]); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record purchase as expense</DialogTitle>
            <DialogDescription>
              {bulkExpenseIds.length > 1
                ? `${bulkExpenseIds.length} purchase orders · ${formatCurrency(records.filter((record) => bulkExpenseIds.includes(record.id)).reduce((sum, record) => sum + Number(record.data.amount || 0), 0), defaultCurrency)}`
                : <>{expenseConversionRecord?.data.poNumber} · {expenseConversionRecord?.data.vendor} · {formatCurrency(Number(expenseConversionRecord?.data.amount || 0), expenseConversionRecord?.data.currency || defaultCurrency)}</>}
            </DialogDescription>
          </DialogHeader>
          <form id="purchase-order-expense-form" onSubmit={submitExpenseConversion} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="purchase-order-expense-category">Expense category</Label>
              <Select value={expenseCategoryId || undefined} onValueChange={(value) => setExpenseCategoryId(value ?? "")}>
                <SelectTrigger id="purchase-order-expense-category" className="w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>{expenseAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name || account.data.code || "Expense account"}</SelectItem>)}</SelectContent>
              </Select>
              {!expenseAccounts.length ? <p className="text-xs leading-5 text-muted-foreground">Add an Expense category in Chart of Accounts before recording this expense.</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchase-order-expense-payment">Paid from (optional)</Label>
              <Select value={expensePaymentAccountId || "none"} onValueChange={(value) => setExpensePaymentAccountId(value === "none" ? "" : value ?? "")}>
                <SelectTrigger id="purchase-order-expense-payment" className="w-full"><SelectValue placeholder="Choose a payment account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not paid yet</SelectItem>
                  {paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {expenseConversionError ? <p role="alert" className="text-sm text-destructive">{expenseConversionError}</p> : null}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExpenseConversionRecord(null)}>Cancel</Button>
            <Button type="submit" form="purchase-order-expense-form" disabled={pendingAction || !expenseCategoryId}>{pendingAction ? "Recording…" : "Record expense"}</Button>
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
