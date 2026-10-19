"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Globe, Landmark, Save, Users } from "lucide-react";

import { applyCountryPack, saveTaxRegistrations, type TaxSetupState } from "@/app/tax-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readableError } from "@/lib/action-error";
import { countryPacks, isCountryCode, type CountryCode } from "@/lib/tax-packs";

function errorText(error: unknown) {
  return error instanceof Error ? readableError(error) : "Something went wrong. Please try again.";
}

export default function TaxSetupWorkspace({ state }: { state: TaxSetupState }) {
  const router = useRouter();
  const current = isCountryCode(state.settings.taxCountry) ? state.settings.taxCountry : null;
  const [chosen, setChosen] = useState<CountryCode>(current ?? "PK");
  const [updateSettings, setUpdateSettings] = useState(!current);
  const [registrations, setRegistrations] = useState<Record<string, string>>(() => ({ ntn: state.settings.ntn ?? "", strn: state.settings.strn ?? "", trn: state.settings.trn ?? "", cr: state.settings.cr ?? "", utr: state.settings.utr ?? "" }));
  const [busy, setBusy] = useState("");
  const pack = countryPacks[chosen];

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7 sm:py-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounts / Tax setup</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Tax setup</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Choose the country your business files taxes in. Its tax rates, tax accounts and payroll rules are added in one go, and Tax returns are laid out the way its tax authority asks.</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(countryPacks) as CountryCode[]).map((code) => {
          const item = countryPacks[code];
          return (
            <button key={code} type="button" onClick={() => setChosen(code)} aria-pressed={chosen === code}
              className={`rounded-lg border p-4 text-left transition-colors ${chosen === code ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/40"}`}>
              <span className="flex items-center justify-between gap-2 font-semibold">{item.country}{current === code ? <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">In use</span> : null}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.currency} · {item.returnName}</span>
            </button>
          );
        })}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3"><Globe size={16} className="text-primary" /><h2 className="text-sm font-semibold">{pack.country} pack</h2></div>
          <div className="space-y-4 p-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Tax</th><th className="py-1.5 pr-3">Rate</th><th className="py-1.5 pr-3">Type</th><th className="py-1.5">Used on</th></tr></thead>
                <tbody>{pack.taxes.map((tax) => (
                  <tr key={tax.name} className="border-t border-border align-top">
                    <td className="py-2 pr-3"><p className="font-medium">{tax.name}{tax.isDefault ? <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">Default</span> : null}</p><p className="text-xs text-muted-foreground">{tax.jurisdiction}{tax.note ? ` · ${tax.note}` : ""}</p></td>
                    <td className="py-2 pr-3 tabular-nums">{tax.rate}%</td>
                    <td className="py-2 pr-3">{tax.type}</td>
                    <td className="py-2">{tax.appliesTo}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Tax accounts added to your chart of accounts</p>
              <ul className="mt-1.5 grid gap-1 text-sm sm:grid-cols-2">{pack.accounts.map((account) => <li key={account.name} className="flex gap-1.5"><Landmark size={14} className="mt-0.5 shrink-0 text-muted-foreground" />{account.code} · {account.name}</li>)}</ul>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={updateSettings} onCheckedChange={(checked) => setUpdateSettings(Boolean(checked))} className="mt-0.5" />
              <span>Also set currency to {pack.currency}, fiscal year to start in {pack.fiscalYear} and time zone to {pack.timeZone}.</span>
            </label>
            <p className="flex gap-2 rounded-md bg-chart-3/15 px-3 py-2 text-xs"><AlertTriangle size={14} className="mt-0.5 shrink-0" />Rates change with budgets and notifications. Check them against the tax authority before filing; you can edit any rate afterwards in Taxes.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" className="gap-2" disabled={!state.canChange || Boolean(busy)} onClick={() => void act("apply", async () => {
                const result = await applyCountryPack(chosen, { updateSettings });
                toast.success(`${pack.country} pack applied: ${result.taxesAdded} tax rates and ${result.accountsAdded} accounts added.`);
              })}><Check size={15} />{busy === "apply" ? "Applying…" : current === chosen ? `Re-apply ${pack.country} pack` : `Use ${pack.country}`}</Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/app/taxes" />}>Edit tax rates ({state.taxes.length})</Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/app/tax-returns" />}>Tax returns</Button>
              {!state.canChange ? <span className="text-xs text-muted-foreground">Only an Admin can change the country.</span> : null}
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Your registration numbers</h2><p className="text-xs text-muted-foreground">Printed on your invoices.</p></div>
            <form className="space-y-3 p-4" onSubmit={(event) => {
              event.preventDefault();
              void act("registrations", async () => { await saveTaxRegistrations(registrations); toast.success("Registration numbers saved."); });
            }}>
              {pack.registrations.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`reg-${field.key}`}>{field.label}</Label>
                  <Input id={`reg-${field.key}`} value={registrations[field.key] ?? ""} placeholder={field.placeholder} disabled={!state.canChange} onChange={(event) => setRegistrations({ ...registrations, [field.key]: event.target.value })} />
                </div>
              ))}
              <Button type="submit" variant="outline" className="gap-2" disabled={!state.canChange || Boolean(busy)}><Save size={14} />Save numbers</Button>
            </form>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3"><Users size={16} className="text-primary" /><h2 className="text-sm font-semibold">Payroll rules in {pack.country}</h2></div>
            <div className="space-y-2 p-4 text-sm">
              {pack.payroll.employer ? <p className="rounded-md bg-primary/5 px-3 py-2 text-xs"><span className="font-medium">Booked with each payroll row:</span> {pack.payroll.employer.label}, as an employer cost owed to the tax authority.</p> : null}
              {pack.payroll.notes.map((note) => <p key={note}>{note}</p>)}
              <p className="text-muted-foreground">{pack.payroll.gratuity}</p>
              {pack.payroll.incomeTax === "pakistan-slabs" ? (
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Yearly taxable salary (Rs)</th><th className="py-1">Tax</th></tr></thead>
                  <tbody>
                    {[["Up to 600,000", "0"], ["600,001 – 1,200,000", "1% over 600,000"], ["1,200,001 – 2,200,000", "6,000 + 11% over 1.2m"], ["2,200,001 – 3,200,000", "116,000 + 20% over 2.2m"], ["3,200,001 – 4,100,000", "316,000 + 25% over 3.2m"], ["4,100,001 – 5,600,000", "541,000 + 29% over 4.1m"], ["5,600,001 – 7,000,000", "976,000 + 32% over 5.6m"], ["Above 7,000,000", "1,424,000 + 35% over 7m"]].map(([band, tax]) => (
                      <tr key={band} className="border-t border-border"><td className="py-1">{band}</td><td className="py-1">{tax}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>

          {pack.companyTax ? (
            <section className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3"><Landmark size={16} className="text-primary" /><h2 className="text-sm font-semibold">Tax on profit in {pack.country}</h2><span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{pack.companyTax.rate}</span></div>
              <div className="space-y-2 p-4 text-sm">{pack.companyTax.notes.map((note) => <p key={note}>{note}</p>)}</div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
