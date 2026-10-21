"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Handshake, LifeBuoy, ListTodo, Phone, PhoneCall, UserPlus, Users, X } from "lucide-react";

import { updateCrmField } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmModule, crmTitle, isClosedStage, relatedHref } from "@/lib/crm-config";
import { errorText, formatDateTime, formatMoney, StatusBadge, type CrmStore } from "@/components/crm/crm-shared";

interface CrmWorkqueueProps {
  initialStore: CrmStore;
  currency: string;
  me: string;
  owners: string[];
  /** Today in the business's time zone. */
  today: string;
  /** Settings: who may approve deals (comma separated); empty means anyone. */
  dealApprovers: string;
}

const EVERYONE = "__everyone__";
const priorityRank: Record<string, number> = { High: 0, Highest: 0, Medium: 1, Normal: 1, Low: 2, Lowest: 2 };

function plusDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function Panel({ title, icon: Icon, count, href, tone, children }: { title: string; icon: React.ElementType; count: number; href?: string; tone?: "bad"; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Icon size={15} className={tone === "bad" ? "text-destructive" : "text-primary"} />
          <span className="truncate">{title}</span>
          <span className={`rounded-full px-1.5 text-xs tabular-nums ${count && tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{count}</span>
        </h2>
        {href ? <Link href={href} className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline">View all</Link> : null}
      </div>
      <div className="max-h-[420px] min-h-0 flex-1 overflow-y-auto px-4 py-1">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

/** Zoho's Workqueue: what each salesperson has to do now, with one-click actions. */
export default function CrmWorkqueue({ initialStore, currency, me, owners, today, dealApprovers }: CrmWorkqueueProps) {
  const [store, setStore] = useState(initialStore);
  const [owner, setOwner] = useState(me);
  const [busy, setBusy] = useState<string | null>(null);
  const weekAhead = plusDays(today, 7);
  const mine = (record: BookkeepingRecord) => owner === EVERYONE || (record.data.owner || me) === owner;

  async function change(record: BookkeepingRecord, key: string, value: string, done: string) {
    setBusy(record.id);
    try {
      const [saved] = await updateCrmField(record.kind, [record.id], key, value);
      if (saved) setStore((current) => ({ ...current, [saved.kind]: (current[saved.kind] ?? []).map((row) => (row.id === saved.id ? saved : row)) }));
      toast.success(done);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  const tasks = (store["crm-tasks"] ?? []).filter((task) => task.data.status !== "Completed" && mine(task));
  const calls = (store["crm-calls"] ?? []).filter((call) => call.data.callStatus === "Scheduled" && mine(call));
  const meetings = (store["crm-meetings"] ?? []).filter(mine);
  const dayOf = (record: BookkeepingRecord) => (record.kind === "crm-tasks" ? record.data.dueDate || "" : (record.data.startTime || record.data.from || "").slice(0, 10));
  const timeOf = (record: BookkeepingRecord) => (record.kind === "crm-tasks" ? `${record.data.dueDate || ""}T23:59` : record.data.startTime || record.data.from || "");
  const byTime = (a: BookkeepingRecord, b: BookkeepingRecord) => timeOf(a).localeCompare(timeOf(b));

  const overdue = [...tasks, ...calls].filter((record) => dayOf(record) && dayOf(record) < today).sort(byTime);
  const dueToday = [...tasks, ...calls, ...meetings].filter((record) => dayOf(record) === today).sort(byTime);
  const comingUp = [...tasks, ...calls, ...meetings].filter((record) => dayOf(record) > today && dayOf(record) <= weekAhead).sort(byTime);
  const leads = (store["crm-leads"] ?? [])
    .filter((lead) => mine(lead) && ["Not Contacted", "Attempted to Contact", "Contact in Future"].includes(lead.data.leadStatus || "Not Contacted"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const openDeals = (store["crm-deals"] ?? []).filter((deal) => !isClosedStage(deal.data.stage) && mine(deal));
  const dealReason = (deal: BookkeepingRecord) => {
    const closing = deal.data.closingDate || "";
    if (closing && closing < today) return { text: `Closing date passed (${closing})`, bad: true };
    if (closing && closing <= weekAhead) return { text: `Closes ${closing === today ? "today" : closing}`, bad: false };
    if (!deal.data.nextStep?.trim()) return { text: "No next step", bad: false };
    return null;
  };
  const attentionDeals = openDeals.filter((deal) => dealReason(deal)).sort((a, b) => (a.data.closingDate || "9999").localeCompare(b.data.closingDate || "9999"));
  const approvers = dealApprovers.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const canApprove = !approvers.length || approvers.includes(me.trim().toLowerCase());
  const approvals = canApprove ? (store["crm-deals"] ?? []).filter((deal) => deal.data.approvalStatus === "Pending approval" && !isClosedStage(deal.data.stage)) : [];
  const cases = (store["crm-cases"] ?? []).filter((item) => item.data.status !== "Closed" && mine(item))
    .sort((a, b) => Number(b.data.status === "Escalated") - Number(a.data.status === "Escalated") || (priorityRank[a.data.priority] ?? 1) - (priorityRank[b.data.priority] ?? 1) || a.createdAt.localeCompare(b.createdAt));
  const leadsModule = crmModule("leads")!;

  const counts = [
    { label: "Overdue", value: overdue.length, icon: AlertTriangle, bad: overdue.length > 0 },
    { label: "Today", value: dueToday.length, icon: CalendarClock },
    { label: "Leads to contact", value: leads.length, icon: UserPlus },
    { label: "Deals to look at", value: attentionDeals.length + approvals.length, icon: Handshake },
    { label: "Open cases", value: cases.length, icon: LifeBuoy },
  ];

  /** One task, call or meeting with its quick action. */
  function activityRow(record: BookkeepingRecord, showDay: boolean) {
    const kind = record.kind === "crm-tasks" ? "Task" : record.kind === "crm-calls" ? `${record.data.callType || ""} call`.trim() : "Meeting";
    const start = record.data.startTime || record.data.from || "";
    const when = record.kind === "crm-tasks" ? (showDay ? record.data.dueDate : "") : showDay ? formatDateTime(start) : record.data.allDay === "true" ? "All day" : start.slice(11, 16);
    const late = dayOf(record) < today;
    return (
      <li key={record.id} className="flex items-center gap-3 py-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${late ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {record.kind === "crm-tasks" ? <ListTodo size={15} /> : record.kind === "crm-calls" ? <PhoneCall size={15} /> : <Users size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/app/crm/activities?open=${record.id}`} className="block truncate font-medium hover:underline">{record.data.subject || record.data.title || kind}</Link>
          <p className="truncate text-xs text-muted-foreground">
            {kind}{when ? ` · ${when}` : ""}{record.data.related ? ` · ${record.data.relatedType}: ${record.data.related}` : ""}{owner === EVERYONE && record.data.owner ? ` · ${record.data.owner}` : ""}
          </p>
        </div>
        {record.kind === "crm-tasks" ? (
          <Button type="button" size="xs" variant="outline" className="shrink-0 gap-1" disabled={busy === record.id} onClick={() => void change(record, "status", "Completed", "Task completed.")}><Check size={12} />Done</Button>
        ) : record.kind === "crm-calls" ? (
          <Button type="button" size="xs" variant="outline" className="shrink-0 gap-1" disabled={busy === record.id} onClick={() => void change(record, "callStatus", "Completed", "Call marked as completed.")}><Check size={12} />Done</Button>
        ) : null}
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">CRM / Workqueue</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Workqueue</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Everything waiting on {owner === EVERYONE ? "the team" : owner === me ? "you" : owner} today: late and due activities, leads to call, deals to move and cases to answer.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="workqueue-owner" className="text-sm text-muted-foreground">Showing</label>
          <Select value={owner} onValueChange={(value) => setOwner(String(value ?? me))}>
            <SelectTrigger id="workqueue-owner" className="min-w-44"><SelectValue>{owner === EVERYONE ? "Everyone" : owner === me ? `My work (${me})` : owner}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={me}>My work ({me})</SelectItem>
              {owners.filter((name) => name !== me).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              <SelectItem value={EVERYONE}>Everyone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {counts.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-muted-foreground"><p className="text-xs">{item.label}</p><item.icon size={15} className={item.bad ? "text-destructive" : ""} /></div>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${item.bad ? "text-destructive" : ""}`}>{item.value}</p>
          </div>
        ))}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Overdue" icon={AlertTriangle} count={overdue.length} tone="bad" href="/app/crm/activities">
          {overdue.length ? <ul className="divide-y divide-border">{overdue.map((record) => activityRow(record, true))}</ul> : <Empty text="Nothing overdue." />}
        </Panel>

        <Panel title="Today" icon={CalendarClock} count={dueToday.length} href="/app/crm/activities">
          {dueToday.length ? <ul className="divide-y divide-border">{dueToday.map((record) => activityRow(record, false))}</ul> : <Empty text="Nothing due today." />}
        </Panel>

        <Panel title="Leads to contact" icon={UserPlus} count={leads.length} href="/app/crm/leads">
          {leads.length ? (
            <ul className="divide-y divide-border">
              {leads.map((lead) => (
                <li key={lead.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={relatedHref("Lead", lead.id)} className="block truncate font-medium hover:underline">{crmTitle(leadsModule, lead.data)}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[lead.data.company, lead.data.leadSource, `added ${lead.createdAt.slice(0, 10)}`, owner === EVERYONE ? lead.data.owner : ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <StatusBadge value={lead.data.leadStatus || "Not Contacted"} />
                  {lead.data.mobile || lead.data.phone ? (
                    <Button size="icon-xs" variant="ghost" className="shrink-0" nativeButton={false} render={<a href={`tel:${lead.data.mobile || lead.data.phone}`} aria-label={`Call ${crmTitle(leadsModule, lead.data)}`} />}><Phone size={13} /></Button>
                  ) : null}
                  <Button type="button" size="xs" variant="outline" className="shrink-0 gap-1" disabled={busy === lead.id} onClick={() => void change(lead, "leadStatus", "Contacted", "Lead marked as contacted.")}><Check size={12} />Contacted</Button>
                </li>
              ))}
            </ul>
          ) : <Empty text="No leads waiting for a first contact." />}
        </Panel>

        <Panel title="Deals to look at" icon={Handshake} count={attentionDeals.length + approvals.length} href="/app/crm/deals">
          {approvals.length || attentionDeals.length ? (
            <ul className="divide-y divide-border">
              {approvals.map((deal) => (
                <li key={`approve-${deal.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={relatedHref("Deal", deal.id)} className="block truncate font-medium hover:underline">{deal.data.dealName}</Link>
                    <p className="truncate text-xs text-muted-foreground">Waiting for approval · {deal.data.account}{deal.data.owner ? ` · ${deal.data.owner}` : ""}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatMoney(deal.data.amount, currency)}</span>
                  <div className="flex gap-1">
                    <Button type="button" size="xs" className="gap-1" disabled={busy === deal.id} onClick={() => void change(deal, "approvalStatus", "Approved", "Deal approved.")}><CheckCircle2 size={12} />Approve</Button>
                    <Button type="button" size="xs" variant="outline" className="gap-1 text-destructive" disabled={busy === deal.id} onClick={() => void change(deal, "approvalStatus", "Rejected", "Deal rejected.")}><X size={12} />Reject</Button>
                  </div>
                </li>
              ))}
              {attentionDeals.map((deal) => {
                const reason = dealReason(deal)!;
                return (
                  <li key={deal.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={relatedHref("Deal", deal.id)} className="block truncate font-medium hover:underline">{deal.data.dealName}</Link>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className={reason.bad ? "font-medium text-destructive" : ""}>{reason.text}</span>{deal.data.account ? ` · ${deal.data.account}` : ""}{owner === EVERYONE && deal.data.owner ? ` · ${deal.data.owner}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium tabular-nums">{formatMoney(deal.data.amount, currency)}</p>
                      <StatusBadge value={deal.data.stage} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty text="No deals need attention." />}
        </Panel>

        <Panel title="Open cases" icon={LifeBuoy} count={cases.length} href="/app/crm/cases">
          {cases.length ? (
            <ul className="divide-y divide-border">
              {cases.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={relatedHref("Case", item.id)} className="block truncate font-medium hover:underline">{item.data.caseNumber ? `${item.data.caseNumber} · ` : ""}{item.data.subject}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[item.data.account, item.data.priority ? `${item.data.priority} priority` : "", `opened ${item.createdAt.slice(0, 10)}`, owner === EVERYONE ? item.data.owner : ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <StatusBadge value={item.data.status} />
                </li>
              ))}
            </ul>
          ) : <Empty text="No open cases." />}
        </Panel>

        <Panel title="Coming up this week" icon={CalendarClock} count={comingUp.length} href="/app/crm/activities">
          {comingUp.length ? <ul className="divide-y divide-border">{comingUp.map((record) => activityRow(record, true))}</ul> : <Empty text="Nothing planned for the next 7 days." />}
        </Panel>
      </div>
    </div>
  );
}
