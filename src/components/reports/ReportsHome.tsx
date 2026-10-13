"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

import { Input } from "@/components/ui/input";
import { reportCategories, type ReportDefinition } from "@/lib/report-catalog";
import { useFavouriteReports } from "@/components/reports/use-favourite-reports";

const tabs = ["Standard", "Custom reports", "Management reports"] as const;

/** The reports list, laid out like QuickBooks Online: favourites, then categories that open and close. */
export default function ReportsHome({ customReports = [] }: { customReports?: BookkeepingRecord[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  async function removeCustom(report: BookkeepingRecord) {
    if (!window.confirm(`Delete the custom report “${report.data.name}”?`)) return;
    setRemoving(report.id);
    try {
      await deleteBookkeepingRecord("custom-reports", report.id);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t delete this report.");
    } finally {
      setRemoving(null);
    }
  }
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

      {tab === "Custom reports" ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {customReports.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Based on</th>
                  <th className="px-3 py-2.5 font-medium">Saved</th>
                  <th className="px-5 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {customReports.map((report) => (
                  <tr key={report.id} className="border-b border-border/70">
                    <td className="px-5 py-2.5"><Link href={`/app/reports/${report.data.reportKey}?${report.data.query ? `${report.data.query}&` : ""}cname=${encodeURIComponent(report.data.name)}`} className="text-primary hover:underline">{report.data.name}</Link></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{report.data.reportLabel || report.data.reportKey}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{report.createdAt.slice(0, 10)}</td>
                    <td className="px-5 py-2.5 text-right"><Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={removing === report.id} onClick={() => void removeCustom(report)}><Trash2 size={14} />Delete</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium">No custom reports yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Run any report, change its period, columns or filters, then choose “Save customisation”. It will be listed here.</p>
            </div>
          )}
        </section>
      ) : tab === "Management reports" ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <Link href="/app/reports/management-report" className="font-medium text-primary hover:underline">Company overview</Link>
              <p className="mt-0.5 text-sm text-muted-foreground">Cover page, contents, Profit and Loss, Balance Sheet and Statement of Cash Flows in one printable report.</p>
            </div>
            <Button type="button" variant="outline" nativeButton={false} render={<Link href="/app/reports/management-report" />}>View</Button>
          </div>
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
