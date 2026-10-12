"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { accountOf, type Ledger } from "@/lib/ledger";
import { budgetActual, budgetExpectedTotal, budgetVariance, parseBudgetLines, recordsWithinBudgetDates } from "@/lib/budget-utils";
import { addDays, fiscalYearStart, formatLongDate } from "@/lib/reports";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  }
}

const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Business Snapshot: this year's income and expenses by month against last year, top expenses and key balances. */
export function BusinessSnapshot({ ledger, today, currency }: { ledger: Ledger; today: string; currency: string }) {
  const data = useMemo(() => {
    const start = fiscalYearStart(ledger, today);
    const lastStart = fiscalYearStart(ledger, addDays(start, -1));
    const income = Array.from({ length: 12 }, () => [0, 0]);
    const expense = Array.from({ length: 12 }, () => [0, 0]);
    const topExpenses = new Map<string, number>();
    let cash = 0;
    let ar = 0;
    let ap = 0;
    for (const posting of ledger.postings) {
      const account = accountOf(ledger, posting.account);
      if (posting.date <= today) {
        if (account.accountType === "Cash and cash equivalents") cash += posting.amount;
        if (posting.account === ledger.ar) ar += posting.amount;
        if (posting.account === ledger.ap) ap -= posting.amount;
      }
      if (account.category !== "Income" && account.category !== "Expense") continue;
      const year = posting.date >= start ? 0 : posting.date >= lastStart ? 1 : -1;
      if (year < 0 || posting.date > today) continue;
      const fromStart = year === 0 ? start : lastStart;
      const index = (Number(posting.date.slice(0, 4)) - Number(fromStart.slice(0, 4))) * 12 + Number(posting.date.slice(5, 7)) - Number(fromStart.slice(5, 7));
      if (index < 0 || index > 11) continue;
      if (account.category === "Income") income[index][year] -= posting.amount;
      else {
        expense[index][year] += posting.amount;
        if (year === 0) topExpenses.set(posting.account, (topExpenses.get(posting.account) ?? 0) + posting.amount);
      }
    }
    const startMonth = Number(start.slice(5, 7)) - 1;
    return { start, income, expense, startMonth, cash, ar, ap, top: [...topExpenses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [ledger, today]);

  const totalIncome = data.income.reduce((sum, [current]) => sum + current, 0);
  const totalExpense = data.expense.reduce((sum, [current]) => sum + current, 0);
  const max = Math.max(1, ...data.income.flat(), ...data.expense.flat());
  const topMax = Math.max(1, ...data.top.map(([, value]) => value));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[["Income this year", totalIncome], ["Expenses this year", totalExpense], ["Net income", totalIncome - totalExpense], ["Cash in bank", data.cash], ["Customers owe you", data.ar]].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(value as number, currency)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Income and expenses by month</h2>
            <p className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" />Income</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-amber-500" />Expenses</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-muted-foreground/30" />Last year</span>
            </p>
          </div>
          <div className="mt-4 flex h-52 items-end gap-1.5 border-b border-border pb-1">
            {data.income.map(([current, last], index) => (
              <div key={index} className="flex h-full flex-1 flex-col justify-end">
                <div className="flex h-full items-end justify-center gap-px">
                  <span title={`Income ${money(current, currency)} · last year ${money(last, currency)}`} className="w-1/4 rounded-t-sm bg-primary" style={{ height: `${(current / max) * 100}%` }} />
                  <span className="w-1/4 rounded-t-sm bg-muted-foreground/30" style={{ height: `${(last / max) * 100}%` }} />
                  <span title={`Expenses ${money(data.expense[index][0], currency)}`} className="w-1/4 rounded-t-sm bg-amber-500" style={{ height: `${(data.expense[index][0] / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5 text-center text-[11px] text-muted-foreground">
            {data.income.map((_, index) => <span key={index} className="flex-1">{monthShort[(data.startMonth + index) % 12]}</span>)}
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Top expenses this year</h2>
          {data.top.length ? (
            <ul className="mt-3 space-y-2.5">
              {data.top.map(([name, value]) => (
                <li key={name} className="text-sm">
                  <div className="flex justify-between gap-2"><span className="truncate">{name}</span><span className="tabular-nums">{money(value, currency)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${(value / topMax) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted-foreground">No expenses this year yet.</p>}
          <p className="mt-4 border-t border-border pt-3 text-sm">You owe suppliers <span className="font-semibold tabular-nums">{money(data.ap, currency)}</span></p>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">Fiscal year from {formatLongDate(data.start)}. <Link href="/app/reports/profit-and-loss-by-month" className="text-primary hover:underline">Open Profit and Loss by Month</Link></p>
    </div>
  );
}

/** Budget Overview and Budget vs. Actuals. */
export function BudgetReport({ records, currency, withActuals, company, title }: { records: BookkeepingRecord[]; currency: string; withActuals: boolean; company: string; title: string }) {
  const budgets = records.filter((record) => record.kind === "budgets");
  const [budgetId, setBudgetId] = useState(budgets[0]?.id ?? "");
  const budget = budgets.find((item) => item.id === budgetId) ?? budgets[0];
  const lines = budget ? parseBudgetLines(budget.data.lines) : [];
  const scoped = budget ? recordsWithinBudgetDates(records, budget.data.startDate ?? "", budget.data.endDate ?? "") : [];
  const fmt = (value: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  if (!budgets.length) {
    return (
      <section className="rounded-lg border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium">No budgets yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Create a budget to see it here. <Link href="/app/budgets?new=1" className="text-primary hover:underline">New budget</Link></p>
      </section>
    );
  }

  const groups = (["Income", "Expense"] as const).map((type) => ({ type, lines: lines.filter((line) => line.type === type) })).filter((group) => group.lines.length);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Budget</span>
          <Select value={budget?.id ?? ""} onValueChange={(value) => setBudgetId(value ?? "")}>
            <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>{budgets.map((item) => <SelectItem key={item.id} value={item.id}>{item.data.name || "Budget"}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <section className="report-print rounded-lg border border-border bg-card px-3 py-6 sm:px-8">
        <div className="text-center">
          <p className="text-lg font-semibold">{company}</p>
          <p className="text-[15px]">{title}: {budget?.data.name}</p>
          <p className="text-sm text-muted-foreground">{budget?.data.startDate ? `${formatLongDate(budget.data.startDate)} – ${formatLongDate(budget.data.endDate ?? "")}` : budget?.data.period}</p>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-foreground text-xs uppercase">
                <th className="px-3 py-2 text-left font-semibold" />
                <th className="px-3 py-2 text-right font-semibold">Budget</th>
                {withActuals ? <><th className="px-3 py-2 text-right font-semibold">Actual</th><th className="px-3 py-2 text-right font-semibold">Over/(under) budget</th><th className="px-3 py-2 text-right font-semibold">% of budget</th></> : null}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const expected = budgetExpectedTotal(group.lines);
                const actual = group.lines.reduce((sum, line) => sum + budgetActual(line, scoped), 0);
                return [
                  <tr key={`${group.type}-head`}><td className="px-3 pb-1 pt-3 font-semibold" colSpan={withActuals ? 5 : 2}>{group.type === "Income" ? "Income" : "Expenses"}</td></tr>,
                  ...group.lines.map((line, index) => {
                    const lineActual = budgetActual(line, scoped);
                    const lineExpected = Number(line.expected) || 0;
                    return (
                      <tr key={`${group.type}-${index}`}>
                        <td className="py-1.5 pl-7 pr-3">{line.budgetHead || line.category}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(lineExpected)}</td>
                        {withActuals ? <><td className="px-3 py-1.5 text-right tabular-nums">{fmt(lineActual)}</td><td className={`px-3 py-1.5 text-right tabular-nums ${budgetVariance(line, lineActual) < 0 ? "text-destructive" : ""}`}>{fmt(lineActual - lineExpected)}</td><td className="px-3 py-1.5 text-right tabular-nums">{lineExpected ? `${((lineActual / lineExpected) * 100).toFixed(2)} %` : ""}</td></> : null}
                      </tr>
                    );
                  }),
                  <tr key={`${group.type}-total`} className="font-semibold">
                    <td className="border-t border-foreground/60 px-3 py-1.5">Total {group.type === "Income" ? "Income" : "Expenses"}</td>
                    <td className="border-t border-foreground/60 px-3 py-1.5 text-right tabular-nums">{fmt(expected)}</td>
                    {withActuals ? <><td className="border-t border-foreground/60 px-3 py-1.5 text-right tabular-nums">{fmt(actual)}</td><td className="border-t border-foreground/60 px-3 py-1.5 text-right tabular-nums">{fmt(actual - expected)}</td><td className="border-t border-foreground/60 px-3 py-1.5 text-right tabular-nums">{expected ? `${((actual / expected) * 100).toFixed(2)} %` : ""}</td></> : null}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
          {!lines.length ? <p className="py-8 text-center text-sm text-muted-foreground">This budget has no lines yet.</p> : null}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">{currency}</p>
      </section>
    </div>
  );
}
