"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { ArrowDownToLine, ArrowRightLeft, BadgeCheck, ChevronDown, CircleDollarSign, ClipboardList, FileCheck2, FileText, ListChecks, Plus, Search, SlidersHorizontal, Trash2, Undo2 } from "lucide-react";

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
  generateRecurringInvoice,
  markRecordPaid,
  recordInvoicePayment,
  sendCustomerDocumentRecord,
  sendInvoiceRecord,
  toggleTransactionMatch,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";
import { budgetActualRecords, recordsWithinBudgetDates, type BudgetLine } from "@/lib/budget-utils";
import JournalEntryEditor from "@/components/bookkeeping/JournalEntryEditor";
import ItemsBulkImport from "@/components/bookkeeping/ItemsBulkImport";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import { useNewRecordParam } from "@/hooks/use-new-record-param";
import RecordTable, { type RecordActionKind } from "@/components/bookkeeping/RecordTable";

interface ModuleWorkspaceProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  customers: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  items: BookkeepingRecord[];
  defaultCurrency: string;
  sourceFilter?: { startDate: string; endDate: string; budgetHead: string };
}

const DEFAULT_PAGE_SIZE = 10;
const CUSTOMER_PAGE_SIZES = [50, 75, 100, 150, 300] as const;
type CustomerPageSize = (typeof CUSTOMER_PAGE_SIZES)[number];

const CUSTOMER_COLUMN_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "openingBalance", label: "Opening balance" },
] as const;
type CustomerListColumn = (typeof CUSTOMER_COLUMN_OPTIONS)[number]["key"];

const DEFAULT_CUSTOMER_COLUMNS: CustomerListColumn[] = ["name", "company", "email", "phone", "openingBalance"];
const CUSTOMER_PREFERENCES_KEY = "mikledger:customer-list-preferences:v1";

interface CustomerListPreferences {
  columns: CustomerListColumn[];
  pageSize: CustomerPageSize;
}

function isCustomerListColumn(value: unknown): value is CustomerListColumn {
  return CUSTOMER_COLUMN_OPTIONS.some((column) => column.key === value);
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

  if (module.kind === "invoices") {
    values.invoiceNumber = `${prefix}${String(sequence).padStart(4, "0")}`;
    values.issueDate = dateString(today);
    values.dueDate = dateString(dueDate);
    values.paymentTerms = "30 days";
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

function purchaseOrderStage(status: string | undefined) {
  switch (status) {
    case "Sent":
    case "RFQ Sent": return "sent";
    case "Purchase Order": return "confirmed";
    case "Received": return "received";
    case "Converted": return "billed";
    case "Cancelled": return "cancelled";
    default: return "draft";
  }
}

export default function ModuleWorkspace({ module, records: initialRecords, customers, vendors, accounts, items, defaultCurrency, sourceFilter }: ModuleWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [customerPreferences, setCustomerPreferences] = useState<CustomerListPreferences>({ columns: DEFAULT_CUSTOMER_COLUMNS, pageSize: 50 });
  const [customerPreferencesReady, setCustomerPreferencesReady] = useState(false);
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
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [expenseConversionRecord, setExpenseConversionRecord] = useState<BookkeepingRecord | null>(null);
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [expensePaymentAccountId, setExpensePaymentAccountId] = useState("");
  const [expenseConversionError, setExpenseConversionError] = useState("");
  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const expenseAccounts = accounts.filter((account) => account.kind === "accounts" && account.data.type === "Expense" && account.data.locked !== "true");
  const pageSize = module.kind === "customers" ? customerPreferences.pageSize : DEFAULT_PAGE_SIZE;

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  useEffect(() => {
    if (module.kind !== "customers") return;
    try {
      const storedPreferences = window.localStorage.getItem(CUSTOMER_PREFERENCES_KEY);
      if (storedPreferences) {
        const parsed: unknown = JSON.parse(storedPreferences);
        if (typeof parsed === "object" && parsed !== null) {
          const preferences = parsed as Record<string, unknown>;
          const storedColumns = Array.isArray(preferences.columns)
            ? Array.from(new Set(preferences.columns.filter(isCustomerListColumn)))
            : [...DEFAULT_CUSTOMER_COLUMNS];
          if (!storedColumns.includes("name")) storedColumns.unshift("name");
          const storedPageSize = CUSTOMER_PAGE_SIZES.find((size) => size === preferences.pageSize) ?? 50;
          setCustomerPreferences({ columns: storedColumns, pageSize: storedPageSize });
        }
      }
    } catch {
      setCustomerPreferences({ columns: DEFAULT_CUSTOMER_COLUMNS, pageSize: 50 });
    }
    setCustomerPreferencesReady(true);
  }, [module.kind]);

  useEffect(() => {
    if (module.kind !== "customers" || !customerPreferencesReady) return;
    try {
      window.localStorage.setItem(CUSTOMER_PREFERENCES_KEY, JSON.stringify(customerPreferences));
    } catch {
      return;
    }
  }, [customerPreferences, customerPreferencesReady, module.kind]);

  const filterKey = ["status", "category", "type", "role", "accountType", "enabled"].find((key) => records.some((record) => record.data[key]));
  const filterOptions = filterKey
    ? [...new Set(records.map((record) => record.data[filterKey]).filter((value): value is string => Boolean(value)))].sort()
    : [];

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const budgetLine: BudgetLine | null = sourceFilter ? {
      category: module.kind === "invoices" ? "Sales" : "Expenses",
      budgetHead: sourceFilter.budgetHead,
      type: module.kind === "invoices" ? "Income" : "Expense",
      expected: "0",
      description: "",
    } : null;
    return records.filter((record) => {
      const matchesSearch = !normalizedSearch || Object.values(record.data).some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesFilter = module.kind === "purchase-orders" && filter.startsWith("po:")
        ? filter === "po:accounted"
          ? Boolean(record.data.convertedRecordId || record.data.convertedKind) || record.data.status === "Converted"
          : purchaseOrderStage(record.data.status) === filter.slice(3)
        : filter === "all" || !filterKey || record.data[filterKey] === filter;
      const matchesDateRange = !sourceFilter || recordsWithinBudgetDates([record], sourceFilter.startDate, sourceFilter.endDate).length > 0;
      const matchesBudgetHead = !budgetLine || budgetActualRecords(budgetLine, [record]).length > 0;
      return matchesSearch && matchesFilter && matchesDateRange && matchesBudgetHead;
    });
  }, [filter, filterKey, module.kind, records, search, sourceFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((page - 1) * pageSize, page * pageSize);
  const tableRecords = ["invoices", "estimates", "sales-orders", "credit-notes"].includes(module.kind)
    ? visibleRecords.map((record) => {
        const customer = customers.find((item) => item.id === record.data.customerId || item.id === record.data.customer)
          ?? customers.find((item) => item.data.name?.trim().toLowerCase() === record.data.customer?.trim().toLowerCase());
        return customer?.data.name ? { ...record, data: { ...record.data, customer: customer.data.name } } : record;
      })
    : visibleRecords;
  const visibleColumns = module.kind === "customers" ? customerPreferences.columns : module.columns;
  const canExport = module.kind !== "settings";
  const currency = records.find((record) => record.data.currency)?.data.currency || "USD";
  const purchaseOrderStages = [
    { id: "all", label: "All orders", count: records.length },
    { id: "po:draft", label: "RFQ drafts", count: records.filter((record) => purchaseOrderStage(record.data.status) === "draft").length },
    { id: "po:sent", label: "Awaiting response", count: records.filter((record) => purchaseOrderStage(record.data.status) === "sent").length },
    { id: "po:confirmed", label: "To receive", count: records.filter((record) => purchaseOrderStage(record.data.status) === "confirmed").length },
    { id: "po:received", label: "Ready to record", count: records.filter((record) => purchaseOrderStage(record.data.status) === "received" && !record.data.convertedRecordId && !record.data.convertedKind).length },
    { id: "po:accounted", label: "Accounted", count: records.filter((record) => Boolean(record.data.convertedRecordId || record.data.convertedKind) || record.data.status === "Converted").length },
    { id: "po:cancelled", label: "Cancelled", count: records.filter((record) => purchaseOrderStage(record.data.status) === "cancelled").length },
  ];

  useEffect(() => setPage(1), [search, filter]);

  function updateCustomerColumn(column: CustomerListColumn, visible: boolean) {
    setCustomerPreferences((current) => {
      if (column === "name" && !visible) return current;
      const columns = visible
        ? [...new Set([...current.columns, column])]
        : current.columns.filter((currentColumn) => currentColumn !== column);
      return { ...current, columns };
    });
    setPage(1);
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

  // Actions on several checked records at once, offered from the toolbar menu.
  type BulkAction = "estimates" | "sales-orders" | "invoices" | "pay" | "undo-payment" | "apply-credit" | "delete";
  const bulkMenu: { label: string; items: { action: BulkAction; label: string }[] } | null = module.kind === "sales-orders"
    ? { label: "Convert", items: [{ action: "estimates", label: "Convert to estimate" }, { action: "invoices", label: "Convert to invoice" }] }
    : module.kind === "estimates"
      ? { label: "Convert", items: [{ action: "sales-orders", label: "Convert to sales order" }, { action: "invoices", label: "Convert to invoice" }] }
      : module.kind === "invoices"
        ? { label: "Actions", items: [{ action: "pay", label: "Record payment" }, { action: "undo-payment", label: "Undo payment" }] }
        : module.kind === "credit-notes"
          ? { label: "Actions", items: [{ action: "apply-credit", label: "Apply credit" }] }
          : null;
  const supportsBulkActions = Boolean(bulkMenu);
  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
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
    if (action === "pay" && !bulkPaymentOpen) {
      openBulkPayment();
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
        if (action === "delete") await deleteBookkeepingRecord(module.kind, record.id);
        else if (action === "undo-payment") await undoInvoicePayments(record.id);
        else if (action === "apply-credit") await applyCreditNote(record.id);
        else if (action === "pay") {
          const balance = remainingBalance(record);
          if (balance <= 0) throw new Error(`${title} is already paid.`);
          await recordInvoicePayment(record.id, balance.toFixed(2), bulkPaymentDate, bulkPaymentAccount);
        } else await convertBookkeepingRecord(record.id, action);
        done.push(record.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "it couldn’t be processed.";
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
      pay: "marked paid",
      "undo-payment": "reopened as unpaid",
      "apply-credit": "applied",
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
        toast.error(error instanceof Error ? error.message : "We couldn’t undo that payment.");
      }
      return;
    }
    if (kind === "payment") {
      const remaining = Math.max(0, Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0));
      setPaymentRecord(record);
      setPaymentAmount(remaining.toFixed(2));
      setPaymentDate(dateString(new Date()));
      setPaymentMethod(paymentAccounts[0]?.id ?? "");
      setPaymentError("");
      return;
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
      toast.success("Payment recorded and invoice balance updated.");
      router.refresh();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "We couldn’t record the payment.");
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
    try {
      await convertPurchaseOrderToExpense(expenseConversionRecord.id, expenseCategoryId, expensePaymentAccountId || undefined);
      setExpenseConversionRecord(null);
      setActionMessage("Purchase order recorded as an expense.");
      router.refresh();
    } catch (error) {
      setExpenseConversionError(error instanceof Error ? error.message : "We couldn’t record this purchase order as an expense.");
    } finally {
      setPendingAction(false);
    }
  }

  function exportCsv() {
    const rows = [visibleColumns, ...filteredRecords.map((record) => visibleColumns.map((key) => key === "address" ? formatCustomerAddress(record.data).replaceAll("\n", ", ") : record.data[key] ?? ""))];
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
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Books / {module.plural}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">{module.plural}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{module.description}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          {canExport ? <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button> : null}
          {module.kind === "items" ? <ItemsBulkImport onImported={handleItemsImported} /> : null}
          <Button className="gap-2" onClick={openNewRecord}><Plus size={16} />{module.kind === "settings" ? "Edit company profile" : `New ${module.label.toLowerCase()}`}</Button>
        </div>
      </section>

      {module.kind === "invoices" || module.kind === "bills" ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
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

      {module.kind === "purchase-orders" ? (
        <div className="mt-6 flex min-w-0 gap-2 overflow-x-auto border-y border-border py-2" aria-label="Purchase order stages">
          {purchaseOrderStages.map((stage) => (
            <Button
              key={stage.id}
              type="button"
              size="sm"
              variant={filter === stage.id ? "default" : "outline"}
              className="shrink-0 gap-2"
              aria-pressed={filter === stage.id}
              onClick={() => setFilter(stage.id)}
            >
              {stage.label}<span className="tabular-nums opacity-75">{stage.count}</span>
            </Button>
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
                    const Icon = item.action === "invoices" ? FileText
                      : item.action === "estimates" ? FileCheck2
                        : item.action === "sales-orders" ? ClipboardList
                          : item.action === "pay" ? CircleDollarSign
                            : item.action === "undo-payment" ? Undo2
                              : BadgeCheck;
                    return <DropdownMenuItem key={item.action} onClick={() => void runBulkAction(item.action)}><Icon size={15} />{item.label}</DropdownMenuItem>;
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => void runBulkAction("delete")}><Trash2 size={15} />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {module.kind !== "purchase-orders" && filterKey && filterOptions.length ? (
              <Select value={filter} onValueChange={(value) => setFilter(value ?? "all")}>
                <SelectTrigger className="w-[150px]" aria-label="Filter records"><SelectValue placeholder="All records" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All records</SelectItem>
                  {filterOptions.map((option) => <SelectItem key={option} value={option}>{option === "true" ? "Enabled" : option === "false" ? "Disabled" : option}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
            {module.kind === "customers" ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2"><SlidersHorizontal size={15} />Columns</Button>} />
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                      {CUSTOMER_COLUMN_OPTIONS.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.key}
                          checked={customerPreferences.columns.includes(column.key)}
                          disabled={column.key === "name"}
                          onCheckedChange={(checked) => updateCustomerColumn(column.key, checked === true)}
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select
                  value={String(customerPreferences.pageSize)}
                  onValueChange={(value) => {
                    const nextPageSize = CUSTOMER_PAGE_SIZES.find((size) => String(size) === value);
                    if (nextPageSize) {
                      setCustomerPreferences((current) => ({ ...current, pageSize: nextPageSize }));
                      setPage(1);
                    }
                  }}
                >
                  <SelectTrigger className="w-[128px]" aria-label="Customers per page"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>
        </div>

        <RecordTable
          module={module}
          records={tableRecords}
          columns={visibleColumns}
          onEdit={openEditRecord}
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
          items={items}
          accounts={accounts}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          onSaveComplete={handleInvoiceSaveComplete}
        />
      )}

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

      <Dialog open={Boolean(expenseConversionRecord)} onOpenChange={(open) => { if (!open) setExpenseConversionRecord(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record purchase as expense</DialogTitle>
            <DialogDescription>
              {expenseConversionRecord?.data.poNumber} · {expenseConversionRecord?.data.vendor} · {formatCurrency(Number(expenseConversionRecord?.data.amount || 0), expenseConversionRecord?.data.currency || defaultCurrency)}
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
