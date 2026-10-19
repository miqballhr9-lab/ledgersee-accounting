import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { budgetActual, budgetExpectedTotal, budgetTotals, budgetVariance, parseBudgetLines, recordsWithinBudgetDates, resolveBudgetLineAccount } from "@/lib/budget-utils";
import { isRecordKind } from "@/lib/bookkeeping-types";
import { buildLedger } from "@/lib/ledger";

function toRecord(row: typeof bookkeepingRecord.$inferSelect): BookkeepingRecord {
  return { id: row.id, kind: row.kind as BookkeepingRecord["kind"], data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Loads the budgets (in the order asked for) plus everything needed to show their actuals. */
export async function loadBudgetsForPrint(userId: string, ids: string[]) {
  const [budgets, sources, settings] = await Promise.all([
    ids.length
      ? db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "budgets"), inArray(bookkeepingRecord.id, ids)))
      : Promise.resolve([]),
    // Everything the books are built from, so actuals match the Profit and Loss.
    db.select().from(bookkeepingRecord).where(eq(bookkeepingRecord.userId, userId)),
    db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).orderBy(desc(bookkeepingRecord.updatedAt)).limit(1),
  ]);
  const ordered = ids.flatMap((id) => budgets.filter((budget) => budget.id === id));
  return { budgets: ordered.map(toRecord), sources: sources.filter((row) => isRecordKind(row.kind) && row.kind !== "budgets").map(toRecord), settings: settings[0]?.data ?? {} };
}

/** One budget-versus-actual sheet; several print one after another, each on its own page. */
export function BudgetPrintSheet({ budget, sources, settings, fallbackCompany }: { budget: BookkeepingRecord; sources: BookkeepingRecord[]; settings: Record<string, string>; fallbackCompany: string }) {
  const data = budget.data;
  const companyName = settings.companyName || fallbackCompany;
  const currency = data.currency || settings.currency || "USD";
  const records = recordsWithinBudgetDates(sources.filter((record) => ["invoices", "bills", "expenses", "payroll"].includes(record.kind)), data.startDate || "", data.endDate || "");
  const ledger = buildLedger(sources, settings.accountingMethod === "Cash" ? "cash" : "accrual");
  const books = { ledger, records: sources, startDate: data.startDate || "", endDate: data.endDate || "" };
  const homeCurrency = settings.currency || "";
  const lines = parseBudgetLines(data.lines).map((budgetLine) => {
    const line = resolveBudgetLineAccount(budgetLine, sources);
    const actual = budgetActual(line, records, homeCurrency, books);
    return { line, actual, variance: budgetVariance(line, actual) };
  });
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };
  const totals = budgetTotals(lines.map((item) => item.line), lines.map((item) => item.actual));

  return (
    <article className="mx-auto mb-6 max-w-4xl break-after-page print:mb-0 last:break-after-auto border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:border-0 print:p-8 print:shadow-none sm:p-10">
        <header className="border-b border-border pb-6">
          <p className="text-sm font-semibold text-primary">{companyName}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{data.name || "Budget"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.period || "Custom"} · {data.startDate || "…"} to {data.endDate || "…"}</p>
          {data.description ? <p className="mt-2 text-sm">{data.description}</p> : null}
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
          {(["Income", "Expense"] as const).map((section) => {
            const sectionLines = lines.filter(({ line }) => (line.type === "Income") === (section === "Income"));
            const sectionTotal = section === "Income" ? totals.income : totals.expense;
            return (
              <tbody key={section}>
                <tr className="border-b border-border bg-muted/40"><td colSpan={7} className="py-2 pl-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section === "Income" ? "Income / sales" : "Expenses"}</td></tr>
                {sectionLines.map(({ line, actual, variance }, index) => (
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
                <tr className="border-b-2 border-border font-semibold">
                  <td colSpan={3} className="py-2.5 pr-3">Total {section === "Income" ? "income" : "expenses"}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(sectionTotal.expected)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(sectionTotal.actual)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(section === "Income" ? sectionTotal.actual - sectionTotal.expected : sectionTotal.expected - sectionTotal.actual)}</td>
                  <td />
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td colSpan={3} className="py-3 pr-3">Total</td>
              <td className="py-3 pr-3 text-right tabular-nums">{money(budgetExpectedTotal(lines.map((item) => item.line)))}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{money(lines.reduce((sum, item) => sum + item.actual, 0))}</td>
              <td className={`py-3 pr-3 text-right tabular-nums ${totals.variance < 0 ? "text-destructive" : ""}`}>{money(totals.variance)}</td>
              <td />
            </tr>
            <tr className="border-t-2 border-primary font-semibold">
              <td colSpan={3} className="py-3 pr-3">Net profit / (loss)</td>
              <td className={`py-3 pr-3 text-right tabular-nums ${totals.profit.expected < 0 ? "text-destructive" : ""}`}>{money(totals.profit.expected)}</td>
              <td className={`py-3 pr-3 text-right tabular-nums ${totals.profit.actual < 0 ? "text-destructive" : ""}`}>{money(totals.profit.actual)}</td>
              <td className={`py-3 pr-3 text-right tabular-nums ${totals.variance < 0 ? "text-destructive" : ""}`}>{money(totals.variance)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="mt-6 text-xs text-muted-foreground">Positive variance is favorable: spending under plan, or income above it.</p>
        <p className="mt-8 text-center text-xs text-muted-foreground">Generated by MIKLEDGER</p>
      </article>
  );
}
