"use client";

import { ArrowRightLeft, BadgeCheck, Ban, Check, CircleDollarSign, Copy, Ellipsis, Link2, Mail, PackageCheck, Pencil, Play, Printer, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

export type RecordActionKind = "convert" | "payment" | "send" | "send-rfq" | "confirm-order" | "receive-order" | "cancel-order" | "mark-paid" | "match" | "apply-credit" | "generate" | "duplicate" | "share" | "print";

interface RecordTableProps {
  module: ModuleDefinition;
  records: BookkeepingRecord[];
  onEdit: (record: BookkeepingRecord) => void;
  onDelete: (record: BookkeepingRecord) => void;
  onAction: (kind: RecordActionKind, record: BookkeepingRecord) => void;
}

const columnLabels: Record<string, string> = {
  name: "Name",
  company: "Company",
  email: "Email",
  phone: "Phone",
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
  const value = key === "paymentMethod" && record.data.paymentAccountName
    ? `${record.data.paymentMethod} · ${record.data.paymentAccountName}`
    : record.data[key] ?? "";
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  if (key === "status") {
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

function rowActions(module: ModuleDefinition, record: BookkeepingRecord, onAction: RecordTableProps["onAction"]) {
  const actions: { kind: RecordActionKind; label: string; icon: typeof ArrowRightLeft }[] = [];
  const purchaseStatus = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
  const canCancelPurchaseOrder = module.kind === "purchase-orders" && ["Draft", "RFQ Sent", "Purchase Order"].includes(purchaseStatus);
  if (module.kind === "purchase-orders") {
    const status = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
    if (status === "Draft") actions.push({ kind: "send-rfq", label: "Send RFQ", icon: Mail });
    else if (status === "RFQ Sent") actions.push({ kind: "confirm-order", label: "Confirm", icon: BadgeCheck });
    else if (status === "Purchase Order") actions.push({ kind: "receive-order", label: "Receive", icon: PackageCheck });
    else if (status === "Received") actions.push({ kind: "convert", label: "Create bill", icon: ArrowRightLeft });
  } else if (["estimates", "sales-orders"].includes(module.kind)) actions.push({ kind: "convert", label: "Convert", icon: ArrowRightLeft });
  if (module.kind === "invoices") actions.push({ kind: "payment", label: "Record payment", icon: CircleDollarSign }, { kind: "send", label: "Send invoice", icon: Mail });
  if (["estimates", "sales-orders", "credit-notes"].includes(module.kind)) actions.push({ kind: "send", label: `Send ${module.label.toLowerCase()}`, icon: Mail });
  if (module.kind === "bills") actions.push({ kind: "mark-paid", label: "Mark paid", icon: Check });
  if (module.kind === "credit-notes") actions.push({ kind: "apply-credit", label: "Apply credit", icon: BadgeCheck });
  if (module.kind === "recurring-invoices") actions.push({ kind: "generate", label: "Generate invoice", icon: Play });
  if (module.kind === "transactions") actions.push({ kind: "match", label: record.data.matched === "true" ? "Mark unmatched" : "Match transaction", icon: Check });

  return (
    <>
      {actions.map(({ kind, label, icon: Icon }) => (
        <Button key={kind} type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => onAction(kind, record)}>
          <Icon size={13} />{label}
        </Button>
      ))}
      {canCancelPurchaseOrder ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label="More purchase order actions"><Ellipsis size={15} /></Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction("cancel-order", record)}><Ban size={14} />Cancel purchase order</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : ["invoices", "estimates", "sales-orders", "credit-notes"].includes(module.kind) ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={`More ${module.label.toLowerCase()} actions`}><Ellipsis size={15} /></Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction("duplicate", record)}><Copy size={14} />Copy {module.label.toLowerCase()}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("share", record)}><Link2 size={14} />Copy share link</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("print", record)}><Printer size={14} />Print or save PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

export default function RecordTable({ module, records, onEdit, onDelete, onAction }: RecordTableProps) {
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
            {module.columns.map((key) => <TableHead key={key} className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{columnLabels[key] ?? key}</TableHead>)}
            <TableHead className="w-[170px] text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const purchaseStatus = record.data.status === "Sent" ? "RFQ Sent" : record.data.status || "Draft";
            const canEdit = module.kind !== "purchase-orders" || ["Draft", "RFQ Sent"].includes(purchaseStatus);
            const canDelete = module.kind !== "purchase-orders" || purchaseStatus === "Draft";
            return (
              <TableRow key={record.id} className="group">
                {module.columns.map((key) => (
                  <TableCell key={key} className="max-w-[240px] whitespace-nowrap py-3 text-[13px]">
                    {key === module.titleKey ? <span className="font-medium text-foreground">{displayValue(record, key)}</span> : displayValue(record, key)}
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {rowActions(module, record, onAction)}
                    {canEdit ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${module.label.toLowerCase()}`} onClick={() => onEdit(record)}><Pencil size={14} /></Button> : null}
                    {canDelete ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${module.label.toLowerCase()}`} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(record)}><Trash2 size={14} /></Button> : null}
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
