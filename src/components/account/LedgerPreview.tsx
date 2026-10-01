"use client";

import { useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  FileText,
  LayoutDashboard,
  ReceiptText,
  Search,
  ShoppingBag,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

 type PreviewSection = "dashboard" | "invoices" | "expenses";

const navigation: { id: PreviewSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "invoices", label: "Invoices", icon: ReceiptText },
  { id: "expenses", label: "Expenses", icon: Wallet },
];

const invoices = [
  { number: "INV-1048", customer: "Northstar Studio", date: "Sep 28, 2026", due: "Oct 12, 2026", amount: "$2,450.00", status: "Sent" },
  { number: "INV-1047", customer: "Morrow & Co.", date: "Sep 24, 2026", due: "Oct 08, 2026", amount: "$1,875.00", status: "Overdue" },
  { number: "INV-1046", customer: "Fieldwork Creative", date: "Sep 21, 2026", due: "Oct 05, 2026", amount: "$3,200.00", status: "Paid" },
  { number: "INV-1045", customer: "Juniper House", date: "Sep 18, 2026", due: "Oct 02, 2026", amount: "$960.00", status: "Partially paid" },
];

const expenses = [
  { vendor: "Harbor Office Supply", category: "Office supplies", date: "Sep 29, 2026", account: "Business checking", amount: "$184.50" },
  { vendor: "Cloudline Hosting", category: "Software", date: "Sep 27, 2026", account: "Business card", amount: "$89.00" },
  { vendor: "Market Street Cafe", category: "Meals", date: "Sep 25, 2026", account: "Business card", amount: "$62.40" },
  { vendor: "Metro Courier Co.", category: "Shipping", date: "Sep 22, 2026", account: "Business checking", amount: "$128.75" },
];

const monthlyTotals = [
  { month: "Apr", income: 64, expenses: 38 },
  { month: "May", income: 80, expenses: 49 },
  { month: "Jun", income: 70, expenses: 44 },
  { month: "Jul", income: 92, expenses: 56 },
  { month: "Aug", income: 76, expenses: 51 },
  { month: "Sep", income: 100, expenses: 59 },
];

export default function LedgerPreview({ onCreateAccount }: { onCreateAccount: () => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<PreviewSection>("dashboard");

  function createAccount() {
    setOpen(false);
    onCreateAccount();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" variant="outline" className="mt-5 h-10 w-full gap-2 border-primary/20 bg-accent/45 text-foreground hover:bg-accent/70" />}
      >
        <LayoutDashboard size={16} />
        Preview the sample workspace
        <ArrowRight size={15} className="ml-auto" />
      </DialogTrigger>
      <DialogContent
        showCloseButton
        className="flex h-[min(900px,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 shadow-2xl sm:h-[min(900px,calc(100dvh-3rem))] sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar text-sidebar-primary"><BriefcaseBusiness size={17} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <DialogTitle className="text-sm font-semibold tracking-tight">Hisaavora</DialogTitle>
                <span className="rounded-full border border-accent bg-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">Sample preview</span>
              </div>
              <DialogDescription className="mt-1 hidden text-xs sm:block">Browse a read-only example workspace. Nothing here is saved.</DialogDescription>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <Sparkles size={14} className="text-primary" />
            Example business · USD
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="hidden w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground md:flex">
            <div className="px-3 pb-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/55">Workspace</div>
            <nav aria-label="Sample workspace" className="space-y-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSection(item.id)}
                    className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"}`}
                  >
                    <Icon size={16} strokeWidth={1.7} />
                    <span className="flex-1">{item.label}</span>
                    {active ? <span className="h-5 w-0.5 rounded-full bg-sidebar-primary" /> : null}
                  </button>
                );
              })}
            </nav>
            <div className="mt-auto rounded-lg border border-sidebar-border bg-sidebar-accent/55 p-3">
              <p className="text-xs font-medium text-sidebar-accent-foreground">Just looking around?</p>
              <p className="mt-1 text-[11px] leading-4 text-sidebar-foreground/65">This workspace uses made-up example records.</p>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6">
              <nav aria-label="Preview sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSection(item.id)}
                      className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors md:hidden ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <Icon size={14} />{item.label}
                    </button>
                  );
                })}
                <div className="hidden items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground sm:flex">
                  <Search size={14} /> Search this sample
                  <span className="ml-3 rounded border border-border px-1.5 py-0.5 text-[10px]">⌘ K</span>
                </div>
              </nav>
              <Button type="button" variant="ghost" size="sm" className="hidden shrink-0 gap-2 text-xs text-muted-foreground sm:inline-flex">
                <CircleHelp size={14} /> Help
              </Button>
            </div>

            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
              <div className="mx-auto w-full max-w-5xl">
                {section === "dashboard" ? <DashboardPreview /> : null}
                {section === "invoices" ? <InvoicesPreview /> : null}
                {section === "expenses" ? <ExpensesPreview /> : null}
              </div>
            </main>
          </section>
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Sample data only.</span> Your preview won’t create an account or save changes.</p>
          <Button type="button" onClick={createAccount} className="h-9 shrink-0 gap-2">
            Create your account
            <ArrowRight size={15} />
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function DashboardPreview() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">Monday, September 30, 2026</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">Good morning, Ayesha</h2>
          <p className="mt-1 text-sm text-muted-foreground">Here’s a snapshot of your business.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2 text-xs"><CalendarDays size={14} /> This month <ChevronDown size={13} /></Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Total income" value="$24,850" change="12.8%" positive icon={ArrowUpRight} />
        <Metric label="Total expenses" value="$9,420" change="4.2%" positive={false} icon={ArrowDownRight} />
        <Metric label="Net profit" value="$15,430" change="18.6%" positive icon={ChartNoAxesCombined} />
        <Metric label="Receivables" value="$6,780" note="4 invoices due" icon={Banknote} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.85fr)]">
        <section className="min-w-0 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
            <div><h3 className="text-sm font-semibold">Income vs. expenses</h3><p className="mt-1 text-xs text-muted-foreground">A six-month example overview</p></div>
            <ChartNoAxesCombined size={16} className="text-muted-foreground" />
          </div>
          <div className="px-4 pb-3 pt-5 sm:px-5">
            <div className="flex h-40 items-end justify-between gap-2 sm:h-48 sm:gap-4">
              {monthlyTotals.map((month) => (
                <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <div className="flex h-full w-full items-end justify-center gap-1.5">
                    <span className="w-[min(34%,22px)] rounded-t-sm bg-chart-1" style={{ height: `${month.income}%` }} />
                    <span className="w-[min(34%,22px)] rounded-t-sm bg-chart-2" style={{ height: `${month.expenses}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground sm:text-xs">{month.month}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-center gap-5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-chart-1" />Income</span>
              <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-chart-2" />Expenses</span>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5 sm:px-5">
            <div><h3 className="text-sm font-semibold">Recent invoices</h3><p className="mt-1 text-xs text-muted-foreground">Example activity</p></div>
            <FileText size={16} className="text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {invoices.slice(0, 3).map((invoice) => (
              <div key={invoice.number} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><ReceiptText size={14} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{invoice.customer}</span><span className="mt-1 block text-[10px] text-muted-foreground">{invoice.number}</span></span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{invoice.amount}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">Example figures for preview only</div>
        </section>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent/35 px-4 py-3 text-xs leading-5 text-accent-foreground">
        <Sparkles size={16} className="shrink-0" />
        <p>This is a sample dashboard. Your own totals appear after you create an account and add records.</p>
      </div>
    </div>
  );
}

function InvoicesPreview() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-medium text-primary">Sales</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h2><p className="mt-1 text-sm text-muted-foreground">Track what’s billed and what’s still due.</p></div>
        <Button type="button" size="sm" className="gap-2" disabled><ReceiptText size={14} /> New invoice</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Total invoiced" value="$8,485" />
        <SummaryTile label="Collected" value="$3,200" />
        <SummaryTile label="Outstanding" value="$5,285" />
        <SummaryTile label="Overdue" value="$1,875" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div><h3 className="text-sm font-semibold">Recent invoices</h3><p className="mt-1 text-xs text-muted-foreground">A few example records</p></div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground"><Search size={13} /> Search sample</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Invoice</th><th className="px-4 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Due date</th><th className="px-4 py-3 text-right font-medium">Amount</th><th className="px-5 py-3 text-right font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {invoices.map((invoice) => <tr key={invoice.number} className="hover:bg-muted/25"><td className="whitespace-nowrap px-5 py-3.5 font-medium text-primary">{invoice.number}</td><td className="whitespace-nowrap px-4 py-3.5">{invoice.customer}</td><td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{invoice.date}</td><td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{invoice.due}</td><td className="whitespace-nowrap px-4 py-3.5 text-right font-medium tabular-nums">{invoice.amount}</td><td className="whitespace-nowrap px-5 py-3.5 text-right"><StatusPill status={invoice.status} /></td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">Showing 4 of 4 sample invoices · read-only</div>
      </div>
    </div>
  );
}

function ExpensesPreview() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-medium text-primary">Purchases</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Expenses</h2><p className="mt-1 text-sm text-muted-foreground">Keep spending organized by category and account.</p></div>
        <Button type="button" size="sm" className="gap-2" disabled><ShoppingBag size={14} /> Record expense</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryTile label="This month" value="$1,846.65" note="Across 12 sample expenses" />
        <SummaryTile label="Largest category" value="Software" note="$684.00 this month" />
        <SummaryTile label="Needs review" value="2 items" note="Example uncategorized records" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div><h3 className="text-sm font-semibold">Recent expenses</h3><p className="mt-1 text-xs text-muted-foreground">Sample entries, not your business records</p></div>
          <Button type="button" variant="outline" size="sm" className="gap-2 text-xs"><CalendarDays size={13} /> September <ChevronDown size={13} /></Button>
        </div>
        <div className="divide-y divide-border">
          {expenses.map((expense) => (
            <div key={expense.vendor} className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Banknote size={15} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium sm:text-sm">{expense.vendor}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{expense.category} · {expense.date}</span></span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{expense.account}</span>
              <span className="shrink-0 pl-2 text-xs font-semibold tabular-nums sm:text-sm">{expense.amount}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"><Sparkles size={13} className="text-primary" /> Example activity · editing is turned off in preview</div>
      </div>
    </div>
  );
}

function Metric({ label, value, change, note, positive, icon: Icon }: { label: string; value: string; change?: string; note?: string; positive?: boolean; icon: typeof ArrowUpRight }) {
  return (
    <article className="min-w-0 rounded-lg border border-border bg-card p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2"><p className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p><Icon size={15} className="shrink-0 text-primary" /></div>
      <p className="mt-3 truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      {change ? <p className={`mt-2 flex items-center gap-1 text-[10px] sm:text-[11px] ${positive ? "text-accent-foreground" : "text-muted-foreground"}`}><span className="font-semibold">{positive ? "+" : "−"}{change}</span><span>vs. last month</span></p> : <p className="mt-2 text-[10px] text-muted-foreground sm:text-[11px]">{note}</p>}
    </article>
  );
}

function SummaryTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <article className="min-w-0 rounded-lg border border-border bg-card p-3.5 sm:p-4"><p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p><p className="mt-2 truncate text-lg font-semibold tracking-tight tabular-nums sm:text-xl">{value}</p>{note ? <p className="mt-1 truncate text-[10px] text-muted-foreground">{note}</p> : null}</article>;
}

function StatusPill({ status }: { status: string }) {
  const style = status === "Paid" ? "bg-accent/70 text-accent-foreground" : status === "Overdue" ? "bg-destructive/10 text-destructive" : status === "Partially paid" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${style}`}>{status}</span>;
}
