"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, CircleDollarSign, FileText, Plus, ReceiptText, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface DashboardProps {
  records: BookkeepingRecord[];
  asOfDate: string;
}

function amount(record: BookkeepingRecord, key = "amount") {
  const value = Number(record.data[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dateFor(record: BookkeepingRecord) {
  return record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.createdAt.slice(0, 10);
}

export default function Dashboard({ records, asOfDate }: DashboardProps) {
  const currency = records.find((record) => record.kind === "settings")?.data.currency || "USD";
  const invoices = records.filter((record) => record.kind === "invoices" && !["Draft", "Cancelled"].includes(record.data.status ?? ""));
  const expenses = records.filter((record) => record.kind === "expenses");
  const bills = records.filter((record) => record.kind === "bills" && record.data.status !== "Cancelled");
  const invoiceNet = (record: BookkeepingRecord) => Math.max(0, amount(record) - amount(record, "creditApplied"));
  const income = invoices.reduce((sum, record) => sum + invoiceNet(record), 0);
  const totalExpenses = expenses.reduce((sum, record) => sum + amount(record), 0) + bills.reduce((sum, record) => sum + amount(record), 0);
  const receivables = invoices.reduce((sum, record) => sum + Math.max(0, amount(record) - amount(record, "paidAmount") - amount(record, "creditApplied")), 0);
  const payables = bills.reduce((sum, record) => sum + Math.max(0, amount(record) - amount(record, "paidAmount")), 0);
  const netProfit = income - totalExpenses;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const chartYear = asOfDate.slice(0, 4);
  const chartData = months.map((month, index) => {
    const monthNumber = String(index + 1).padStart(2, "0");
    const getMonthTotal = (matches: BookkeepingRecord[]) => matches.reduce((sum, record) => {
      const date = dateFor(record);
      if (date.slice(0, 4) !== chartYear || date.slice(5, 7) !== monthNumber) return sum;
      return sum + (record.kind === "invoices" ? invoiceNet(record) : amount(record));
    }, 0);
    return {
      month,
      income: getMonthTotal(invoices),
      expenses: getMonthTotal([...expenses, ...bills]),
    };
  });

  const formatMoney = (value: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
    } catch {
      return `${currency} ${Math.round(value).toLocaleString()}`;
    }
  };

  const stats = [
    { label: "Total income", value: income, note: `${invoices.length} issued invoices`, icon: ArrowUpRight, tone: "text-accent-foreground bg-accent" },
    { label: "Total expenses", value: totalExpenses, note: `${expenses.length + bills.length} recorded costs`, icon: ArrowDownRight, tone: "text-destructive bg-destructive/10" },
    { label: "Net profit", value: netProfit, note: "Income minus expenses", icon: CircleDollarSign, tone: "text-primary bg-primary/10" },
    { label: "Receivables", value: receivables, note: "Remaining customer balances", icon: FileText, tone: "text-secondary-foreground bg-secondary" },
    { label: "Payables", value: payables, note: "Remaining supplier balances", icon: Wallet, tone: "text-muted-foreground bg-muted" },
  ];
  const recentRecords = [...records]
    .filter((record) => !["settings", "team-members", "bank-rules", "taxes"].includes(record.kind))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5);
  const hasChartData = chartData.some((month) => month.income > 0 || month.expenses > 0);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Business overview</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Financial overview</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Here’s how your books are looking.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/app/expenses" />} className="gap-2"><ReceiptText size={15} />Add expense</Button>
          <Button nativeButton={false} render={<Link href="/app/invoices" />} className="gap-2"><Plus size={16} />New invoice</Button>
        </div>
      </section>

      <section aria-label="Financial summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article key={stat.label} className="rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgba(14,29,52,0.03)]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                <span className={`grid size-8 place-items-center rounded-lg ${stat.tone}`}><Icon size={15} strokeWidth={1.8} /></span>
              </div>
              <p className="mt-3 text-[23px] font-semibold tracking-tight tabular-nums">{formatMoney(stat.value)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{stat.note}</p>
            </article>
          );
        })}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
        <article className="min-w-0 rounded-lg border border-border bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Income vs expenses</h2>
              <p className="mt-1 text-xs text-muted-foreground">Monthly totals for {chartYear}, from invoices, bills, and expenses</p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">By month</span>
          </div>
          <div className="relative h-[290px] px-2 py-4 sm:px-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barGap={3}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.55 }}
                  formatter={(value, name) => [formatMoney(Number(value)), name === "income" ? "Income" : "Expenses"]}
                  contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", fontSize: 12 }}
                />
                <Bar dataKey="income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expenses" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
            {!hasChartData ? <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">Record an invoice or expense to see your trend.</span></div> : null}
          </div>
          <div className="flex items-center justify-center gap-5 border-t border-border py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-[var(--chart-1)]" />Income</span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-[var(--chart-2)]" />Expenses</span>
          </div>
        </article>

        <article className="min-w-0 rounded-lg border border-border bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div><h2 className="text-sm font-semibold">Recent activity</h2><p className="mt-1 text-xs text-muted-foreground">Your latest saved records</p></div>
            <Link href="/app/invoices" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Invoices <ArrowRight size={13} /></Link>
          </div>
          {recentRecords.length ? (
            <div className="divide-y divide-border">
              {recentRecords.map((record) => {
                const moduleSlug = record.kind === "payments" ? "invoices" : record.kind;
                const title = record.data.invoiceNumber || record.data.billNumber || record.data.name || record.data.description || record.data.reference || record.data.poNumber || record.data.orderNumber || record.data.estimateNumber || record.data.customer || "New record";
                return (
                  <Link key={record.id} href={`/app/${moduleSlug}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Banknote size={16} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs capitalize text-muted-foreground">{record.kind.replaceAll("-", " ")} · {record.updatedAt.slice(0, 10)}</span></span>
                    {record.data.amount ? <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(amount(record))}</span> : null}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div><span className="mx-auto grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><FileText size={17} /></span><p className="mt-3 text-sm font-medium">Your books are ready</p><p className="mt-1 max-w-[230px] text-xs leading-5 text-muted-foreground">Add your first customer, invoice, or expense to see activity here.</p></div>
            </div>
          )}
        </article>
      </section>

      <section className="mt-5 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Keep your records moving</h2><p className="mt-1 text-xs text-muted-foreground">Start with a customer, or record a supplier bill.</p></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/app/customers" />}>Add customer</Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/app/bills" />}>Add a bill</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
