"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, Check, X, FilePlus2, FileText, Mail, Pencil, Phone, Plus, RefreshCcw, StickyNote, Trash2, UserCheck } from "lucide-react";

import { addCrmNote, createDocumentFromDeal, deleteCrmRecords, sendCrmEmail, updateCrmField } from "@/app/crm-actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmModule, crmModuleByKind, dealStages, parseHistory, type CrmModule, type CrmModuleKey } from "@/lib/crm-config";
import {
  activitiesFor,
  activityWhen,
  displayValue,
  errorText,
  formatMoney,
  Initials,
  isOpenActivity,
  recordTitle,
  StatusBadge,
  type CrmContextValue,
} from "@/components/crm/crm-shared";

interface CrmRecordDetailProps {
  record: BookkeepingRecord | null;
  context: CrmContextValue;
  onClose: () => void;
  onOpenRecord: (record: BookkeepingRecord) => void;
  onEdit: (mod: CrmModule, record: BookkeepingRecord) => void;
  onCreate: (mod: CrmModule, preset: Record<string, string>) => void;
  onConvert: (lead: BookkeepingRecord) => void;
  /** Reloads server data after changes that touch Sales (quotes, invoices). */
  onRefresh: () => void;
}

const relatedTypeOf: Record<string, string> = {
  customers: "Account",
  "crm-leads": "Lead",
  "crm-contacts": "Contact",
  "crm-deals": "Deal",
  "crm-campaigns": "Campaign",
  "crm-cases": "Case",
};

function Section({ title, count, actions, children }: { title: string; count?: number; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}{count !== undefined ? <span className="ml-1.5 text-muted-foreground">({count})</span> : null}</h3>
        {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function RelatedRows({ rows, columns, onOpen, empty }: { rows: BookkeepingRecord[]; columns: { label: string; value: (record: BookkeepingRecord) => React.ReactNode }[]; onOpen?: (record: BookkeepingRecord) => void; empty: string }) {
  if (!rows.length) return <p className="py-1 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground">{columns.map((column) => <th key={column.label} className="px-4 py-1.5 font-medium">{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`border-t border-border ${onOpen ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => onOpen?.(row)}>
              {columns.map((column) => <td key={column.label} className="px-4 py-2">{column.value(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CrmRecordDetail({ record, context, onClose, onOpenRecord, onEdit, onCreate, onConvert, onRefresh }: CrmRecordDetailProps) {
  const [tab, setTab] = useState<"overview" | "related" | "timeline">("overview");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState<{ subject: string; body: string } | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((record?.id ?? null) !== shownId) {
    setShownId(record?.id ?? null);
    setTab("overview");
    setNote("");
  }

  const { store, currency } = context;
  const mod = record ? crmModuleByKind(record.kind) : undefined;
  const isAccount = record?.kind === "customers";

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  if (!record) return <Sheet open={false} />;
  const data = record.data;
  const title = recordTitle(record);
  const relatedType = relatedTypeOf[record.kind] ?? "";
  const activities = activitiesFor(store, record);
  const openActivities = activities.filter(isOpenActivity).sort((a, b) => activityWhen(a).localeCompare(activityWhen(b)));
  const closedActivities = activities.filter((item) => !isOpenActivity(item)).sort((a, b) => activityWhen(b).localeCompare(activityWhen(a)));
  const notes = (store["crm-notes"] ?? []).filter((item) => item.data.parentId === record.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const accountName = isAccount ? data.name?.trim().toLowerCase() : "";
  const deals = (store["crm-deals"] ?? []).filter((deal) =>
    (isAccount && deal.data.accountId === record.id) ||
    (record.kind === "crm-contacts" && deal.data.contactId === record.id) ||
    (record.kind === "crm-campaigns" && deal.data.campaignId === record.id));
  const contacts = isAccount ? (store["crm-contacts"] ?? []).filter((contact) => contact.data.accountId === record.id) : [];
  const leads = record.kind === "crm-campaigns" ? (store["crm-leads"] ?? []).filter((lead) => lead.data.campaignId === record.id) : [];
  const cases = (store["crm-cases"] ?? []).filter((item) =>
    (isAccount && item.data.accountId === record.id) ||
    (record.kind === "crm-contacts" && item.data.contactId === record.id) ||
    (record.kind === "crm-deals" && item.data.dealId === record.id));
  const salesDocs = [...(store.estimates ?? []), ...(store.invoices ?? [])].filter((doc) =>
    (isAccount && (doc.data.customerId === record.id || doc.data.customer?.trim().toLowerCase() === accountName)) ||
    (record.kind === "crm-deals" && doc.data.crmDealId === record.id));
  const invoices = salesDocs.filter((doc) => doc.kind === "invoices");
  const invoiced = invoices.reduce((sum, doc) => sum + Number(doc.data.amount || 0), 0);
  const outstanding = invoices.filter((doc) => !["Paid", "Cancelled", "Draft"].includes(doc.data.status ?? "")).reduce((sum, doc) => sum + Math.max(0, Number(doc.data.amount || 0) - Number(doc.data.paidAmount || 0) - Number(doc.data.creditApplied || 0)), 0);
  const activityPreset: Record<string, string> = { relatedType, relatedId: record.id, related: title };
  if (record.kind === "crm-contacts") Object.assign(activityPreset, { contactId: record.id, contact: title });
  if (record.kind === "crm-deals" && data.contactId) Object.assign(activityPreset, { contactId: data.contactId, contact: data.contact });
  const statusValue = mod?.statusKey ? data[mod.statusKey] : undefined;
  const phone = data.phone || data.mobile;

  const activityColumns = [
    { label: "Type", value: (row: BookkeepingRecord) => (row.kind === "crm-tasks" ? "Task" : row.kind === "crm-calls" ? "Call" : "Meeting") },
    { label: "Subject", value: (row: BookkeepingRecord) => <span className="font-medium">{recordTitle(row)}</span> },
    { label: "When", value: (row: BookkeepingRecord) => activityWhen(row) || "—" },
    { label: "Status", value: (row: BookkeepingRecord) => <StatusBadge value={row.data.status || row.data.callStatus || (isOpenActivity(row) ? "Upcoming" : "Held")} /> },
    { label: "Owner", value: (row: BookkeepingRecord) => row.data.owner || "—" },
  ];

  const newActivityButtons = (["tasks", "meetings", "calls"] as CrmModuleKey[]).map((key) => {
    const target = crmModule(key)!;
    return <Button key={key} type="button" size="xs" variant="outline" className="gap-1" onClick={() => onCreate(target, activityPreset)}><Plus size={12} />{target.label}</Button>;
  });

  const timeline = [
    ...parseHistory(data.history).map((entry) => ({ at: entry.at, text: entry.text, by: entry.by })),
    ...notes.map((item) => ({ at: item.data.createdOn || item.createdAt.slice(0, 16).replace("T", " "), text: `Note added: ${item.data.content.slice(0, 120)}`, by: item.data.author || "" })),
    ...activities.map((item) => ({ at: item.createdAt.slice(0, 16).replace("T", " "), text: `${item.kind === "crm-tasks" ? "Task" : item.kind === "crm-calls" ? "Call" : "Meeting"} added: ${recordTitle(item)}`, by: item.data.owner || "" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!parseHistory(data.history).length) timeline.push({ at: record.createdAt.slice(0, 16).replace("T", " "), text: `${mod?.label ?? "Account"} created`, by: "" });

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <Initials name={title} className="size-11 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{mod?.label ?? "Account"}</p>
              <SheetTitle className="mt-0.5 truncate text-xl">{title}</SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {statusValue ? <StatusBadge value={statusValue} /> : null}
                {data.company && record.kind === "crm-leads" ? <span>{data.company}</span> : null}
                {data.account ? <span>{data.account}</span> : null}
                {record.kind === "crm-deals" ? <span className="font-medium text-foreground">{formatMoney(data.amount, currency)}</span> : null}
                {data.owner ? <span>Owner: {data.owner}</span> : null}
              </SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {mod ? <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(mod, record)}><Pencil size={14} />Edit</Button> : <Button size="sm" variant="outline" className="gap-1.5" nativeButton={false} render={<Link href="/app/customers" />}><Pencil size={14} />Edit in Customers</Button>}
            {record.kind === "crm-leads" && data.leadStatus !== "Converted" ? <Button type="button" size="sm" className="gap-1.5" onClick={() => onConvert(record)}><UserCheck size={14} />Convert</Button> : null}
            {record.kind === "crm-deals" ? (
              <>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void act("quote", async () => {
                  const result = await createDocumentFromDeal(record.id, "estimates");
                  toast.success(`Quote ${result.number} created in Sales → Estimates.`);
                  onRefresh();
                })}><FilePlus2 size={14} />Create quote</Button>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void act("invoice", async () => {
                  const result = await createDocumentFromDeal(record.id, "invoices");
                  toast.success(`Invoice ${result.number} created as a draft in Sales → Invoices.`);
                  onRefresh();
                })}><FileText size={14} />Create invoice</Button>
              </>
            ) : null}
            {data.email ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEmail({ subject: "", body: `Hello ${data.firstName || data.fullName || data.name || ""},\n\n` })}><Mail size={14} />Send email</Button> : null}
            {phone ? <Button size="sm" variant="outline" className="gap-1.5" nativeButton={false} render={<a href={`tel:${phone}`} />}><Phone size={14} />Call</Button> : null}
            {mod?.quickActions?.filter((action) => data[action.key] !== action.value).map((action) => (
              <Button key={action.label} type="button" size="sm" variant={action.tone === "primary" ? "default" : "outline"} className={`gap-1.5 ${action.tone === "danger" ? "text-destructive hover:text-destructive" : ""}`} disabled={Boolean(busy)} onClick={() => void act(action.label, async () => {
                context.upsert(await updateCrmField(record.kind, [record.id], action.key, action.value));
                toast.success(`${mod.label}: ${action.value}.`);
                onRefresh();
              })}>{action.tone === "danger" ? <X size={14} /> : <Check size={14} />}{action.label}</Button>
            ))}
            {record.kind === "crm-tasks" && data.status !== "Completed" ? (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void act("complete", async () => {
                context.upsert(await updateCrmField("crm-tasks", [record.id], "status", "Completed"));
                toast.success("Task marked as completed.");
              })}><Check size={14} />Mark completed</Button>
            ) : null}
            {mod ? (
              <Button type="button" size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={Boolean(busy)} onClick={() => {
                if (!window.confirm(`Delete ${mod.label.toLowerCase()} “${title}”? Its notes are deleted too.`)) return;
                void act("delete", async () => {
                  await deleteCrmRecords(record.kind, [record.id]);
                  context.remove(record.kind, [record.id]);
                  toast.success(`${mod.label} deleted.`);
                  onClose();
                });
              }}><Trash2 size={14} />Delete</Button>
            ) : null}
          </div>
          {record.kind === "crm-leads" && data.leadStatus === "Converted" ? (
            <p className="mt-3 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">Converted on {data.convertedOn} to account <span className="font-medium">{data.convertedAccount}</span>.</p>
          ) : null}
        </SheetHeader>

        {record.kind === "crm-deals" ? (
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-5 py-3">
            {dealStages.map((item) => {
              const current = data.stage === item.stage;
              return (
                <button key={item.stage} type="button" disabled={Boolean(busy) || current} title={`${item.stage} · ${item.probability}%`}
                  onClick={() => void act("stage", async () => {
                    context.upsert(await updateCrmField("crm-deals", [record.id], "stage", item.stage));
                    toast.success(`Stage changed to ${item.stage}.`);
                  })}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                  {item.stage}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="flex shrink-0 gap-1 border-b border-border px-5 pt-2">
          {([["overview", "Overview"], ["related", "Related"], ["timeline", "Timeline"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {tab === "overview" ? (
            <>
              {isAccount || record.kind === "crm-deals" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {(isAccount
                    ? [["Open deals", formatMoney(deals.filter((deal) => !deal.data.stage?.startsWith("Closed")).reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0), currency)], ["Invoiced", formatMoney(invoiced, currency)], ["Outstanding", formatMoney(outstanding, currency)]]
                    : [["Amount", formatMoney(data.amount, currency)], ["Probability", `${data.probability || 0}%`], ["Expected revenue", formatMoney(data.expectedRevenue, currency)]]
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {mod ? [...new Set(mod.fields.map((field) => field.section))].map((section) => (
                <Section key={section} title={section}>
                  <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                    {mod.fields.filter((field) => field.section === section).map((field) => {
                      const value = displayValue(field, data, field.key, currency);
                      const lookupHref = field.type === "account" && data.accountId ? { kind: "customers", id: data.accountId }
                        : field.type === "contact" && data[`${field.key}Id`] ? { kind: "crm-contacts", id: data[`${field.key}Id`] }
                        : field.type === "deal" && data.dealId ? { kind: "crm-deals", id: data.dealId }
                        : field.type === "campaign" && data.campaignId ? { kind: "crm-campaigns", id: data.campaignId } : null;
                      const target = lookupHref ? store[lookupHref.kind]?.find((item) => item.id === lookupHref.id) : field.type === "related" && data.relatedId ? Object.values(store).flat().find((item) => item.id === data.relatedId) : undefined;
                      return (
                        <div key={field.key} className={`min-w-0 ${field.wide ? "sm:col-span-2" : ""}`}>
                          <dt className="text-xs text-muted-foreground">{field.label}</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                            {target ? <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => onOpenRecord(target)}>{value}</button>
                              : field.type === "select" && field.key === mod.statusKey ? <StatusBadge value={value} />
                              : field.type === "email" && value ? <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${value}`}>{value}</a>
                              : field.type === "file" && data[field.key] ? <a className="text-primary underline-offset-4 hover:underline" href={data[field.key]} target="_blank" rel="noreferrer">{value}</a>
                              : field.type === "url" && value ? <a className="text-primary underline-offset-4 hover:underline" href={/^https?:/.test(value) ? value : `https://${value}`} target="_blank" rel="noreferrer">{value}</a>
                              : value || <span className="text-muted-foreground">—</span>}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </Section>
              )) : (
                <Section title="Account information">
                  <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                    {([["Account name", data.name], ["Company", data.company], ["Email", data.email], ["Phone", data.phone], ["Mobile", data.mobile], ["Website", data.website], ["Payment terms", data.paymentTerms], ["Tax ID", data.taxId], ["Billing address", [data.address, data.city, data.state, data.postalCode, data.country].filter(Boolean).join(", ")]] as const).map(([label, value]) => (
                      <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm">{value || <span className="text-muted-foreground">—</span>}</dd></div>
                    ))}
                  </dl>
                </Section>
              )}
            </>
          ) : null}

          {tab === "related" ? (
            <>
              <Section title="Notes" count={notes.length}>
                <div className="space-y-2">
                  <Textarea rows={2} value={note} placeholder="Add a note…" onChange={(event) => setNote(event.target.value)} />
                  <div className="flex justify-end">
                    <Button type="button" size="sm" className="gap-1.5" disabled={!note.trim() || Boolean(busy)} onClick={() => void act("note", async () => {
                      const saved = await addCrmNote(record.kind, record.id, "", note);
                      context.upsert([saved]);
                      setNote("");
                    })}><StickyNote size={14} />Save note</Button>
                  </div>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {notes.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap break-words text-sm">{item.data.content}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.data.author} · {item.data.createdOn}</p>
                      </div>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Delete note" disabled={Boolean(busy)} onClick={() => void act("note-delete", async () => {
                        await deleteCrmRecords("crm-notes", [item.id]);
                        context.remove("crm-notes", [item.id]);
                      })}><Trash2 size={14} /></Button>
                    </li>
                  ))}
                </ul>
              </Section>
              {mod?.section === "hr" ? null : <>
              <Section title="Open activities" count={openActivities.length} actions={newActivityButtons}>
                <RelatedRows rows={openActivities} columns={activityColumns} onOpen={onOpenRecord} empty="No open activities. Add a task, meeting or call." />
              </Section>
              <Section title="Closed activities" count={closedActivities.length}>
                <RelatedRows rows={closedActivities} columns={activityColumns} onOpen={onOpenRecord} empty="Nothing closed yet." />
              </Section>
              </>}
              {isAccount ? (
                <Section title="Contacts" count={contacts.length} actions={<Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => onCreate(crmModule("contacts")!, { accountId: record.id, account: title })}><Plus size={12} />Contact</Button>}>
                  <RelatedRows rows={contacts} onOpen={onOpenRecord} empty="No contacts at this account yet." columns={[
                    { label: "Name", value: (row) => <span className="font-medium">{recordTitle(row)}</span> },
                    { label: "Title", value: (row) => row.data.title || "—" },
                    { label: "Email", value: (row) => row.data.email || "—" },
                    { label: "Phone", value: (row) => row.data.phone || row.data.mobile || "—" },
                  ]} />
                </Section>
              ) : null}
              {isAccount || record.kind === "crm-contacts" || record.kind === "crm-campaigns" ? (
                <Section title="Deals" count={deals.length} actions={isAccount || record.kind === "crm-contacts" ? <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => onCreate(crmModule("deals")!, isAccount ? { accountId: record.id, account: title } : { contactId: record.id, contact: title, accountId: data.accountId ?? "", account: data.account ?? "" })}><Plus size={12} />Deal</Button> : undefined}>
                  <RelatedRows rows={deals} onOpen={onOpenRecord} empty="No deals yet." columns={[
                    { label: "Deal name", value: (row) => <span className="font-medium">{row.data.dealName}</span> },
                    { label: "Amount", value: (row) => formatMoney(row.data.amount, currency) },
                    { label: "Stage", value: (row) => <StatusBadge value={row.data.stage} /> },
                    { label: "Closing date", value: (row) => row.data.closingDate || "—" },
                  ]} />
                </Section>
              ) : null}
              {record.kind === "crm-campaigns" ? (
                <Section title="Leads" count={leads.length}>
                  <RelatedRows rows={leads} onOpen={onOpenRecord} empty="No leads from this campaign yet." columns={[
                    { label: "Lead name", value: (row) => <span className="font-medium">{recordTitle(row)}</span> },
                    { label: "Company", value: (row) => row.data.company || "—" },
                    { label: "Status", value: (row) => <StatusBadge value={row.data.leadStatus} /> },
                  ]} />
                </Section>
              ) : null}
              {isAccount || record.kind === "crm-contacts" || record.kind === "crm-deals" ? (
                <Section title="Cases" count={cases.length} actions={<Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => onCreate(crmModule("cases")!, isAccount ? { accountId: record.id, account: title } : record.kind === "crm-contacts" ? { contactId: record.id, contact: title, accountId: data.accountId ?? "", account: data.account ?? "" } : { dealId: record.id, deal: title, accountId: data.accountId ?? "", account: data.account ?? "" })}><Plus size={12} />Case</Button>}>
                  <RelatedRows rows={cases} onOpen={onOpenRecord} empty="No cases." columns={[
                    { label: "Case", value: (row) => row.data.caseNumber || "—" },
                    { label: "Subject", value: (row) => <span className="font-medium">{row.data.subject}</span> },
                    { label: "Status", value: (row) => <StatusBadge value={row.data.status} /> },
                    { label: "Priority", value: (row) => row.data.priority || "—" },
                  ]} />
                </Section>
              ) : null}
              {isAccount || record.kind === "crm-deals" ? (
                <Section title="Quotes & invoices" count={salesDocs.length}>
                  <RelatedRows rows={salesDocs} empty={record.kind === "crm-deals" ? "Use Create quote or Create invoice above." : "No quotes or invoices for this account yet."} columns={[
                    { label: "Type", value: (row) => (row.kind === "invoices" ? "Invoice" : "Quote") },
                    { label: "Number", value: (row) => <Link className="font-medium text-primary underline-offset-4 hover:underline" href={row.kind === "invoices" ? "/app/invoices" : "/app/estimates"}>{row.data.invoiceNumber || row.data.estimateNumber}</Link> },
                    { label: "Date", value: (row) => row.data.issueDate || row.data.date || "—" },
                    { label: "Amount", value: (row) => formatMoney(row.data.amount, currency) },
                    { label: "Status", value: (row) => <StatusBadge value={row.data.status} /> },
                  ]} />
                </Section>
              ) : null}
            </>
          ) : null}

          {tab === "timeline" ? (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {timeline.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="relative">
                  <span className="absolute -left-[26px] top-1 grid size-3 place-items-center rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm">{entry.text}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock size={12} />{entry.at}{entry.by ? ` · ${entry.by}` : ""}</p>
                </li>
              ))}
              <li className="relative text-xs text-muted-foreground"><RefreshCcw size={12} className="mr-1 inline" />Last modified {record.updatedAt.slice(0, 16).replace("T", " ")}</li>
            </ol>
          ) : null}
        </div>
      </SheetContent>
      <Dialog open={Boolean(email)} onOpenChange={(next) => { if (!next && busy !== "email") setEmail(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send email</DialogTitle>
            <DialogDescription>To {data.email}. A copy is kept in this record&apos;s notes; replies come to your email.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="crm-email-subject">Subject</Label><Input id="crm-email-subject" value={email?.subject ?? ""} onChange={(event) => setEmail((current) => (current ? { ...current, subject: event.target.value } : current))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="crm-email-body">Message</Label><Textarea id="crm-email-body" rows={8} value={email?.body ?? ""} onChange={(event) => setEmail((current) => (current ? { ...current, body: event.target.value } : current))} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEmail(null)}>Cancel</Button>
            <Button type="button" disabled={busy === "email" || !email?.subject.trim() || !email?.body.trim()} onClick={() => void act("email", async () => {
              if (!email) return;
              const saved = await sendCrmEmail(record.kind, record.id, email.subject, email.body);
              context.upsert([saved]);
              setEmail(null);
              toast.success(`Email sent to ${data.email}.`);
              onRefresh?.();
            })}>{busy === "email" ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
