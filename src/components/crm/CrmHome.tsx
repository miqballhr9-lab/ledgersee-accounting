import Link from "next/link";
import { CalendarClock, CircleDollarSign, Handshake, ListTodo, Plus, Target, TrendingUp, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmTitle, crmModule, dealStages, isClosedStage, relatedHref } from "@/lib/crm-config";
import { formatDateTime, formatMoney, StatusBadge, type CrmStore } from "@/components/crm/crm-shared";

interface CrmHomeProps {
  store: CrmStore;
  currency: string;
  me: string;
  asOfDate: string;
}

function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href ? <Link href={href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">View all</Link> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function CrmHome({ store, currency, me, asOfDate }: CrmHomeProps) {
  const month = asOfDate.slice(0, 7);
  const leads = store["crm-leads"] ?? [];
  const deals = store["crm-deals"] ?? [];
  const tasks = store["crm-tasks"] ?? [];
  const meetings = store["crm-meetings"] ?? [];
  const calls = store["crm-calls"] ?? [];
  const openDeals = deals.filter((deal) => !isClosedStage(deal.data.stage));
  const wonThisMonth = deals.filter((deal) => deal.data.stage === "Closed Won" && (deal.data.closedOn || deal.data.closingDate || "").startsWith(month));
  const leadsThisMonth = leads.filter((lead) => lead.createdAt.startsWith(month));
  const converted = leads.filter((lead) => lead.data.leadStatus === "Converted").length;
  const openTasks = tasks.filter((task) => task.data.status !== "Completed").sort((a, b) => (a.data.dueDate || "9999").localeCompare(b.data.dueDate || "9999"));
  const myTasks = openTasks.filter((task) => !task.data.owner || task.data.owner === me);
  const overdueTasks = openTasks.filter((task) => task.data.dueDate && task.data.dueDate < asOfDate);
  const upcoming = [
    ...meetings.filter((meeting) => (meeting.data.from || "").slice(0, 10) >= asOfDate),
    ...calls.filter((call) => call.data.callStatus === "Scheduled" && (call.data.startTime || "").slice(0, 10) >= asOfDate),
  ].sort((a, b) => (a.data.from || a.data.startTime || "").localeCompare(b.data.from || b.data.startTime || "")).slice(0, 8);
  const closingThisMonth = openDeals.filter((deal) => (deal.data.closingDate || "").startsWith(month)).sort((a, b) => (a.data.closingDate || "").localeCompare(b.data.closingDate || ""));
  const pipeline = dealStages.filter((item) => !item.stage.startsWith("Closed")).map((item) => {
    const inStage = openDeals.filter((deal) => deal.data.stage === item.stage);
    return { stage: item.stage, count: inStage.length, amount: inStage.reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0) };
  });
  const maxStage = Math.max(1, ...pipeline.map((item) => item.amount));
  const sources = Object.entries(leads.reduce<Record<string, number>>((counts, lead) => {
    const source = lead.data.leadSource || "Not set";
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSource = Math.max(1, ...sources.map(([, count]) => count));
  const leadsModule = crmModule("leads")!;

  const kpis = [
    { label: "Open pipeline", value: formatMoney(openDeals.reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0), currency), note: `${openDeals.length} open deals`, icon: Handshake },
    { label: "Expected revenue", value: formatMoney(openDeals.reduce((sum, deal) => sum + Number(deal.data.expectedRevenue || 0), 0), currency), note: "Weighted by probability", icon: TrendingUp },
    { label: "Won this month", value: formatMoney(wonThisMonth.reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0), currency), note: `${wonThisMonth.length} deals`, icon: CircleDollarSign },
    { label: "New leads this month", value: String(leadsThisMonth.length), note: leads.length ? `${Math.round((converted / leads.length) * 100)}% of all leads converted` : "No leads yet", icon: Target },
    { label: "Open tasks", value: String(openTasks.length), note: overdueTasks.length ? `${overdueTasks.length} overdue` : "None overdue", icon: ListTodo },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">CRM / Home</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Welcome, {me.split(" ")[0] || "there"}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Your sales at a glance: pipeline, today&apos;s work and where your leads come from. Won deals turn into quotes and invoices in Sales.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href="/app/crm/activities?new=1" />}><Plus size={15} />Task</Button>
          <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href="/app/crm/deals?new=1" />}><Plus size={15} />Deal</Button>
          <Button className="gap-2" nativeButton={false} render={<Link href="/app/crm/leads?new=1" />}><UserPlus size={15} />Create lead</Button>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
            <div className="flex items-center justify-between gap-2 text-muted-foreground"><p className="text-xs">{kpi.label}</p><kpi.icon size={15} /></div>
            <p className="mt-1.5 text-xl font-semibold tabular-nums">{kpi.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.note}</p>
          </div>
        ))}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Pipeline by stage" href="/app/crm/deals">
          {openDeals.length ? (
            <ul className="space-y-3">
              {pipeline.map((item) => (
                <li key={item.stage}>
                  <div className="flex items-center justify-between gap-2 text-sm"><span>{item.stage} <span className="text-muted-foreground">({item.count})</span></span><span className="tabular-nums">{formatMoney(item.amount, currency)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(item.amount / maxStage) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No open deals yet. Convert a lead or create a deal." />}
        </Panel>

        <Panel title="My open tasks" href="/app/crm/activities">
          {myTasks.length ? (
            <ul className="divide-y divide-border">
              {myTasks.slice(0, 8).map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/app/crm/activities?open=${task.id}`} className="font-medium hover:underline">{task.data.subject}</Link>
                    <p className="truncate text-xs text-muted-foreground">{task.data.related ? `${task.data.relatedType}: ${task.data.related}` : "Not linked"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xs tabular-nums ${task.data.dueDate && task.data.dueDate < asOfDate ? "font-medium text-destructive" : "text-muted-foreground"}`}>{task.data.dueDate || "No due date"}</p>
                    <StatusBadge value={task.data.priority} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No open tasks. Nice work." />}
        </Panel>

        <Panel title="Upcoming meetings & calls" href="/app/crm/activities">
          {upcoming.length ? (
            <ul className="divide-y divide-border">
              {upcoming.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CalendarClock size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/crm/activities?open=${item.id}`} className="font-medium hover:underline">{item.data.title || item.data.subject}</Link>
                    <p className="truncate text-xs text-muted-foreground">{item.kind === "crm-calls" ? `${item.data.callType || ""} call` : item.data.location || "Meeting"}{item.data.related ? ` · ${item.data.related}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(item.data.from || item.data.startTime)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="Nothing scheduled." />}
        </Panel>

        <Panel title="Deals closing this month" href="/app/crm/deals">
          {closingThisMonth.length ? (
            <ul className="divide-y divide-border">
              {closingThisMonth.slice(0, 8).map((deal) => (
                <li key={deal.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={relatedHref("Deal", deal.id)} className="font-medium hover:underline">{deal.data.dealName}</Link>
                    <p className="truncate text-xs text-muted-foreground">{deal.data.account} · {deal.data.closingDate}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">{formatMoney(deal.data.amount, currency)}</p>
                    <StatusBadge value={deal.data.stage} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No open deals close this month." />}
        </Panel>

        <Panel title="Leads by source" href="/app/crm/leads">
          {sources.length ? (
            <ul className="space-y-3">
              {sources.map(([source, count]) => (
                <li key={source}>
                  <div className="flex items-center justify-between text-sm"><span>{source}</span><span className="tabular-nums">{count}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-chart-2" style={{ width: `${(count / maxSource) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No leads yet." />}
        </Panel>

        <Panel title="Recent leads" href="/app/crm/leads">
          {leads.length ? (
            <ul className="divide-y divide-border">
              {[...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map((lead: BookkeepingRecord) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={relatedHref("Lead", lead.id)} className="font-medium hover:underline">{crmTitle(leadsModule, lead.data)}</Link>
                    <p className="truncate text-xs text-muted-foreground">{lead.data.company}{lead.data.leadSource ? ` · ${lead.data.leadSource}` : ""}</p>
                  </div>
                  <StatusBadge value={lead.data.leadStatus} />
                </li>
              ))}
            </ul>
          ) : <Empty text="No leads yet." />}
        </Panel>
      </div>
    </div>
  );
}
