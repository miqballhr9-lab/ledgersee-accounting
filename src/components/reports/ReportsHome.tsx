"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search, Star } from "lucide-react";

import { Input } from "@/components/ui/input";
import { reportCategories, type ReportDefinition } from "@/lib/report-catalog";
import { useFavouriteReports } from "@/components/reports/use-favourite-reports";

const tabs = ["Standard", "Custom reports", "Management reports"] as const;

/** The reports list, laid out like QuickBooks Online: favourites, then categories that open and close. */
export default function ReportsHome() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Standard");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(["favourites", "business-overview"]));
  const { favourites, toggle } = useFavouriteReports();
  const total = reportCategories.reduce((sum, category) => sum + category.reports.length, 0);

  const categories = useMemo(() => {
    const byKey = new Map(reportCategories.flatMap((category) => category.reports).map((report) => [report.key, report]));
    const favouriteReports = favourites.map((key) => byKey.get(key)).filter((report): report is ReportDefinition => Boolean(report));
    const list = [{ key: "favourites", label: "Favourites", reports: favouriteReports }, ...reportCategories];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list
      .map((category) => ({ ...category, reports: category.reports.filter((report) => `${report.label} ${report.description}`.toLowerCase().includes(needle)) }))
      .filter((category) => category.reports.length && category.key !== "favourites");
  }, [favourites, query]);

  function toggleCategory(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <main className="min-h-full space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounts / Reports</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Reports</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{total} reports, grouped by topic. Star the ones you open often.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find report by name" className="pl-9" aria-label="Find report by name" />
        </div>
      </section>

      <div role="tablist" className="flex gap-6 border-b border-border text-sm">
        {tabs.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`-mb-px border-b-[3px] px-0.5 py-2.5 ${tab === item ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {item}
          </button>
        ))}
      </div>

      {tab !== "Standard" ? (
        <section className="rounded-lg border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm font-medium">{tab === "Custom reports" ? "No custom reports yet" : "Management reports are coming soon"}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {tab === "Custom reports"
              ? "Saving a customised report (filters, columns and period) is coming in the next update. Until then, bookmark a report's link after you run it."
              : "A management report packs several reports with a cover page into one PDF. It is coming in a later update."}
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {categories.map((category) => {
            const isOpen = Boolean(query.trim()) || open.has(category.key);
            const half = Math.ceil(category.reports.length / 2);
            return (
              <section key={category.key} className="rounded-lg border border-border bg-card">
                <button type="button" onClick={() => toggleCategory(category.key)} aria-expanded={isOpen} className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left">
                  {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                  <span className="text-base font-semibold">{category.label}</span>
                  <span className="text-xs text-muted-foreground">{category.reports.length}</span>
                </button>
                {isOpen ? (
                  category.reports.length ? (
                    <div className="grid gap-x-12 px-5 pb-3 md:grid-cols-2">
                      {[category.reports.slice(0, half), category.reports.slice(half)].map((column, index) => (
                        <ul key={index}>
                          {column.map((report) => (
                            <li key={report.key} className="flex h-10 items-center gap-3 border-b border-border/70 text-sm">
                              {report.ready ? (
                                <Link href={`/app/reports/${report.key}`} title={report.description} className="min-w-0 flex-1 truncate text-primary hover:underline">{report.label}</Link>
                              ) : (
                                <span title={report.description} className="min-w-0 flex-1 truncate text-muted-foreground">{report.label} <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">Soon</span></span>
                              )}
                              <button type="button" onClick={() => toggle(report.key)} aria-label={favourites.includes(report.key) ? `Remove ${report.label} from favourites` : `Add ${report.label} to favourites`} className="shrink-0">
                                <Star size={16} className={favourites.includes(report.key) ? "fill-amber-400 text-amber-500" : "text-muted-foreground/60 hover:text-amber-500"} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ))}
                    </div>
                  ) : (
                    <p className="px-5 pb-4 text-sm text-muted-foreground">Star a report to keep it here.</p>
                  )
                ) : null}
              </section>
            );
          })}
          {!categories.length ? <p className="py-10 text-center text-sm text-muted-foreground">No report matches “{query}”.</p> : null}
        </div>
      )}
    </main>
  );
}
