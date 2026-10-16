"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, BadgeCheck, Printer, Trash2 } from "lucide-react";

import { deleteTaxFiling, fileTaxReturn, recordTaxPayment } from "@/app/tax-actions";
import PaymentDialog from "@/components/bookkeeping/PaymentDialog";
import { readableError } from "@/lib/action-error";
import { paymentAccountType } from "@/lib/payment-accounts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { returnRows, taxLines } from "@/lib/tax-return";
import { countryPacks, isCountryCode } from "@/lib/tax-packs";
import { downloadFile, formatMoney, toCsv } from "@/components/crm/crm-shared";

interface TaxReturnWorkspaceProps {
  documents: BookkeepingRecord[];
  taxes: BookkeepingRecord[];
  parties: BookkeepingRecord[];
  settings: Record<string, string>;
  asOfDate: string;
  /** Returns already marked filed, with their payment. */
  filings?: BookkeepingRecord[];
  accounts?: BookkeepingRecord[];
}

type Period = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "this-year" | "custom";

function range(period: Period, asOf: string): [string, string] {
  const [year, month] = asOf.split("-").map(Number);
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const end = (y: number, m: number) => iso(y, m + 1, 0);
  if (period === "this-month") return [iso(year, month, 1), end(year, month)];
  if (period === "last-month") return [iso(year, month - 1, 1), end(year, month - 1)];
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  if (period === "this-quarter") return [iso(year, quarterStart, 1), end(year, quarterStart + 2)];
  if (period === "last-quarter") return [iso(year, quarterStart - 3, 1), end(year, quarterStart - 1)];
  return [iso(year, 1, 1), iso(year, 12, 31)];
}

export default function TaxReturnWorkspace({ documents, taxes, parties, settings, asOfDate, filings = [], accounts = [] }: TaxReturnWorkspaceProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<BookkeepingRecord | null>(null);
  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const country = isCountryCode(settings.taxCountry) ? settings.taxCountry : "OTHER";
  const pack = countryPacks[country];
  const currency = settings.currency || pack.currency;
  const [period, setPeriod] = useState<Period>("last-month");
  const [custom, setCustom] = useState<[string, string]>(() => range("this-month", asOfDate));
  const [from, to] = period === "custom" ? custom : range(period, asOfDate);
  const lines = useMemo(() => taxLines(documents, taxes, parties, from, to), [documents, taxes, parties, from, to]);
  const rows = useMemo(() => returnRows(country, lines), [country, lines]);
  const [side, setSide] = useState<"Sales" | "Purchases">("Sales");
  const registration = pack.registrations.map((field) => (settings[field.key] ? `${field.label}: ${settings[field.key]}` : "")).filter(Boolean).join(" · ");

  const outputTax = lines.filter((line) => line.side === "Sales").reduce((sum, line) => sum + line.tax, 0);
  const inputTax = lines.filter((line) => line.side === "Purchases").reduce((sum, line) => sum + line.tax, 0);
  const filedForPeriod = filings.find((filing) => filing.data.from <= to && filing.data.to >= from);

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That couldn’t be saved.");
    } finally {
      setBusy(false);
    }
  }

  function markFiled() {
    if (!window.confirm(`Mark the ${pack.returnName} for ${from} to ${to} as filed? Net tax: ${formatMoney(outputTax - inputTax, currency)}. Later changes to this period show in the Tax Exception report.`)) return;
    void run(() => fileTaxReturn({ from, to, returnName: pack.returnName, outputTax, inputTax, boxes: JSON.stringify(rows) }), "Return marked as filed.");
  }

  function exportCsv() {
    const summary = [["Box", "Description", "Amount", "Tax"], ...rows.map((row) => [row.box, row.label, row.amount.toFixed(2), row.tax.toFixed(2)])];
    const detail = [["Side", "Document", "Number", "Date", "Party", "Party tax ID", "Tax", "Category", "Rate", "Taxable value", "Tax amount"], ...lines.map((line) => [line.side, line.kind, line.number, line.date, line.party, line.partyTaxId, line.taxName, line.category, String(line.rate), line.taxable.toFixed(2), line.tax.toFixed(2)])];
    downloadFile(`tax-return-${from}-to-${to}.csv`, toCsv([[pack.returnName, `${from} to ${to}`], [], ...summary, [], ...detail]), "text/csv;charset=utf-8");
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounts / Tax returns</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">{pack.returnName}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Worked out from the invoices, credit notes, bills and expenses in the period. Check the figures, then file on the tax authority&apos;s portal. {country === "OTHER" ? <>Pick your country in <Link className="text-primary underline-offset-4 hover:underline" href="/app/tax-setup">Tax setup</Link> for its layout.</> : null}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button>
          <Button variant="outline" className="gap-2" onClick={() => window.print()}><Printer size={15} />Print / PDF</Button>
          {filedForPeriod ? null : <Button className="gap-2" disabled={busy} onClick={markFiled}><BadgeCheck size={15} />Mark as filed</Button>}
        </div>
      </header>

      <section className="mt-5 flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1.5">
          <Label htmlFor="return-period">Period</Label>
          <Select value={period} onValueChange={(value) => setPeriod((value ?? "last-month") as Period)}>
            <SelectTrigger id="return-period" className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this-month">This month</SelectItem>
              <SelectItem value="last-month">Last month</SelectItem>
              <SelectItem value="this-quarter">This quarter</SelectItem>
              <SelectItem value="last-quarter">Last quarter</SelectItem>
              <SelectItem value="this-year">This calendar year</SelectItem>
              <SelectItem value="custom">Custom dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {period === "custom" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="return-from">From</Label><Input id="return-from" type="date" value={custom[0]} onChange={(event) => setCustom([event.target.value, custom[1]])} /></div>
            <div className="space-y-1.5"><Label htmlFor="return-to">To</Label><Input id="return-to" type="date" value={custom[1]} onChange={(event) => setCustom([custom[0], event.target.value])} /></div>
          </>
        ) : <p className="pb-2 text-sm text-muted-foreground">{from} to {to}</p>}
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">{settings.companyName || "Your business"} — {pack.returnName}</h2>
          <p className="text-xs text-muted-foreground">{from} to {to}{registration ? ` · ${registration}` : ""} · amounts in {currency}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground"><th className="w-16 px-4 py-2.5">Box</th><th className="px-4 py-2.5">Description</th><th className="px-4 py-2.5 text-right">{country === "GB" ? "Value (ex VAT)" : "Taxable value"}</th><th className="px-4 py-2.5 text-right">Tax</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.box}-${row.label}`} className={`border-b border-border last:border-0 ${row.strong ? "bg-muted/30 font-semibold" : ""}`}>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.box}</td>
                  <td className="px-4 py-2.5">{row.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.amount ? formatMoney(row.amount, currency) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.tax || row.strong ? formatMoney(row.tax, currency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Documents in this return ({lines.length})</h2>
          <div className="flex gap-1 print:hidden">
            {(["Sales", "Purchases"] as const).map((value) => <Button key={value} size="sm" variant={side === value ? "secondary" : "ghost"} onClick={() => setSide(value)}>{value}</Button>)}
          </div>
        </div>
        {lines.filter((line) => line.side === side).length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2">Date</th><th className="px-4 py-2">Document</th><th className="px-4 py-2">{side === "Sales" ? "Customer" : "Supplier"}</th><th className="px-4 py-2">Tax ID</th><th className="px-4 py-2">Tax</th><th className="px-4 py-2 text-right">Taxable value</th><th className="px-4 py-2 text-right">Tax amount</th></tr></thead>
              <tbody>{lines.filter((line) => line.side === side).map((line) => (
                <tr key={line.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 tabular-nums">{line.date}</td>
                  <td className="px-4 py-2">{line.kind} {line.number}</td>
                  <td className="px-4 py-2">{line.party || "—"}</td>
                  <td className="px-4 py-2">{line.partyTaxId || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2">{line.taxName} <span className="text-xs text-muted-foreground">({line.category})</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(line.taxable, currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(line.tax, currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">No {side.toLowerCase()} documents in this period.</p>}
      </section>
      {country === "PK" ? <p className="mt-3 text-xs text-muted-foreground">Buyers without an NTN or STRN on their customer record may attract further tax. File GST on FBR IRIS and provincial service tax with PRA, SRB, KPRA or BRA.</p> : null}
      {country === "SA" ? <p className="mt-3 text-xs text-muted-foreground">ZATCA also requires e-invoices (FATOORA) issued from an approved solution; this return covers the VAT figures only.</p> : null}
      {country === "US" ? <p className="mt-3 text-xs text-muted-foreground">Each state has its own return and due dates. Use the rows above for the taxable sales and tax collected per state rate.</p> : null}
      <section className="mt-4 rounded-lg border border-border bg-card print:hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Filed returns ({filings.length})</h2>
          <p className="text-xs text-muted-foreground">Record the payment of each return; changes to a filed period show in the Tax Exception report.</p>
        </div>
        {filings.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground"><th className="px-4 py-2.5">Period</th><th className="px-4 py-2.5">Return</th><th className="px-4 py-2.5">Filed</th><th className="px-4 py-2.5 text-right">Net tax</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {[...filings].sort((a, b) => (b.data.from ?? "").localeCompare(a.data.from ?? "")).map((filing) => (
                  <tr key={filing.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 tabular-nums">{filing.data.from} to {filing.data.to}</td>
                    <td className="px-4 py-2.5">{filing.data.returnName}</td>
                    <td className="px-4 py-2.5 tabular-nums">{(filing.data.filedAt ?? "").slice(0, 10)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(Number(filing.data.netTax || 0), currency)}</td>
                    <td className="px-4 py-2.5">{filing.data.status === "Paid" ? `Paid ${filing.data.paymentDate} · ${filing.data.paymentAccountName}` : Number(filing.data.netTax || 0) === 0 ? "Filed, nothing to pay" : "Filed, not paid"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {filing.data.status !== "Paid" && Number(filing.data.netTax || 0) !== 0 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setPaying(filing)}>Record payment</Button> : null}
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove filed return ${filing.data.from} to ${filing.data.to}`} disabled={busy} onClick={() => { if (window.confirm("Remove this filed return and its payment?")) void run(() => deleteTaxFiling(filing.id), "Filed return removed."); }}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 py-6 text-sm text-muted-foreground">No returns marked as filed yet.</p>}
      </section>

      <PaymentDialog
        open={Boolean(paying)}
        onOpenChange={(open) => { if (!open) setPaying(null); }}
        title="Record tax payment"
        description={paying ? `${paying.data.returnName} ${paying.data.from} to ${paying.data.to} · ${formatMoney(Number(paying.data.netTax || 0), currency)}` : ""}
        accountLabel="Paid from"
        submitLabel="Record payment"
        paymentAccounts={paymentAccounts}
        pending={busy}
        onSubmit={(date, accountId) => { const target = paying; setPaying(null); if (target) void run(() => recordTaxPayment(target.id, date, accountId), "Tax payment recorded."); }}
      />
    </div>
  );
}
