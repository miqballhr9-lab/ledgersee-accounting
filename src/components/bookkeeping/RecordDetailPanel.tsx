"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";
import { currencyAmount, parseInvoiceLines } from "@/lib/invoice-utils";
import { Initials, StatusBadge } from "@/components/crm/crm-shared";
import type { RecordMenuAction } from "@/components/bookkeeping/RecordTable";

interface RecordDetailPanelProps {
  module: ModuleDefinition;
  /** The record shown, or null when the panel is closed. */
  record: BookkeepingRecord | null;
  currency: string;
  actions: RecordMenuAction[];
  onClose: () => void;
}

const partyKeys = ["customer", "vendor", "payee", "name"] as const;
const moneyKeys = new Set(["amount", "paidAmount", "openingBalance", "rate", "cost", "subtotal", "taxAmount", "discount", "baseSalary"]);
const documentKinds = new Set(["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices", "bills", "purchase-orders", "supplier-credits", "expenses"]);

function balanceOf(data: Record<string, string>) {
  return Math.max(0, Number(data.amount || 0) - Number(data.paidAmount || 0) - Number(data.creditApplied || 0));
}

/**
 * The right-hand panel a record opens in, as in Odoo and Zoho: the record's
 * name, status and amount up top with its actions, then its details, lines
 * and totals, and a short history. It only shows the record and runs the
 * same actions as the list's ⋯ menu.
 */
export default function RecordDetailPanel({ module, record, currency: fallbackCurrency, actions, onClose }: RecordDetailPanelProps) {
  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [shownId, setShownId] = useState<string | null>(null);
  if ((record?.id ?? null) !== shownId) {
    setShownId(record?.id ?? null);
    setTab("overview");
  }
  if (!record) return <Sheet open={false} />;

  const data = record.data;
  const currency = data.currency || fallbackCurrency;
  const money = (value: string | number | undefined) => currencyAmount(Number(value || 0), currency);
  const title = data[module.titleKey] || module.label;
  const party = partyKeys.map((key) => (key !== module.titleKey ? data[key] : "")).find(Boolean) ?? "";
  const isDocument = documentKinds.has(module.kind);
  const lines = data.lineItems ? parseInvoiceLines(data.lineItems) : [];
  const buttons = actions.filter((action) => action.primary && !action.destructive);
  const more = actions.filter((action) => !action.primary || action.destructive);
  const hasBalance = ["invoices", "bills"].includes(module.kind);
  const fields = module.fields.filter((field) => !["lineItems", "attachment", "logo"].includes(field.key) && field.type !== "file");
  const timeline = [
    { at: record.createdAt, text: `${module.label} created` },
    ...(data.sentAt ? [{ at: data.sentAt, text: `${module.label} sent` }] : []),
    ...(data.reminderSentAt ? [{ at: data.reminderSentAt, text: "Payment reminder sent" }] : []),
    ...(data.paidDate ? [{ at: data.paidDate, text: `Payment recorded${data.paymentAccountName ? ` to ${data.paymentAccountName}` : ""}` }] : []),
    ...(data.convertedAt ? [{ at: data.convertedAt, text: `Converted${data.convertedKind ? ` to ${data.convertedKind.replace("-", " ")}` : ""}` }] : []),
    ...(record.updatedAt !== record.createdAt ? [{ at: record.updatedAt, text: "Last changed" }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function display(key: string, type: string | undefined) {
    const value = key === "address" ? formatCustomerAddress(data).replaceAll("\n", ", ") : data[key] ?? "";
    if (type === "checkbox") return value === "true" ? "Yes" : "No";
    if (!value) return <span className="text-muted-foreground">—</span>;
    if (key === "status") return <StatusBadge value={value} />;
    if (key === "paymentMethod" && data.paymentAccountName) return `${value} · ${data.paymentAccountName}`;
    if (moneyKeys.has(key) || (type === "number" && /amount|balance|salary/i.test(key))) return money(value);
    if (type === "email") return <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${value}`}>{value}</a>;
    return value;
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <Initials name={party || title} className="size-11 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{module.label}</p>
              <SheetTitle className="mt-0.5 truncate text-xl">{title}</SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {data.status ? <StatusBadge value={data.status} /> : null}
                {party ? <span>{party}</span> : null}
                {isDocument && data.amount ? <span className="font-medium text-foreground">{money(data.amount)}</span> : null}
                {data.dueDate ? <span>Due {data.dueDate}</span> : null}
              </SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {buttons.map((action, index) => (
              <Button key={`${action.key}-${action.label}`} type="button" size="sm" variant={index === 0 && action.key !== "edit" ? "default" : "outline"} className="gap-1.5" onClick={action.run}>
                <action.icon size={14} />{action.label}
              </Button>
            ))}
            {more.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" className="gap-1.5">More<ChevronDown size={14} /></Button>} />
                <DropdownMenuContent align="end" className="min-w-48">
                  {more.filter((action) => !action.destructive).map((action) => <DropdownMenuItem key={`${action.key}-${action.label}`} onClick={action.run}><action.icon size={14} />{action.label}</DropdownMenuItem>)}
                  {more.some((action) => !action.destructive) && more.some((action) => action.destructive) ? <DropdownMenuSeparator /> : null}
                  {more.filter((action) => action.destructive).map((action) => <DropdownMenuItem key={action.key} variant="destructive" onClick={action.run}><action.icon size={14} />{action.label}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex shrink-0 gap-1 border-b border-border px-5 pt-2">
          {([["overview", "Overview"], ["timeline", "Timeline"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {tab === "overview" ? (
            <>
              {hasBalance ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {[["Amount", money(data.amount)], ["Paid", money(data.paidAmount)], [module.kind === "invoices" ? "Balance due" : "Still to pay", money(balanceOf(data))]].map(([label, value], index) => (
                    <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`mt-1 text-lg font-semibold tabular-nums ${index === 2 ? "text-primary" : ""}`}>{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <section className="rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{module.label} details</h3>
                <dl className="grid gap-x-6 gap-y-2.5 px-4 py-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div key={field.key} className={`min-w-0 ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>
                      <dt className="text-xs text-muted-foreground">{field.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{display(field.key, field.type)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {lines.length ? (
                <section className="rounded-lg border border-border bg-card">
                  <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{["bills", "expenses", "supplier-credits"].includes(module.kind) ? "Lines" : "Items"}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">{["bills", "expenses", "supplier-credits"].includes(module.kind) ? "Category" : "Item"}</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Rate</th><th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
                      <tbody>
                        {lines.map((line, index) => (
                          <tr key={`${line.name}-${index}`} className="border-t border-border">
                            <td className="px-4 py-2"><p>{line.name}</p>{line.description ? <p className="text-xs text-muted-foreground">{line.description}</p> : null}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{line.quantity}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{money(line.rate)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{money(Number(line.quantity || 0) * Number(line.rate || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-1 border-t border-border px-4 py-3 text-sm">
                    {[["Subtotal", money(data.subtotal)], [data.taxName || `Tax (${data.taxRate || 0}%)`, money(data.taxAmount)], ...(Number(data.discount) ? [["Discount", `−${money(data.discount)}`]] : [])].map(([label, value]) => (
                      <div key={label} className="flex justify-end gap-10"><span className="text-muted-foreground">{label}</span><span className="w-32 text-right tabular-nums">{value}</span></div>
                    ))}
                    <div className="flex justify-end gap-10 font-semibold"><span>Total</span><span className="w-32 text-right tabular-nums">{money(data.amount)}</span></div>
                  </div>
                </section>
              ) : null}

              {data.attachmentUrl ? (
                <a href={data.attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-primary hover:underline">
                  <Paperclip size={15} />{data.attachmentName || "Attachment"}
                </a>
              ) : null}
            </>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {timeline.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="relative">
                  <span className="absolute -left-[26px] top-1 size-3 rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm">{entry.text}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock size={12} />{entry.at.slice(0, 16).replace("T", " ")}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
