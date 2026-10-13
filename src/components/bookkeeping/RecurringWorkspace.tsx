"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pause, Pencil, Play, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteBookkeepingRecord } from "@/app/actions";
import { runDueRecurringTransactions, setRecurringTemplateStatus, createFromRecurringTemplate } from "@/app/recurring-actions";
import MakeRecurringDialog from "@/components/bookkeeping/MakeRecurringDialog";
import { StatusBadge } from "@/components/crm/crm-shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount } from "@/lib/invoice-utils";
import { intervalLabel, recurringKindLabels, type RecurringKind } from "@/lib/recurring";

interface RecurringWorkspaceProps {
  templates: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
}

const kindPages: Record<RecurringKind, string> = { invoices: "invoices", bills: "bills", expenses: "expenses", journals: "journals" };

function templateAmount(template: BookkeepingRecord) {
  if (template.data.rtKind !== "journals") return Number(template.data.amount) || 0;
  try {
    const lines: unknown = JSON.parse(template.data.lines || "[]");
    return Array.isArray(lines) ? lines.reduce((sum: number, line) => sum + (Number((line as Record<string, string>)?.debit) || 0), 0) : 0;
  } catch {
    return 0;
  }
}

function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** Recurring transactions: the templates saved with "Make recurring", as in QuickBooks. */
export default function RecurringWorkspace({ templates, currency, asOfDate }: RecurringWorkspaceProps) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState("all");
  const [editing, setEditing] = useState<BookkeepingRecord | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const isDue = (template: BookkeepingRecord) => template.data.rtType !== "Unscheduled" && template.data.rtStatus === "Active" && Boolean(template.data.rtNext) && template.data.rtNext <= asOfDate;
  const due = templates.filter(isDue);
  const dueScheduled = due.filter((template) => template.data.rtType === "Scheduled");
  const rows = templates
    .filter((template) => kindFilter === "all" || template.data.rtKind === kindFilter)
    .sort((left, right) => Number(isDue(right)) - Number(isDue(left)) || (left.data.rtNext || "9999").localeCompare(right.data.rtNext || "9999") || (left.data.rtName || "").localeCompare(right.data.rtName || ""));

  async function run(key: string, task: () => Promise<void>) {
    setPending(key);
    try {
      await task();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const applyTemplate = (template: BookkeepingRecord) => run(template.id, async () => {
    const created = await createFromRecurringTemplate(template.id);
    toast.success(`${created.label} created from “${template.data.rtName}”.`, { action: { label: "Open", onClick: () => router.push(`/app/${kindPages[created.kind as RecurringKind] ?? created.kind}?open=${created.id}`) } });
  });

  const createDue = () => run("due", async () => {
    const result = await runDueRecurringTransactions();
    if (result.created.length) toast.success(`Created ${result.created.length} recurring ${result.created.length === 1 ? "transaction" : "transactions"}.`);
    if (result.errors.length) toast.error(result.errors.join(" "));
    if (!result.created.length && !result.errors.length) toast.message("Nothing was due.");
  });

  const remove = (template: BookkeepingRecord) => {
    if (!window.confirm(`Delete the template “${template.data.rtName}”? Transactions it already created stay.`)) return;
    void run(template.id, () => deleteBookkeepingRecord("recurring-transactions", template.id));
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounts / Lists</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Recurring transactions</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Invoices, bills, expenses and journal entries that repeat. Make one recurring from the transaction’s form with “Make recurring”.</p>
        </div>
      </section>

      {due.length ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">{due.length} recurring {due.length === 1 ? "transaction is" : "transactions are"} due</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Scheduled ones are created automatically in Automation mode. Create them now, or use a reminder to review it first.</p>
          </div>
          {dueScheduled.length ? <Button onClick={() => void createDue()} disabled={pending !== null}>{pending === "due" ? "Creating…" : `Create ${dueScheduled.length} scheduled now`}</Button> : null}
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Templates</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "template" : "templates"}</p>
          </div>
          <Select value={kindFilter} onValueChange={(value) => setKindFilter(value ?? "all")}>
            <SelectTrigger className="w-[170px]" aria-label="Transaction type"><SelectValue>{kindFilter === "all" ? "All types" : recurringKindLabels[kindFilter as RecurringKind]}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(recurringKindLabels).map(([kind, label]) => <SelectItem key={kind} value={kind}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {["Template name", "Type", "Txn type", "Interval", "Previous date", "Next date", "Customer / supplier", "Amount", "Status", "Action"].map((heading) => (
                  <TableHead key={heading} className={`whitespace-nowrap text-xs font-medium text-muted-foreground ${heading === "Amount" || heading === "Action" ? "text-right" : ""}`}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((template) => {
                const kind = template.data.rtKind as RecurringKind;
                const dueNow = isDue(template);
                const status = template.data.rtStatus === "Active" && dueNow ? "Due" : template.data.rtStatus || "Active";
                return (
                  <TableRow key={template.id}>
                    <TableCell className="max-w-[220px] text-[13px] font-medium"><span className="block truncate" title={template.data.rtName}>{template.data.rtName}</span></TableCell>
                    <TableCell className="text-[13px]">{template.data.rtType}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{recurringKindLabels[kind] ?? kind}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{template.data.rtType === "Unscheduled" ? "—" : intervalLabel(template.data.rtInterval, template.data.rtEvery)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{formatDate(template.data.rtLast)}</TableCell>
                    <TableCell className={`whitespace-nowrap text-[13px] ${dueNow ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{formatDate(template.data.rtNext)}</TableCell>
                    <TableCell className="max-w-[180px] text-[13px]"><span className="block truncate">{template.data.customer || template.data.vendor || template.data.payee || "—"}</span></TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{currencyAmount(templateAmount(template), template.data.currency || currency)}</TableCell>
                    <TableCell className="text-[13px]"><StatusBadge value={status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="link" size="sm" className="h-auto px-1" disabled={pending !== null || template.data.rtStatus === "Ended"} onClick={() => void applyTemplate(template)}>{pending === template.id ? "Creating…" : "Use"}</Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${template.data.rtName}`}><MoreHorizontal size={15} /></Button>} />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(template)}><Pencil size={14} />Edit schedule</DropdownMenuItem>
                            {template.data.rtStatus === "Paused" ? (
                              <DropdownMenuItem onClick={() => void run(template.id, () => setRecurringTemplateStatus(template.id, "Active"))}><Play size={14} />Resume</DropdownMenuItem>
                            ) : template.data.rtStatus === "Active" ? (
                              <DropdownMenuItem onClick={() => void run(template.id, () => setRecurringTemplateStatus(template.id, "Paused"))}><Pause size={14} />Pause</DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => remove(template)}><Trash2 size={14} />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 whitespace-normal text-center">
                    <Repeat size={22} className="mx-auto text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">{templates.length ? "No templates of this type" : "No recurring transactions yet"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Open an invoice, bill, expense or journal entry and choose “Make recurring” at the bottom.</p>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      {editing ? (
        <MakeRecurringDialog
          key={editing.id}
          open
          onOpenChange={(next) => { if (!next) setEditing(null); }}
          kind={editing.data.rtKind as RecurringKind}
          template={editing}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
