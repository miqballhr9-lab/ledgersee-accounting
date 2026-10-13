"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { buildLedger } from "@/lib/ledger";
import {
  balanceSheet, cashFlows, earliestDate, formatLongDate, periodLabel, periodPresets, presetRange, profitAndLoss,
  type PeriodPreset, type ReportOptions, type ReportResult,
} from "@/lib/reports";

interface ManagementReportProps {
  records: BookkeepingRecord[];
  today: string;
}

function money(value: number | string | null, currency: string) {
  if (value === null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function ReportTable({ result, currency }: { result: ReportResult; currency: string }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-foreground/60 text-xs uppercase">
          <th className="py-1.5 text-left font-semibold" />
          {result.columns.map((column) => <th key={column.key} className="py-1.5 text-right font-semibold">{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {result.lines.map((line) => {
          const bold = line.kind === "section" || line.kind === "total" || line.kind === "grand";
          return (
            <tr key={line.id} className={line.kind === "grand" ? "border-t border-foreground" : line.kind === "total" ? "border-t border-foreground/40" : ""}>
              <td className={`py-1 ${bold ? "font-semibold" : ""}`} style={{ paddingLeft: `${line.depth * 16}px` }}>{line.label}</td>
              {line.values.map((value, index) => <td key={index} className={`py-1 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>{line.kind === "section" ? "" : money(value, currency)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A management report, as in QuickBooks: a cover page, contents, then the main financial statements, ready to print. */
const subscribeNothing = () => () => undefined;

export default function ManagementReport({ records, today }: ManagementReportProps) {
  // Built in the browser only, so names sort the same way the rest of the reports do.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  const company = settings.companyName || "Your business";
  const currency = settings.currency || "USD";
  const [preset, setPreset] = useState<PeriodPreset>("this-year-to-date");
  const ledger = useMemo(() => buildLedger(records, settings.accountingMethod === "Cash" ? "cash" : "accrual"), [records, settings.accountingMethod]);
  const range = presetRange(preset, today, ledger.fiscalYearStartMonth, earliestDate(ledger));
  const options: ReportOptions = { from: range.from, to: range.to, columnsBy: "total", compare: "none", showChange: false, showPctChange: false, allRows: false };
  const sections = [
    { title: "Profit and Loss", result: profitAndLoss(ledger, options) },
    { title: "Balance Sheet", result: balanceSheet(ledger, options) },
    { title: "Statement of Cash Flows", result: cashFlows(ledger, options) },
  ];

  return (
    <main className="min-h-full space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/reports" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ChevronLeft size={15} />Back to reports</Link>
        <div className="flex items-center gap-2">
          <Select value={preset} onValueChange={(value) => setPreset((value as PeriodPreset) ?? "this-year-to-date")}>
            <SelectTrigger className="w-52" aria-label="Report period"><SelectValue>{periodPresets.find((entry) => entry.value === preset)?.label}</SelectValue></SelectTrigger>
            <SelectContent>{periodPresets.filter((entry) => entry.value !== "custom").map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" className="gap-1.5" onClick={() => window.print()}><Printer size={16} />Print or save PDF</Button>
        </div>
      </div>

      {mounted ? <article className="report-print mx-auto max-w-4xl space-y-8">
        <section className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg border border-border bg-card p-10 text-center print:min-h-[90vh] print:border-0 print:break-after-page">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Management report</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">{company}</h1>
          <p className="mt-3 text-lg text-muted-foreground">{periodLabel(range.from, range.to)}</p>
          <p className="mt-10 text-sm text-muted-foreground">Prepared {formatLongDate(today)}</p>
        </section>

        <section className="rounded-lg border border-border bg-card p-8 print:border-0 print:break-after-page">
          <h2 className="text-xl font-semibold">Contents</h2>
          <ol className="mt-4 space-y-2 text-sm">
            {sections.map((section, index) => <li key={section.title} className="flex justify-between border-b border-dashed border-border pb-1"><span>{section.title}</span><span className="text-muted-foreground">{index + 3}</span></li>)}
          </ol>
        </section>

        {sections.map((section) => (
          <section key={section.title} className="rounded-lg border border-border bg-card p-8 print:border-0 print:break-after-page">
            <div className="mb-5 text-center">
              <p className="font-semibold">{company}</p>
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <p className="text-sm text-muted-foreground">{section.result.period}</p>
            </div>
            {section.result.lines.length ? <ReportTable result={section.result} currency={currency} /> : <p className="text-center text-sm text-muted-foreground">Nothing to show for this period.</p>}
          </section>
        ))}
      </article> : <p className="py-16 text-center text-sm text-muted-foreground">Preparing the report…</p>}
    </main>
  );
}
