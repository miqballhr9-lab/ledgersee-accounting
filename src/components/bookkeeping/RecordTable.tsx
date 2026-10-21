"use client";

import { ArrowRightLeft, BadgeCheck, BookOpenText, Ban, Check, CircleDollarSign, Copy, Ellipsis, Link2, Mail, PackageCheck, Pencil, Play, Printer, Trash2, Undo2 } from "lucide-react";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/crm/crm-shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";
import { homeRate, lineSummary } from "@/lib/invoice-utils";

export type RecordActionKind = "refund" | "remind" | "progress" | "statement" | "void" | "convert" | "convert-expense" | "payment" | "send" | "send-rfq" | "confirm-order" | "receive-order" | "cancel-order" | "mark-paid" | "match" | "apply-credit" | "generate" | "duplicate" | "share" | "print" | "undo-payment" | "credit-note" | "ledger";

interface RecordTableProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  columns?: readonly string[];
  /** Header names that replace the usual ones for this list. */
  columnLabels?: Record<string, string>;
  /** The company's home currency, for the "homeAmount" column (the amount converted at the document's exchange rate). */
  homeCurrency?: string;
  onEdit: (record: BookkeepingRecord) => void;
  /** When true, clicking anywhere on a row (outside its buttons and checkbox) opens it with onOpen, or onEdit without one. */
  openOnRowClick?: boolean;
  /** Opens the record's detail panel. */
  onOpen?: (record: BookkeepingRecord) => void;
  onDelete: (record: BookkeepingRecord) => void;
  onAction: (kind: RecordActionKind, record: BookkeepingRecord) => void;
  /** Where a cell's customer or supplier name links to (their page), when they are on file. */
  partyHref?: (record: BookkeepingRecord, key: string) => string | undefined;
  /** When given, each row gets a checkbox for actions on several records at once. */
  selection?: {
    selectedIds: ReadonlySet<string>;
    onToggle: (id: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
  };
}

const columnLabels: Record<string, string> = {
  lineItemNames: "Items",
  lineQuantity: "Quantity",
  refundAccountName: "Refund to",
  vendor: "Supplier",
  cnic: "CNIC",
  paymentMode: "Payment method",
  name: "Name",
  company: "Company",
  email: "Email",
  phone: "Phone",
  address: "Address",
  openingBalance: "Opening balance",
  sku: "SKU",
  itemType: "Type",
  rate: "Rate",
  unit: "Unit",
  stock: "Stock",
  qtyOnHand: "Qty on hand",
  cost: "Cost",
  invoiceNumber: "Invoice",
  customer: "Customer",
  issueDate: "Issued",
  dueDate: "Due date",
  amount: "Amount",
  paidAmount: "Paid",
  paymentMethod: "Payment account",
  status: "Status",
  estimateNumber: "Estimate",
  date: "Date",
  expiryDate: "Expires",
  orderNumber: "Order",
  deliveryDate: "Delivery",
  creditNumber: "Credit note",
  frequency: "Frequency",
  nextDate: "Next date",
  billNumber: "Bill",
  billDate: "Bill date",
  category: "Category",
  expenseDate: "Date",
  description: "Description",
  payee: "Paid to",
  paymentAccount: "Paid from",
  attachmentName: "Receipt",
  poNumber: "PO number",
  expectedDate: "Expected",
  accountType: "Type",
  currency: "Currency",
  institution: "Institution",
  account: "Account",
  type: "Direction",
  matched: "Reconciliation",
  contains: "Matches",
  enabled: "Enabled",
  code: "Code",
  debitAccount: "Debit",
  employeeId: "Employee ID",
  designation: "Designation",
  department: "Department",
  joiningDate: "Joined",
  baseSalary: "Base salary",
  mobile: "Mobile",
  creditAccount: "Credit",
  reference: "Reference",
  memo: "Memo",
  component: "Component",
  jurisdiction: "Jurisdiction",
  role: "Role",
  canApprove: "Approval",
  companyName: "Business",
  fiscalYear: "Fiscal year",
  invoicePrefix: "Prefix",
  nextInvoiceNumber: "Next number",
};

function displayValue(record: BookkeepingRecord, key: string, homeCurrency = "") {
  if (key === "lineItemNames") {
    const names = lineSummary(record.data).names;
    return <span className="block max-w-[220px] truncate" title={names}>{names || "—"}</span>;
  }
  if (key === "lineQuantity") {
    const { quantity } = lineSummary(record.data);
    return <span className="tabular-nums">{quantity ? quantity.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</span>;
  }
  if (key === "homeAmount") {
    const number = (Number(record.data.amount) || 0) * homeRate(record.data, homeCurrency);
    const currency = homeCurrency || record.data.currency || "USD";
    try {
      return <span className="tabular-nums">{new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(number)}</span>;
    } catch {
      return <span className="tabular-nums">{currency} {number.toFixed(2)}</span>;
    }
  }
  const value = key === "address"
    ? formatCustomerAddress(record.data).replaceAll("\n", " · ")
    : key === "paymentMethod" && record.data.paymentAccountName
    ? `${record.data.paymentMethod} · ${record.data.paymentAccountName}`
    : record.data[key] ?? "";
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  if (key === "status") {
    if (record.kind === "purchase-orders" && record.data.convertedKind) {
      const conversionLabel = record.data.convertedKind === "expenses" ? "Expense recorded" : "Bill created";
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="inline-flex max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">{value}</span>
          <span className="text-[10px] font-medium text-primary">{conversionLabel}</span>
        </span>
      );
    }
    return <StatusBadge value={value} />;
  }
  if (key === "matched" || key === "enabled" || key === "canApprove") {
    const active = value === "true";
    return <span className={`inline-flex items-center gap-1.5 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`} />{active ? key === "matched" ? "Matched" : "On" : key === "matched" ? "To match" : "Off"}</span>;
  }
  if (key === "itemType") return <span>{value === "Product" ? "Inventory" : value || "—"}</span>;
  if (key === "qtyOnHand") {
    if (record.data.itemType !== "Inventory" && record.data.itemType !== "Product") return <span className="text-muted-foreground">—</span>;
    const onHand = Number(value || 0);
    const reorder = Number(record.data.reorderPoint || 0);
    const tone = onHand <= 0 ? "text-destructive" : reorder > 0 && onHand <= reorder ? "text-amber-600 dark:text-amber-400" : "";
    return <span className={`tabular-nums ${tone}`}>{onHand.toLocaleString(undefined, { maximumFractionDigits: 3 })}{onHand <= 0 ? " · Out of stock" : reorder > 0 && onHand <= reorder ? " · Low" : ""}</span>;
  }
  if (["amount", "balance", "paidAmount", "openingBalance", "rate", "baseSalary", "cost"].includes(key)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      const currency = record.data.currency || "USD";
      try {
        return <span className="tabular-nums">{new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(number)}</span>;
      } catch {
        return <span className="tabular-nums">{currency} {number.toFixed(2)}</span>;
      }
    }
  }
  if (key === "attachmentName" && record.data.attachmentUrl) {
    return <a className="max-w-[180px] truncate text-primary underline-offset-4 hover:underline" href={record.data.attachmentUrl} target="_blank" rel="noreferrer">{value}</a>;
  }
  return <span className="block max-w-[220px] truncate" title={value}>{value}</span>;
}

export interface RecordMenuAction {
  key: string;
  label: string;
  icon: typeof ArrowRightLeft;
  run: () => void;
  /** Shown as a button on the detail panel, not only in the menu. */
  primary?: boolean;
  destructive?: boolean;
}

/** Everything that can be done to one record, in the order the ⋯ menu and the detail panel show it. */
export function recordActions(
  module: ModuleDefinition,
  record: BookkeepingRecord,
  onAction: RecordTableProps["onAction"],
  row: { onEdit: () => void; onDelete: () => void },
): RecordMenuAction[] {
  const actions: RecordMenuAction[] = [];
  const add = (kind: RecordActionKind, label: string, icon: typeof ArrowRightLeft, primary = false) => actions.push({ key: kind, label, icon, primary, run: () => onAction(kind, record) });
  const purchaseStatus = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
  const hasAccountingRecord = Boolean(record.data.convertedRecordId || record.data.convertedKind);
  const canCancelPurchaseOrder = module.kind === "purchase-orders" && ["Draft", "RFQ Sent", "Purchase Order"].includes(purchaseStatus) && !hasAccountingRecord;
  const canConvertPurchaseOrder = module.kind === "purchase-orders" && ["Purchase Order", "Received"].includes(purchaseStatus) && !hasAccountingRecord;
  if (module.kind === "purchase-orders") {
    if (purchaseStatus === "Draft" || purchaseStatus === "RFQ Sent") add("confirm-order", "Confirm order", BadgeCheck, true);
    else if (purchaseStatus === "Purchase Order" || purchaseStatus === "Partially received") add("receive-order", purchaseStatus === "Partially received" ? "Receive the rest" : "Receive products", PackageCheck, true);
    else if (purchaseStatus === "Received" && canConvertPurchaseOrder) add("convert", "Create bill", ArrowRightLeft, true);
    if (canConvertPurchaseOrder && purchaseStatus === "Purchase Order") add("convert", "Create bill", ArrowRightLeft);
    if (canConvertPurchaseOrder) add("convert-expense", "Record as expense", CircleDollarSign);
  }
  if (module.kind === "invoices" && !["Paid", "Cancelled"].includes(record.data.status ?? "")) add("payment", "Record payment", CircleDollarSign, true);
  if (module.kind === "invoices") add("send", "Send invoice", Mail, true);
  if (module.kind === "invoices" && !["Draft", "Void", "Cancelled"].includes(record.data.status ?? "")) add("credit-note", "Create credit note", Undo2);
  if (["estimates", "sales-orders", "credit-notes"].includes(module.kind)) add("send", `Send ${module.label.toLowerCase()}`, Mail, true);
  if (module.kind === "bills" && record.data.status !== "Paid") add("mark-paid", "Mark paid", Check, true);
  if (module.kind === "credit-notes" && !["Applied", "Refunded", "Void"].includes(record.data.status ?? "")) {
    add("apply-credit", "Apply credit", BadgeCheck, true);
    add("refund", "Refund to customer", CircleDollarSign);
  }
  const openBalance = Number(record.data.amount || 0) - Number(record.data.paidAmount || 0) - Number(record.data.creditApplied || 0);
  if (module.kind === "invoices" && openBalance > 0.004 && !["Draft", "Void", "Cancelled", "Paid"].includes(record.data.status ?? "")) add("remind", "Send reminder", Mail);
  if (module.kind === "estimates" && !["Converted", "Declined"].includes(record.data.status ?? "")) add("progress", "Progress invoice (part)", ArrowRightLeft);
  if (module.kind === "customers") add("ledger", "Ledger", BookOpenText, true);
  if (module.kind === "customers") add("statement", "Send statement", Mail);
  if (module.kind === "recurring-invoices") add("generate", "Generate invoice", Play, true);
  if (module.kind === "transactions") add("match", record.data.matched === "true" ? "Mark unmatched" : "Match transaction", Check, true);
  actions.push({ key: "edit", label: "Edit", icon: Pencil, run: row.onEdit, primary: true });
  if (["invoices", "estimates", "sales-orders", "credit-notes"].includes(module.kind)) {
    add("duplicate", `Copy ${module.label.toLowerCase()}`, Copy);
    add("share", "Copy share link", Link2);
    add("print", "Print or save PDF", Printer);
    if (module.kind === "invoices" && Number(record.data.paidAmount) > 0) add("undo-payment", "Undo payment", Undo2);
    if ((module.kind === "invoices" || module.kind === "credit-notes") && record.data.status !== "Void" && !(Number(record.data.paidAmount) > 0)) add("void", "Void", Ban);
  }
  if (canCancelPurchaseOrder) actions.push({ key: "cancel-order", label: "Cancel purchase order", icon: Ban, destructive: true, run: () => onAction("cancel-order", record) });
  actions.push({ key: "delete", label: "Delete", icon: Trash2, destructive: true, run: row.onDelete });
  return actions;
}

function RowMenu({ label, actions }: { label: string; actions: RecordMenuAction[] }) {
  const regular = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${label}`}><Ellipsis size={16} /></Button>} />
      <DropdownMenuContent align="end" className="min-w-48">
        {regular.map((action) => <DropdownMenuItem key={`${action.key}-${action.label}`} onClick={action.run}><action.icon size={14} />{action.label}</DropdownMenuItem>)}
        {regular.length && destructive.length ? <DropdownMenuSeparator /> : null}
        {destructive.map((action) => <DropdownMenuItem key={action.key} variant="destructive" onClick={action.run}><action.icon size={14} />{action.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function RecordTable({ module, records, columns = module.columns, columnLabels: headerLabels, homeCurrency = "", onEdit, openOnRowClick = false, onOpen, onDelete, onAction, selection, partyHref }: RecordTableProps) {
  const allSelected = Boolean(selection) && records.length > 0 && records.every((record) => selection?.selectedIds.has(record.id));
  const someSelected = Boolean(selection) && records.some((record) => selection?.selectedIds.has(record.id));
  if (records.length === 0) {
    return (
      <div className="grid min-h-56 place-items-center border-t border-border px-6 py-10 text-center">
        <div className="max-w-xs">
          <p className="text-sm font-medium">No {module.plural.toLowerCase()} found</p>
          <p className="mt-1 text-sm text-muted-foreground">Try changing your search, or add your first {module.label.toLowerCase()}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {selection ? (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={`Select all ${module.plural.toLowerCase()} on this page`}
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
                />
              </TableHead>
            ) : null}
            {columns.map((key) => <TableHead key={key} className="whitespace-nowrap px-4 text-xs font-medium text-muted-foreground">{key === "homeAmount" ? `Amount (${homeCurrency})` : headerLabels?.[key] ?? columnLabels[key] ?? module.fields.find((field) => field.key === key)?.label ?? key}</TableHead>)}
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            return (
              <TableRow
                key={record.id}
                className={`group ${openOnRowClick ? "cursor-pointer" : ""}`}
                data-state={selection?.selectedIds.has(record.id) ? "selected" : undefined}
                onClick={openOnRowClick ? (event) => {
                  if ((event.target as HTMLElement).closest("button, a, input, [role=checkbox], [role=menuitem]")) return;
                  (onOpen ?? onEdit)(record);
                } : undefined}
              >
                {selection ? (
                  <TableCell className="w-10">
                    <Checkbox
                      aria-label={`Select ${record.data[module.titleKey] || module.label.toLowerCase()}`}
                      checked={selection.selectedIds.has(record.id)}
                      onCheckedChange={(checked) => selection.onToggle(record.id, checked === true)}
                    />
                  </TableCell>
                ) : null}
                {columns.map((key, index) => {
                  const href = index > 0 && key !== module.titleKey ? partyHref?.(record, key) : undefined;
                  return (
                    <TableCell key={key} className={`max-w-[240px] px-4 py-3 text-sm ${key === "address" ? "whitespace-normal" : "whitespace-nowrap"}`}>
                      {key === module.titleKey || index === 0
                        ? <span className="font-medium text-primary">{displayValue(record, key, homeCurrency)}</span>
                        : href ? <Link href={href} className="text-primary underline-offset-4 hover:underline" title={`Open ${displayValue(record, key, homeCurrency)}`}>{displayValue(record, key, homeCurrency)}</Link> : displayValue(record, key, homeCurrency)}
                    </TableCell>
                  );
                })}
                <TableCell className="w-12 px-2 text-right">
                  <RowMenu label={record.data[module.titleKey] || module.label.toLowerCase()} actions={recordActions(module, record, onAction, { onEdit: () => onEdit(record), onDelete: () => onDelete(record) })} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
