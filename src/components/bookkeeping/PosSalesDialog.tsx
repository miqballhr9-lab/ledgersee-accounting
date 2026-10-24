"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CircleDollarSign, ExternalLink, Printer, Search, Trash2, Undo2 } from "lucide-react";

import { deleteBookkeepingRecord, recordInvoicePayment, undoInvoicePayments } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount } from "@/lib/invoice-utils";

const num = (value: string | undefined) => Number(value) || 0;

type Period = "today" | "week" | "all";

interface PosSalesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The till's sales receipts, newest first or not. */
  receipts: BookkeepingRecord[];
  /** Returns made against them, to warn before a sale with a return is deleted. */
  returns: BookkeepingRecord[];
  payAccounts: BookkeepingRecord[];
  currency: string;
  today: string;
  onPrint: (receipt: BookkeepingRecord) => void;
  onChanged: () => void;
  /** Only the business's Admin may delete a sale or take its payment off. */
  isAdmin?: boolean;
}

/** The till's sales: look one up, print it again, take its payment off or back on, or delete it. */
export default function PosSalesDialog({ open, onOpenChange, receipts, returns, payAccounts, currency, today, onPrint, onChanged, isAdmin = false }: PosSalesDialogProps) {
  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");
  const [payAccount, setPayAccount] = useState("");
  const money = (value: number) => currencyAmount(value, currency);

  const weekAgo = useMemo(() => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 6);
    return date.toISOString().slice(0, 10);
  }, [today]);

  const needle = search.trim().toLowerCase();
  const shown = receipts
    .filter((receipt) => receipt.data.posSale === "true")
    .filter((receipt) => period === "all" || (period === "today" ? receipt.data.issueDate === today : (receipt.data.issueDate ?? "") >= weekAgo))
    .filter((receipt) => !needle || [receipt.data.invoiceNumber, receipt.data.customer, receipt.data.posPayment].some((value) => value?.toLowerCase().includes(needle)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);

  const paidOf = (receipt: BookkeepingRecord) => num(receipt.data.paidAmount);
  const balanceOf = (receipt: BookkeepingRecord) => Math.max(0, num(receipt.data.amount) - paidOf(receipt) - num(receipt.data.creditApplied));
  const linesOf = (receipt: BookkeepingRecord): Array<{ name: string; quantity: string; rate: string; serials?: string }> => {
    try {
      const parsed: unknown = JSON.parse(receipt.data.lineItems || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  async function run(key: string, work: () => Promise<void>, done: string) {
    setBusy(key);
    try {
      await work();
      toast.success(done, { position: "top-center" });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That didn’t work. Please try again.", { position: "top-center" });
    } finally {
      setBusy("");
    }
  }

  const undoPayment = (receipt: BookkeepingRecord) => {
    if (!window.confirm(`Take the payment off ${receipt.data.invoiceNumber}? The sale stays, shown as unpaid, so you can correct it, take the payment again or delete it.`)) return;
    void run(receipt.id, () => undoInvoicePayments(receipt.id), `Payment taken off ${receipt.data.invoiceNumber}.`);
  };

  const takePayment = (receipt: BookkeepingRecord) => {
    const account = payAccount || receipt.data.paymentAccountId || payAccounts[0]?.id || "";
    if (!account) return toast.error("Add a Cash or Bank account in Chart of accounts first.", { position: "top-center" });
    void run(receipt.id, () => recordInvoicePayment(receipt.id, balanceOf(receipt).toFixed(2), today, account), `${receipt.data.invoiceNumber} is paid.`);
  };

  const remove = (receipt: BookkeepingRecord) => {
    const returned = returns.some((credit) => credit.data.sourceReceiptId === receipt.id);
    const paid = paidOf(receipt) > 0;
    if (!window.confirm(`Delete ${receipt.data.invoiceNumber} for good?${paid ? " Its payment is removed with it." : ""}${returned ? " It has a return recorded against it; the return stays and should be deleted separately." : ""} Stock sold in it goes back on hand.`)) return;
    void run(receipt.id, () => deleteBookkeepingRecord("invoices", receipt.id), `${receipt.data.invoiceNumber} deleted.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sales at the till</DialogTitle>
          <DialogDescription>{isAdmin ? "Look up a sale to print it again, take its payment off or back on, or delete it. A new sale starts on the register." : "Look up a sale to see or print it again, or take the payment of an unpaid one. Only an Admin can delete a sale or undo its payment."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Period">
            {([["today", "Today"], ["week", "Last 7 days"], ["all", "All"]] as const).map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={period === value ? "secondary" : "ghost"} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</Button>
            ))}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt number or customer" className="pl-9" aria-label="Search sales" />
          </div>
          {payAccounts.length > 1 ? (
            <Select value={payAccount || payAccounts[0].id} onValueChange={(value) => setPayAccount(String(value ?? ""))}>
              <SelectTrigger className="w-44" aria-label="Account for payments taken here"><SelectValue>{payAccounts.find((account) => account.id === (payAccount || payAccounts[0].id))?.data.name}</SelectValue></SelectTrigger>
              <SelectContent>{payAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="-mx-1 max-h-[60dvh] overflow-y-auto px-1">
          {shown.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {shown.map((receipt) => {
                const paid = paidOf(receipt) > 0;
                const balance = balanceOf(receipt);
                const expanded = openId === receipt.id;
                return (
                  <li key={receipt.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(expanded ? "" : receipt.id)} aria-expanded={expanded}>
                        <span className="block text-sm font-medium">{receipt.data.invoiceNumber} <span className="font-normal text-muted-foreground">· {receipt.data.customer}</span></span>
                        <span className="block text-xs text-muted-foreground">{new Date(receipt.createdAt).toLocaleString()} · {receipt.data.posPayment || "—"}</span>
                      </button>
                      <span className="text-sm font-semibold tabular-nums">{money(num(receipt.data.amount))}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${balance <= 0.005 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>{balance <= 0.005 ? "Paid" : paid ? "Part paid" : "Unpaid"}</span>
                      <div className="flex gap-1">
                        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Print ${receipt.data.invoiceNumber}`} title="Print receipt" onClick={() => onPrint(receipt)}><Printer size={15} /></Button>
                        {paid && isAdmin ? (
                          <Button type="button" size="sm" variant="ghost" className="gap-1" disabled={busy === receipt.id} onClick={() => undoPayment(receipt)}><Undo2 size={14} />Undo payment</Button>
                        ) : null}
                        {balance > 0.005 ? (
                          <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy === receipt.id} onClick={() => takePayment(receipt)}><CircleDollarSign size={14} />Take payment</Button>
                        ) : null}
                        {isAdmin ? <Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Delete ${receipt.data.invoiceNumber}`} title="Delete sale" disabled={busy === receipt.id} onClick={() => remove(receipt)}><Trash2 size={15} /></Button> : null}
                      </div>
                    </div>
                    {expanded ? (
                      <div className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
                        <ul className="space-y-1">
                          {linesOf(receipt).map((line, index) => (
                            <li key={index} className="flex justify-between gap-3"><span>{line.quantity} × {line.name}{line.serials ? <span className="text-xs text-muted-foreground"> · SN {line.serials}</span> : null}</span><span className="tabular-nums">{money(num(line.quantity) * num(line.rate))}</span></li>
                          ))}
                        </ul>
                        <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                          <span>{receipt.data.discount ? `Discount ${money(num(receipt.data.discount))} · ` : ""}{receipt.data.taxName ? `${receipt.data.taxName} · ` : ""}Paid {money(paidOf(receipt))}{receipt.data.paymentAccountName ? ` into ${receipt.data.paymentAccountName}` : ""}</span>
                          <Link href={`/app/invoices?open=${receipt.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Open full record<ExternalLink size={12} /></Link>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">{period === "today" ? "No sales at the till today yet." : "No sales match."}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
