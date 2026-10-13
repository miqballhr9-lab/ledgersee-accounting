"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { receiveCustomerPayment } from "@/app/actions";
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

interface ReceivePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: BookkeepingRecord[];
  invoices: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
  /** Opens on this customer, with this invoice ticked. */
  initialCustomer?: string;
  initialInvoiceId?: string;
  onDone: () => void;
}

/** What is still owed on an invoice after payments and applied credits. */
export function invoiceBalance(invoice: BookkeepingRecord) {
  return Math.max(0, (Number(invoice.data.amount) || 0) - (Number(invoice.data.paidAmount) || 0) - (Number(invoice.data.creditApplied) || 0));
}

/** Invoices a customer can still pay: sent or saved, not paid, not void, and not sales receipts. */
export function isOpenInvoice(invoice: BookkeepingRecord) {
  return invoice.kind === "invoices"
    && invoice.data.docType !== "Sales receipt"
    && !["Draft", "Void", "Cancelled", "Paid"].includes(invoice.data.status ?? "")
    && invoiceBalance(invoice) > 0.005;
}

const money = (value: string) => Math.round((Number(value) || 0) * 100) / 100;

export default function ReceivePaymentDialog({ open, onOpenChange, customers, invoices, accounts, currency, asOfDate, initialCustomer = "", initialInvoiceId = "", onDone }: ReceivePaymentDialogProps) {
  const openInvoices = useMemo(() => invoices.filter(isOpenInvoice), [invoices]);
  const startingPayments = () => {
    const invoice = openInvoices.find((entry) => entry.id === initialInvoiceId);
    return invoice ? { [invoice.id]: invoiceBalance(invoice).toFixed(2) } : {};
  };
  const [customer, setCustomer] = useState(initialCustomer);
  const [date, setDate] = useState(asOfDate);
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [payments, setPayments] = useState<Record<string, string>>(startingPayments);
  const [received, setReceived] = useState(() => Object.values(startingPayments()).reduce((sum, value) => sum + money(value), 0).toFixed(2));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const customerNames = [...new Set([
    ...customers.map((record) => record.data.name?.trim() ?? ""),
    ...openInvoices.map((invoice) => invoice.data.customer?.trim() ?? ""),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const rows = openInvoices
    .filter((invoice) => invoice.data.customer?.trim() === customer)
    .sort((left, right) => (left.data.dueDate || left.data.issueDate || "").localeCompare(right.data.dueDate || right.data.issueDate || ""));
  const openTotal = rows.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const applied = rows.reduce((sum, invoice) => sum + money(payments[invoice.id] ?? ""), 0);
  const customerRecord = customers.find((record) => record.data.name?.trim() === customer);

  function setRowPayments(next: Record<string, string>) {
    setPayments(next);
    setReceived(rows.reduce((sum, invoice) => sum + money(next[invoice.id] ?? ""), 0).toFixed(2));
  }

  // Like QuickBooks, an amount received is applied to the oldest invoices first.
  function applyReceived(value: string) {
    setReceived(value);
    let remaining = money(value);
    const next: Record<string, string> = {};
    for (const invoice of rows) {
      const take = Math.min(remaining, invoiceBalance(invoice));
      if (take > 0.005) next[invoice.id] = take.toFixed(2);
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setPayments(next);
  }

  function reset() {
    setPayments({});
    setReceived("");
    setReference("");
    setError("");
  }

  async function save(closeAfter: boolean) {
    setError("");
    if (!customer) return setError("Choose a customer.");
    if (!accountId) return setError("Choose the account the payment was deposited to.");
    const over = rows.find((invoice) => money(payments[invoice.id] ?? "") > invoiceBalance(invoice) + 0.005);
    if (over) return setError(`The payment on ${over.data.invoiceNumber || "an invoice"} is more than its open balance.`);
    if (money(received) > applied + 0.005) return setError(`Apply the whole ${currencyAmount(money(received), currency)} to open invoices. The open balance is ${currencyAmount(openTotal, currency)}.`);
    const allocations = rows.flatMap((invoice) => (money(payments[invoice.id] ?? "") > 0 ? [{ id: invoice.id, amount: money(payments[invoice.id]).toFixed(2) }] : []));
    if (!allocations.length) return setError("Enter a payment against at least one invoice.");
    setPending(true);
    try {
      await receiveCustomerPayment(date, accountId, reference, allocations);
      toast.success(`Payment of ${currencyAmount(applied, currency)} received from ${customer}.`, { position: "top-center" });
      onDone();
      if (closeAfter) onOpenChange(false);
      else {
        setCustomer("");
        reset();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t record this payment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <FullPageForm
      open={open}
      onOpenChange={onOpenChange}
      title="Receive payment"
      description="Record a customer payment and apply it to their open invoices."
      footer={(
        <>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" className={footerGhost} onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="button" variant="ghost" className={footerGhost} onClick={reset} disabled={pending}>Clear payment</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-white" onClick={() => void save(false)} disabled={pending}>Save and new</Button>
            <Button type="button" onClick={() => void save(true)} disabled={pending}>{pending ? "Saving…" : "Save and close"}</Button>
          </div>
        </>
      )}
    >
      <section className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="receive-customer">Customer <span className="text-destructive">*</span></Label>
              <Select value={customer || null} onValueChange={(next) => { setCustomer(next ?? ""); reset(); }}>
                <SelectTrigger id="receive-customer" className="w-full"><SelectValue placeholder="Choose a customer" /></SelectTrigger>
                <SelectContent>
                  {customerNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {customerRecord ? (
              <div className="min-w-0 space-y-2">
                <Label>Customer email</Label>
                <p className="flex h-9 items-center truncate rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">{customerRecord.data.email?.trim() || "No email saved for this customer"}</p>
              </div>
            ) : null}
          </div>
          <div className="shrink-0 lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount received</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums" data-testid="headline-amount">{currencyAmount(applied, currency)}</p>
          </div>
        </div>
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="receive-date">Payment date <span className="text-destructive">*</span></Label>
            <Input id="receive-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-reference">Reference no.</Label>
            <Input id="receive-reference" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-account">Deposit to <span className="text-destructive">*</span></Label>
            <Select value={accountId || null} onValueChange={(next) => setAccountId(next ?? "")}>
              <SelectTrigger id="receive-account" className="w-full"><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-amount">Amount received</Label>
            <Input id="receive-amount" type="number" min="0" step="0.01" inputMode="decimal" value={received} disabled={!customer} onChange={(event) => applyReceived(event.target.value)} className="text-right tabular-nums" />
          </div>
        </div>
        {!paymentAccounts.length ? <NoAccountsNotice message="Add a Cash, Bank or Credit card account in Chart of accounts to deposit payments to." /> : null}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h3 className="px-5 pb-3 pt-4 text-base font-semibold">Outstanding transactions</h3>
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide">
                <th className="w-12 px-3 py-2.5 text-left">
                  <Checkbox
                    aria-label="Pay all open invoices"
                    checked={rows.length > 0 && rows.every((invoice) => money(payments[invoice.id] ?? "") > 0)}
                    disabled={!rows.length}
                    onCheckedChange={(checked) => setRowPayments(checked === true ? Object.fromEntries(rows.map((invoice) => [invoice.id, invoiceBalance(invoice).toFixed(2)])) : {})}
                  />
                </th>
                <th className="px-2.5 py-2.5 text-left">Description</th>
                <th className="px-2.5 py-2.5 text-left">Due date</th>
                <th className="px-2.5 py-2.5 text-right">Original amount</th>
                <th className="px-2.5 py-2.5 text-right">Open balance</th>
                <th className="w-44 px-2.5 py-2.5 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => {
                const balance = invoiceBalance(invoice);
                const value = payments[invoice.id] ?? "";
                return (
                  <tr key={invoice.id} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Checkbox aria-label={`Pay ${invoice.data.invoiceNumber || "invoice"}`} checked={money(value) > 0} onCheckedChange={(checked) => setRowPayments({ ...payments, [invoice.id]: checked === true ? balance.toFixed(2) : "" })} />
                    </td>
                    <td className="px-2.5 py-2">Invoice # {invoice.data.invoiceNumber || "—"} <span className="text-muted-foreground">({invoice.data.issueDate || invoice.createdAt.slice(0, 10)})</span></td>
                    <td className={`px-2.5 py-2 ${invoice.data.dueDate && invoice.data.dueDate < asOfDate ? "text-destructive" : ""}`}>{invoice.data.dueDate || "—"}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{currencyAmount(Number(invoice.data.amount) || 0, currency)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{currencyAmount(balance, currency)}</td>
                    <td className="px-2.5 py-1.5">
                      <Input aria-label={`Payment for ${invoice.data.invoiceNumber || "invoice"}`} type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(event) => setRowPayments({ ...payments, [invoice.id]: event.target.value })} className="h-9 text-right tabular-nums" />
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">{customer ? `${customer} has no open invoices.` : "Choose a customer to see their open invoices."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="ml-auto w-full max-w-sm space-y-2 px-5 py-4 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Open balance</span><span className="tabular-nums">{currencyAmount(openTotal, currency)}</span></div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold"><span>Amount to apply</span><span className="tabular-nums">{currencyAmount(applied, currency)}</span></div>
        </div>
      </section>

      {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
    </FullPageForm>
  );
}
