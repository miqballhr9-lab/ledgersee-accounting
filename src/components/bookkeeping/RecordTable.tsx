"use client";

import { ArrowRightLeft, BadgeCheck, Ban, Check, CircleDollarSign, Copy, Ellipsis, Link2, Mail, PackageCheck, Pencil, Play, Printer, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";

export type RecordActionKind = "convert" | "convert-expense" | "payment" | "send" | "send-rfq" | "confirm-order" | "receive-order" | "cancel-order" | "mark-paid" | "match" | "apply-credit" | "generate" | "duplicate" | "share" | "print" | "undo-payment";

interface RecordTableProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  columns?: readonly string[];
  onEdit: (record: BookkeepingRecord) => void;
  onDelete: (record: BookkeepingRecord) => void;
  onAction: (kind: RecordActionKind, record: BookkeepingRecord) => void;
  /** When given, each row gets a checkbox for actions on several records at once. */
  selection?: {
    selectedIds: ReadonlySet<string>;
    onToggle: (id: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
  };
}

const columnLabels: Record<string, string> = {
  refundAccountName: "Refund to",
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

function displayValue(record: BookkeepingRecord, key: string) {
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
    const tone = value === "Paid" || value === "Accepted" || value === "Applied" || value === "Converted"
      ? "bg-accent text-accent-foreground ring-border"
      : value === "Overdue" || value === "Declined" || value === "Cancelled"
        ? "bg-destructive/10 text-destructive ring-destructive/20"
        : value === "Draft" || value === "Open" || value === "Partially Paid"
          ? "bg-secondary text-secondary-foreground ring-border"
          : "bg-muted text-muted-foreground ring-border";
    return <span className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}>{value}</span>;
  }
  if (key === "matched" || key === "enabled" || key === "canApprove") {
    const active = value === "true";
    return <span className={`inline-flex items-center gap-1.5 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`} />{active ? key === "matched" ? "Matched" : "On" : key === "matched" ? "To match" : "Off"}</span>;
  }
  if (["amount", "paidAmount", "openingBalance", "rate"].includes(key)) {
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

function rowActions(
  module: ModuleDefinition,
  record: BookkeepingRecord,
  onAction: RecordTableProps["onAction"],
  row: { onEdit: () => void; onDelete: () => void },
) {
  const actions: { kind: RecordActionKind; label: string; icon: typeof ArrowRightLeft }[] = [];
  const purchaseStatus = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
  const hasAccountingRecord = Boolean(record.data.convertedRecordId || record.data.convertedKind);
  const canCancelPurchaseOrder = module.kind === "purchase-orders" && ["Draft", "RFQ Sent", "Purchase Order"].includes(purchaseStatus) && !hasAccountingRecord;
  const canConvertPurchaseOrder = module.kind === "purchase-orders" && ["Purchase Order", "Received"].includes(purchaseStatus) && !hasAccountingRecord;
  if (module.kind === "purchase-orders") {
    const status = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
    if (status === "Draft" || status === "RFQ Sent") actions.push({ kind: "confirm-order", label: "Confirm", icon: BadgeCheck });
    else if (status === "Purchase Order") actions.push({ kind: "receive-order", label: "Receive", icon: PackageCheck });
    else if (status === "Received" && canConvertPurchaseOrder) actions.push({ kind: "convert", label: "Create bill", icon: ArrowRightLeft });
  }
  if (module.kind === "invoices") {
    if (!["Paid", "Cancelled"].includes(record.data.status ?? "")) actions.push({ kind: "payment", label: "Record payment", icon: CircleDollarSign });
    actions.push({ kind: "send", label: "Send invoice", icon: Mail });
  }
  if (["estimates", "sales-orders", "credit-notes"].includes(module.kind)) actions.push({ kind: "send", label: `Send ${module.label.toLowerCase()}`, icon: Mail });
  if (module.kind === "bills") actions.push({ kind: "mark-paid", label: "Mark paid", icon: Check });
  if (module.kind === "credit-notes" && !["Applied", "Refunded"].includes(record.data.status ?? "")) actions.push({ kind: "apply-credit", label: "Apply credit", icon: BadgeCheck });
  if (module.kind === "recurring-invoices") actions.push({ kind: "generate", label: "Generate invoice", icon: Play });
  if (module.kind === "transactions") actions.push({ kind: "match", label: record.data.matched === "true" ? "Mark unmatched" : "Match transaction", icon: Check });

  return (
    <>
      {actions.map(({ kind, label, icon: Icon }) => (
        <Button key={kind} type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => onAction(kind, record)}>
          <Icon size={13} />{label}
        </Button>
      ))}
      {module.kind === "purchase-orders" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${record.data.poNumber || "purchase order"}`}><Ellipsis size={15} /></Button>} />
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={row.onEdit}><Pencil size={14} />Edit</DropdownMenuItem>
            {canConvertPurchaseOrder ? (
              <>
                {purchaseStatus === "Purchase Order" ? <DropdownMenuItem onClick={() => onAction("convert", record)}><ArrowRightLeft size={14} />Create bill</DropdownMenuItem> : null}
                <DropdownMenuItem onClick={() => onAction("convert-expense", record)}><CircleDollarSign size={14} />Record as expense</DropdownMenuItem>
              </>
            ) : null}
            {canCancelPurchaseOrder ? <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction("cancel-order", record)}><Ban size={14} />Cancel purchase order</DropdownMenuItem> : null}
            <DropdownMenuItem variant="destructive" onClick={row.onDelete}><Trash2 size={14} />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : module.kind === "supplier-credits" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${record.data.creditNumber || "credit note"}`}><Ellipsis size={15} /></Button>} />
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onClick={row.onEdit}><Pencil size={14} />Edit</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={row.onDelete}><Trash2 size={14} />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : ["invoices", "estimates", "sales-orders", "credit-notes"].includes(module.kind) ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={`More ${module.label.toLowerCase()} actions`}><Ellipsis size={15} /></Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction("duplicate", record)}><Copy size={14} />Copy {module.label.toLowerCase()}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("share", record)}><Link2 size={14} />Copy share link</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("print", record)}><Printer size={14} />Print or save PDF</DropdownMenuItem>
            {module.kind === "invoices" && Number(record.data.paidAmount) > 0 ? (
              <DropdownMenuItem onClick={() => onAction("undo-payment", record)}><Undo2 size={14} />Undo payment</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

export default function RecordTable({ module, records, columns = module.columns, onEdit, onDelete, onAction, selection }: RecordTableProps) {
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
            {columns.map((key) => <TableHead key={key} className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{columnLabels[key] ?? key}</TableHead>)}
            <TableHead className="w-[170px] text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            return (
              <TableRow key={record.id} className="group" data-state={selection?.selectedIds.has(record.id) ? "selected" : undefined}>
                {selection ? (
                  <TableCell className="w-10">
                    <Checkbox
                      aria-label={`Select ${record.data[module.titleKey] || module.label.toLowerCase()}`}
                      checked={selection.selectedIds.has(record.id)}
                      onCheckedChange={(checked) => selection.onToggle(record.id, checked === true)}
                    />
                  </TableCell>
                ) : null}
                {columns.map((key) => (
                  <TableCell key={key} className={`max-w-[240px] py-3 text-[13px] ${key === "address" ? "whitespace-normal" : "whitespace-nowrap"}`}>
                    {key === module.titleKey ? <span className="font-medium text-foreground">{displayValue(record, key)}</span> : displayValue(record, key)}
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {rowActions(module, record, onAction, { onEdit: () => onEdit(record), onDelete: () => onDelete(record) })}
                    {!["purchase-orders", "supplier-credits"].includes(module.kind) ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${module.label.toLowerCase()}`} onClick={() => onEdit(record)}><Pencil size={14} /></Button> : null}
                    {!["purchase-orders", "supplier-credits"].includes(module.kind) ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${module.label.toLowerCase()}`} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(record)}><Trash2 size={14} /></Button> : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
