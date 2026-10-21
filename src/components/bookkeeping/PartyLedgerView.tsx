"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FileSpreadsheet, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PartyLedger } from "@/lib/party-ledger";

interface PartyLedgerViewProps {
  party: "customer" | "supplier";
  partyId: string;
  name: string;
  details: string[];
  company: string;
  companyDetails: string[];
  currency: string;
  from: string;
  to: string;
  ledger: PartyLedger;
  /** Estimates, sales orders or purchase orders with them, which don't change the balance. */
  others?: Array<{ id: string; kind: string; type: string; number: string; date: string; status: string; amount: number }>;
  backHref: string;
}

const sourcePages: Record<string, string> = { invoices: "invoices", "credit-notes": "credit-notes", bills: "bills", "supplier-credits": "supplier-credits", expenses: "expenses", "purchase-orders": "purchase-orders" };

/** The statement of account on screen: pick the dates, print or save as PDF, or download for Excel. */
export default function PartyLedgerView({ party, partyId, name, details, company, companyDetails, currency, from, to, ledger, others = [], backHref }: PartyLedgerViewProps) {
  const router = useRouter();
  const [range, setRange] = useState({ from, to });
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(currency === "PKR" ? "en-PK" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };
  const debitLabel = party === "customer" ? "Charges" : "Bills";
  const creditLabel = "Payments & credits";
  const owedLabel = party === "customer" ? "Amount due from customer" : "Amount owed to supplier";

  function download() {
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows: (string | number)[][] = [
      [`${party === "customer" ? "Customer" : "Supplier"} ledger`, name],
      ["Period", `${from || "Beginning"} to ${to}`],
      [],
      ["Date", "Type", "No.", "Memo", debitLabel, creditLabel, "Balance"],
      [from || "", "Opening balance", "", "", "", "", ledger.opening.toFixed(2)],
      ...ledger.rows.map((row) => [row.date, row.type, row.number, row.memo, row.debit ? row.debit.toFixed(2) : "", row.credit ? row.credit.toFixed(2) : "", row.balance.toFixed(2)]),
      ["", "Total", "", "", ledger.totalDebit.toFixed(2), ledger.totalCredit.toFixed(2), ledger.closing.toFixed(2)],
    ];
    const blob = new Blob([`﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/[^\w-]+/g, "-")}-ledger-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 print:bg-white print:p-0 sm:px-8">
      <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-end justify-between gap-3 print:hidden">
        <Button type="button" variant="ghost" className="gap-1.5" nativeButton={false} render={<Link href={backHref} />}><ArrowLeft size={15} />Back</Button>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); router.push(`/app/${party === "customer" ? "customers" : "vendors"}/${partyId}/ledger?from=${range.from}&to=${range.to}`); }}>
          <div className="space-y-1"><Label htmlFor="ledger-from" className="text-xs">From</Label><Input id="ledger-from" type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="ledger-to" className="text-xs">To</Label><Input id="ledger-to" type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="h-9" /></div>
          <Button type="submit" variant="outline" className="h-9">Run</Button>
          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={download}><FileSpreadsheet size={15} />Excel (CSV)</Button>
          <Button type="button" className="h-9 gap-1.5" onClick={() => window.print()}><Printer size={15} />Print or save PDF</Button>
        </form>
      </div>

      <article className="mx-auto max-w-5xl border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:border-0 print:p-6 print:shadow-none sm:p-10">
        <header className="flex flex-wrap justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="text-sm font-semibold text-primary">{company}</p>
            {companyDetails.map((line) => <p key={line} className="text-xs text-muted-foreground">{line}</p>)}
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{party === "customer" ? "Customer" : "Supplier"} ledger</h1>
            <p className="text-sm text-muted-foreground">{from ? `${from} to ${to}` : `Up to ${to}`}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{party === "customer" ? "Customer" : "Supplier"}</p>
            <p className="text-lg font-semibold">{name}</p>
            {details.map((line) => <p key={line} className="text-xs text-muted-foreground">{line}</p>)}
            <p className="mt-3 text-xs text-muted-foreground">{owedLabel}</p>
            <p className="text-2xl font-semibold tabular-nums">{money(ledger.closing)}</p>
          </div>
        </header>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">No.</th><th className="py-2 pr-3">Memo</th>
                <th className="py-2 pr-3 text-right">{debitLabel}</th><th className="py-2 pr-3 text-right">{creditLabel}</th><th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-muted/40"><td className="py-2 pr-3 tabular-nums">{from || "—"}</td><td className="py-2 pr-3 font-medium" colSpan={5}>Opening balance</td><td className="py-2 text-right font-medium tabular-nums">{money(ledger.opening)}</td></tr>
              {ledger.rows.map((row, index) => {
                const page = sourcePages[row.sourceKind];
                return (
                  <tr key={`${row.sourceId}-${index}`} className="border-b border-border">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{row.date}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{page ? <Link href={`/app/${page}?open=${encodeURIComponent(row.sourceId)}`} className="text-primary hover:underline print:text-foreground">{row.type}</Link> : row.type}</td>
                    <td className="py-2 pr-3">{row.number}</td>
                    <td className="max-w-56 truncate py-2 pr-3 text-muted-foreground">{row.memo}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.debit ? money(row.debit) : ""}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.credit ? money(row.credit) : ""}</td>
                    <td className="py-2 text-right tabular-nums">{money(row.balance)}</td>
                  </tr>
                );
              })}
              {!ledger.rows.length ? <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No transactions in these dates.</td></tr> : null}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2.5 pr-3" colSpan={4}>Total and closing balance</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(ledger.totalDebit)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(ledger.totalCredit)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(ledger.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {others.length ? (
          <section className="mt-8 break-inside-avoid">
            <h2 className="text-sm font-semibold">{party === "customer" ? "Estimates and sales orders" : "Purchase orders"}</h2>
            <p className="text-xs text-muted-foreground">Not in the balance above until they become {party === "customer" ? "an invoice" : "a bill"}.</p>
            <table className="mt-2 w-full min-w-[560px] border-collapse text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">No.</th><th className="py-2 pr-3">Status</th><th className="py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {others.map((doc) => (
                  <tr key={doc.id} className="border-b border-border">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{doc.date}</td>
                    <td className="py-2 pr-3"><Link href={`/app/${doc.kind}?open=${encodeURIComponent(doc.id)}`} className="text-primary hover:underline print:text-foreground">{doc.type}</Link></td>
                    <td className="py-2 pr-3">{doc.number}</td>
                    <td className="py-2 pr-3">{doc.status}</td>
                    <td className="py-2 text-right tabular-nums">{money(doc.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </article>
    </main>
  );
}
