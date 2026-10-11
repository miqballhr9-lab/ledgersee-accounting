import { and, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";
import { requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { budgetActual, budgetExpectedTotal, budgetVariance, parseBudgetLines, recordsWithinBudgetDates } from "@/lib/budget-utils";

interface BudgetPrintPageProps {
  params: Promise<{ id: string }>;
}

function toRecord(row: typeof bookkeepingRecord.$inferSelect): BookkeepingRecord {
  return { id: row.id, kind: row.kind as BookkeepingRecord["kind"], data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** A printable budget-versus-actual page; the browser's print dialog saves it as PDF. */
export default async function BudgetPrintPage({ params }: BudgetPrintPageProps) {
  const me = await requireUser();
  const { id } = await params;
  const [budgets, sources, settings] = await Promise.all([
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "budgets")))
      .limit(1),
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), inArray(bookkeepingRecord.kind, ["invoices", "bills", "expenses", "payroll"]))),
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
      .orderBy(desc(bookkeepingRecord.updatedAt))
      .limit(1),
  ]);
  if (!budgets[0]) notFound();

  const budget = budgets[0].data;
  const companyName = settings[0]?.data.companyName || me.name;
  const currency = budget.currency || settings[0]?.data.currency || "USD";
  const records = recordsWithinBudgetDates(sources.map(toRecord), budget.startDate || "", budget.endDate || "");
  const lines = parseBudgetLines(budget.lines).map((line) => {
    const actual = budgetActual(line, records);
    return { line, actual, variance: budgetVariance(line, actual) };
  });
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };
  const actualTotal = lines.reduce((sum, item) => sum + item.actual, 0);
  const varianceTotal = lines.reduce((sum, item) => sum + item.variance, 0);

  return (
    <main className="min-h-dvh bg-background px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden"><InvoicePrintButton /></div>
      <article className="mx-auto max-w-4xl border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:border-0 print:p-8 print:shadow-none sm:p-10">
        <header className="border-b border-border pb-6">
          <p className="text-sm font-semibold text-primary">{companyName}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{budget.name || "Budget"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{budget.period || "Custom"} · {budget.startDate || "…"} to {budget.endDate || "…"}</p>
          {budget.description ? <p className="mt-2 text-sm">{budget.description}</p> : null}
        </header>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Budget head</th>
              <th className="py-2 pr-3 text-right">Expected</th>
              <th className="py-2 pr-3 text-right">Actual</th>
              <th className="py-2 pr-3 text-right">Variance</th>
              <th className="py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ line, actual, variance }, index) => (
              <tr key={index} className="border-b border-border">
                <td className="py-2.5 pr-3 text-muted-foreground">{index + 1}</td>
                <td className="py-2.5 pr-3">{line.category}</td>
                <td className="py-2.5 pr-3 font-medium">{line.budgetHead}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(Number(line.expected) || 0)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(actual)}</td>
                <td className={`py-2.5 pr-3 text-right tabular-nums ${variance < 0 ? "text-destructive" : ""}`}>{money(variance)}</td>
                <td className="py-2.5 text-muted-foreground">{line.description || "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-primary font-semibold">
              <td colSpan={3} className="py-3 pr-3">Total</td>
              <td className="py-3 pr-3 text-right tabular-nums">{money(budgetExpectedTotal(lines.map((item) => item.line)))}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{money(actualTotal)}</td>
              <td className={`py-3 pr-3 text-right tabular-nums ${varianceTotal < 0 ? "text-destructive" : ""}`}>{money(varianceTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="mt-6 text-xs text-muted-foreground">Positive variance is favorable: spending under plan, or income above it.</p>
        <p className="mt-8 text-center text-xs text-muted-foreground">Generated by MIKLEDGER</p>
      </article>
    </main>
  );
}
