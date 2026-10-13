"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { payBills } from "@/app/actions";
import FullPageForm, { footerGhost } from "@/components/bookkeeping/FullPageForm";
import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount } from "@/lib/invoice-utils";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";

interface PayBillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bills: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
  onDone: () => void;
}

export function billBalance(bill: BookkeepingRecord) {
  return Math.max(0, (Number(bill.data.amount) || 0) - (Number(bill.data.paidAmount) || 0) - (Number(bill.data.creditApplied) || 0));
}

const money = (value: string) => Math.round((Number(value) || 0) * 100) / 100;
const ALL = "__all__";

/** Pay bills, as in QuickBooks: tick the bills to pay, from one account on one date. */
export default function PayBillsDialog({ open, onOpenChange, bills, accounts, currency, asOfDate, onDone }: PayBillsDialogProps) {
  const openBills = useMemo(() => bills
    .filter((bill) => !["Paid", "Cancelled", "Draft", "Void"].includes(bill.data.status ?? "") && billBalance(bill) > 0.005)
    .sort((left, right) => (left.data.dueDate || left.data.billDate || "").localeCompare(right.data.dueDate || right.data.billDate || "")), [bills]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(asOfDate);
  const [reference, setReference] = useState("");
  const [supplier, setSupplier] = useState(ALL);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const suppliers = [...new Set(openBills.map((bill) => bill.data.vendor?.trim() ?? "").filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const rows = openBills.filter((bill) => (supplier === ALL || bill.data.vendor?.trim() === supplier) && (!overdueOnly || (bill.data.dueDate && bill.data.dueDate < asOfDate)));
  const total = openBills.reduce((sum, bill) => sum + money(payments[bill.id] ?? ""), 0);
  const selectedCount = openBills.filter((bill) => money(payments[bill.id] ?? "") > 0).length;

  async function save(closeAfter: boolean) {
    setError("");
    if (!accountId) return setError("Choose the account to pay from.");
    const over = openBills.find((bill) => money(payments[bill.id] ?? "") > billBalance(bill) + 0.005);
    if (over) return setError(`The payment on ${over.data.billNumber || "a bill"} is more than its open balance.`);
    const allocations = openBills.flatMap((bill) => (money(payments[bill.id] ?? "") > 0 ? [{ id: bill.id, amount: money(payments[bill.id]).toFixed(2) }] : []));
    if (!allocations.length) return setError("Tick at least one bill to pay.");
    setPending(true);
    try {
      await payBills(date, accountId, reference, allocations);
      toast.success(`${allocations.length} ${allocations.length === 1 ? "bill" : "bills"} paid: ${currencyAmount(total, currency)}.`, { position: "top-center" });
      onDone();
      setPayments({});
      setReference("");
      if (closeAfter) onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t pay these bills. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <FullPageForm
      open={open}
      onOpenChange={onOpenChange}
      title="Pay bills"
      description="Pay several supplier bills from one account."
      footer={(
        <>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" className={footerGhost} onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="button" variant="ghost" className={footerGhost} onClick={() => setPayments({})} disabled={pending}>Clear payments</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-white" onClick={() => void save(false)} disabled={pending}>Save</Button>
            <Button type="button" onClick={() => void save(true)} disabled={pending}>{pending ? "Saving…" : "Save and close"}</Button>
          </div>
        </>
      )}
    >
      <section className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pay-bills-account">Payment account <span className="text-destructive">*</span></Label>
              <Select value={accountId || null} onValueChange={(next) => setAccountId(next ?? "")}>
                <SelectTrigger id="pay-bills-account" className="w-full"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-bills-date">Payment date <span className="text-destructive">*</span></Label>
              <Input id="pay-bills-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-bills-reference">Ref no.</Label>
              <Input id="pay-bills-reference" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} placeholder="Cheque or transfer no." />
            </div>
          </div>
          <div className="shrink-0 lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total payment amount</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums" data-testid="headline-amount">{currencyAmount(total, currency)}</p>
          </div>
        </div>
        {!paymentAccounts.length ? <NoAccountsNotice message="Add a Cash, Bank or Credit card account in Chart of accounts to pay bills from." /> : null}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          <h3 className="text-base font-semibold">Open bills <span className="ml-1 text-sm font-normal text-muted-foreground">{selectedCount} of {openBills.length} selected</span></h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={supplier} onValueChange={(next) => setSupplier(next ?? ALL)}>
              <SelectTrigger className="w-52" aria-label="Supplier"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All suppliers</SelectItem>
                {suppliers.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={overdueOnly} onCheckedChange={(checked) => setOverdueOnly(checked === true)} />Overdue only</label>
          </div>
        </div>
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide">
                <th className="w-12 px-3 py-2.5 text-left">
                  <Checkbox
                    aria-label="Pay all bills shown"
                    checked={rows.length > 0 && rows.every((bill) => money(payments[bill.id] ?? "") > 0)}
                    disabled={!rows.length}
                    onCheckedChange={(checked) => setPayments((current) => ({ ...current, ...Object.fromEntries(rows.map((bill) => [bill.id, checked === true ? billBalance(bill).toFixed(2) : ""])) }))}
                  />
                </th>
                <th className="px-2.5 py-2.5 text-left">Payee</th>
                <th className="px-2.5 py-2.5 text-left">Ref no.</th>
                <th className="px-2.5 py-2.5 text-left">Due date</th>
                <th className="px-2.5 py-2.5 text-right">Open balance</th>
                <th className="w-44 px-2.5 py-2.5 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bill) => {
                const balance = billBalance(bill);
                const value = payments[bill.id] ?? "";
                const overdue = Boolean(bill.data.dueDate && bill.data.dueDate < asOfDate);
                return (
                  <tr key={bill.id} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2"><Checkbox aria-label={`Pay ${bill.data.billNumber || "bill"}`} checked={money(value) > 0} onCheckedChange={(checked) => setPayments((current) => ({ ...current, [bill.id]: checked === true ? balance.toFixed(2) : "" }))} /></td>
                    <td className="px-2.5 py-2">{bill.data.vendor || "—"}</td>
                    <td className="px-2.5 py-2">{bill.data.billNumber || "—"}</td>
                    <td className={`px-2.5 py-2 ${overdue ? "text-destructive" : ""}`}>{bill.data.dueDate || "—"}{overdue ? <span className="ml-1.5 text-xs">Overdue</span> : null}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{currencyAmount(balance, currency)}</td>
                    <td className="px-2.5 py-1.5"><Input aria-label={`Payment for ${bill.data.billNumber || "bill"}`} type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(event) => setPayments((current) => ({ ...current, [bill.id]: event.target.value }))} className="h-9 text-right tabular-nums" /></td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">{openBills.length ? "No bills match these filters." : "There are no open bills to pay."}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="ml-auto w-full max-w-sm space-y-2 px-5 py-4 text-sm">
          <div className="flex justify-between gap-4 text-base font-semibold"><span>Total payment</span><span className="tabular-nums">{currencyAmount(total, currency)}</span></div>
        </div>
      </section>

      {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
    </FullPageForm>
  );
}
