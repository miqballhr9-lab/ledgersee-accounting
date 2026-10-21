"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FileSpreadsheet, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PartyLedger } from "@/lib/party-ledger";

interface AllPartiesLedgerViewProps {
  party: "customer" | "supplier";
  company: string;
  currency: string;
  from: string;
  to: string;
  /** Leave out those with no balance and nothing in the dates. */
  onlyWithActivity: boolean;
  parties: Array<{ id: string; number: string; name: string; ledger: PartyLedger }>;
}

const sourcePages: Record<string, string> = { invoices: "invoices", "credit-notes": "credit-notes", bills: "bills", "supplier-credits": "supplier-credits", expenses: "expenses" };

/** All customers' or suppliers' ledgers: a summary with totals, then each one's transactions, to print or download. */
export default function AllPartiesLedgerView({ party, company, currency, from, to, onlyWithActivity, parties }: AllPartiesLedgerViewProps) {
  const router = useRouter();
  const [range, setRange] = useState({ from, to });
  const [details, setDetails] = useState(true);
  const slug = party === "customer" ? "customers" : "vendors";
  const title = party === "customer" ? "Customer" : "Supplier";
  const debitLabel = party === "customer" ? "Charges" : "Bills";
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(currency === "PKR" ? "en-PK" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };
  const shown = onlyWithActivity ? parties.filter((entry) => entry.ledger.rows.length || Math.abs(entry.ledger.opening) > 0.004 || Math.abs(entry.ledger.closing) > 0.004) : parties;
  const total = (pick: (ledger: PartyLedger) => number) => Math.round(shown.reduce((sum, entry) => sum + pick(entry.ledger), 0) * 100) / 100;

  function run(next: { from: string; to: string; all?: boolean }) {
    router.push(`/app/${slug}/ledger?from=${next.from}&to=${next.to}${(next.all ?? !onlyWithActivity) ? "&show=all" : ""}`);
  }

  function download() {
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows: (string | number)[][] = [[`${title} ledger report`, company], ["Period", `${from || "Beginning"} to ${to}`], [], [`${title} no.`, title, "Opening balance", debitLabel, "Payments & credits", "Closing balance"]];
    for (const entry of shown) rows.push([entry.number, entry.name, entry.ledger.opening.toFixed(2), entry.ledger.totalDebit.toFixed(2), entry.ledger.totalCredit.toFixed(2), entry.ledger.closing.toFixed(2)]);
    rows.push(["", "Total", total((ledger) => ledger.opening).toFixed(2), total((ledger) => ledger.totalDebit).toFixed(2), total((ledger) => ledger.totalCredit).toFixed(2), total((ledger) => ledger.closing).toFixed(2)]);
    if (details) {
      rows.push([], [`${title} no.`, title, "Date", "Type", "No.", "Memo", debitLabel, "Payments & credits", "Balance"]);
      for (const entry of shown) {
        rows.push([entry.number, entry.name, from || "", "Opening balance", "", "", "", "", entry.ledger.opening.toFixed(2)]);
        for (const row of entry.ledger.rows) rows.push([entry.number, entry.name, row.date, row.type, row.number, row.memo, row.debit ? row.debit.toFixed(2) : "", row.credit ? row.credit.toFixed(2) : "", row.balance.toFixed(2)]);
      }
    }
    const blob = new Blob([`﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug}-ledger-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 print:bg-white print:p-0 sm:px-8">
      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-end justify-between gap-3 print:hidden">
        <Button type="button" variant="ghost" className="gap-1.5" nativeButton={false} render={<Link href={`/app/${slug}`} />}><ArrowLeft size={15} />Back</Button>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(range); }}>
          <div className="space-y-1"><Label htmlFor="all-ledger-from" className="text-xs">From</Label><Input id="all-ledger-from" type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="all-ledger-to" className="text-xs">To</Label><Input id="all-ledger-to" type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="h-9" /></div>
          <Button type="submit" variant="outline" className="h-9">Run</Button>
          <label className="flex h-9 items-center gap-2 text-sm"><Checkbox checked={details} onCheckedChange={(checked) => setDetails(checked === true)} />Transactions</label>
          <label className="flex h-9 items-center gap-2 text-sm"><Checkbox checked={!onlyWithActivity} onCheckedChange={(checked) => run({ ...range, all: checked === true })} />Include inactive</label>
          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={download}><FileSpreadsheet size={15} />Excel (CSV)</Button>
          <Button type="button" className="h-9 gap-1.5" onClick={() => window.print()}><Printer size={15} />Print or save PDF</Button>
        </form>
      </div>

      <article className="mx-auto max-w-6xl border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:border-0 print:p-6 print:shadow-none sm:p-10">
        <header className="border-b border-border pb-5">
          <p className="text-sm font-semibold text-primary">{company}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title} ledger report</h1>
          <p className="text-sm text-muted-foreground">{from ? `${from} to ${to}` : `Up to ${to}`} · {shown.length} {shown.length === 1 ? title.toLowerCase() : `${title.toLowerCase()}s`}</p>
        </header>

        <h2 className="mt-6 text-sm font-semibold">Summary</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">{title} no.</th><th className="py-2 pr-3">{title}</th><th className="py-2 pr-3 text-right">Opening</th><th className="py-2 pr-3 text-right">{debitLabel}</th><th className="py-2 pr-3 text-right">Payments & credits</th><th className="py-2 text-right">Closing balance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id} className="border-b border-border">
                  <td className="py-2 pr-3 tabular-nums">{entry.number || "—"}</td>
                  <td className="py-2 pr-3"><Link href={`/app/${slug}/${encodeURIComponent(entry.id)}/ledger?from=${from}&to=${to}`} className="text-primary hover:underline print:text-foreground">{entry.name}</Link></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(entry.ledger.opening)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(entry.ledger.totalDebit)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(entry.ledger.totalCredit)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{money(entry.ledger.closing)}</td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No {title.toLowerCase()}s with transactions or balances in these dates.</td></tr> : null}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2.5 pr-3" colSpan={2}>Total</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(total((ledger) => ledger.opening))}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(total((ledger) => ledger.totalDebit))}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(total((ledger) => ledger.totalCredit))}</td>
                <td className="py-2.5 text-right tabular-nums">{money(total((ledger) => ledger.closing))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {details ? shown.filter((entry) => entry.ledger.rows.length || Math.abs(entry.ledger.opening) > 0.004).map((entry) => (
          <section key={entry.id} className="mt-8 break-inside-avoid-page">
            <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-1.5 text-sm font-semibold">
              <span>{entry.number ? `${entry.number} · ` : ""}{entry.name}</span>
              <span className="text-xs font-normal text-muted-foreground">Closing balance <span className="font-semibold text-foreground">{money(entry.ledger.closing)}</span></span>
            </h2>
            <table className="mt-1 w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3">Date</th><th className="py-1.5 pr-3">Type</th><th className="py-1.5 pr-3">No.</th><th className="py-1.5 pr-3">Memo</th><th className="py-1.5 pr-3 text-right">{debitLabel}</th><th className="py-1.5 pr-3 text-right">Payments & credits</th><th className="py-1.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border bg-muted/40"><td className="py-1.5 pr-3 tabular-nums">{from || "—"}</td><td className="py-1.5 pr-3" colSpan={5}>Opening balance</td><td className="py-1.5 text-right tabular-nums">{money(entry.ledger.opening)}</td></tr>
                {entry.ledger.rows.map((row, index) => {
                  const page = sourcePages[row.sourceKind];
                  return (
                    <tr key={`${row.sourceId}-${index}`} className="border-t border-border">
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{row.date}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{page ? <Link href={`/app/${page}?open=${encodeURIComponent(row.sourceId)}`} className="text-primary hover:underline print:text-foreground">{row.type}</Link> : row.type}</td>
                      <td className="py-1.5 pr-3">{row.number}</td>
                      <td className="max-w-56 truncate py-1.5 pr-3 text-muted-foreground">{row.memo}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.debit ? money(row.debit) : ""}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.credit ? money(row.credit) : ""}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(row.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )) : null}
      </article>
    </main>
  );
}
