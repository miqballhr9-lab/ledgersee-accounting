"use client";

import { useState, type FormEvent } from "react";

import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { paymentAccountLabel } from "@/lib/payment-accounts";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  accountLabel?: string;
  submitLabel: string;
  paymentAccounts: BookkeepingRecord[];
  pending: boolean;
  /**
   * The balance still to pay, when one document is being paid. Shows an
   * amount box (filled with this balance) so part of it can be paid.
   */
  amountDue?: number;
  amountLabel?: string;
  onSubmit: (date: string, accountId: string, amount?: string) => void;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Asks for a date and the Cash, Bank or Credit card account a payment or refund went through. */
export default function PaymentDialog({ open, onOpenChange, title, description, accountLabel = "Payment method / account", submitLabel, paymentAccounts, pending, amountDue, amountLabel = "Amount paid", onSubmit }: PaymentDialogProps) {
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountFor, setAmountFor] = useState<string>("");
  const [error, setError] = useState("");
  const selectedAccount = paymentAccounts.some((account) => account.id === accountId) ? accountId : paymentAccounts[0]?.id ?? "";
  // Start from the full balance each time the dialog opens for a document.
  const key = open && amountDue !== undefined ? `${title}-${description}-${amountDue}` : "";
  if (key !== amountFor) {
    setAmountFor(key);
    setAmount(amountDue !== undefined ? amountDue.toFixed(2) : "");
    setError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    if (amountDue !== undefined) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount greater than zero."); return; }
      if (value > amountDue + 0.005) { setError(`That is more than the ${amountDue.toFixed(2)} still to pay.`); return; }
      onSubmit(date, selectedAccount, value.toFixed(2));
      return;
    }
    onSubmit(date, selectedAccount);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id="record-payment-dialog-form" onSubmit={handleSubmit} className="space-y-4">
          {amountDue !== undefined ? (
            <div className="space-y-2">
              <Label htmlFor="payment-dialog-amount">{amountLabel}</Label>
              <Input id="payment-dialog-amount" type="number" min="0.01" step="0.01" max={amountDue.toFixed(2)} value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} required />
              <p className="text-xs text-muted-foreground">Balance {amountDue.toFixed(2)}. Pay less to leave the rest open.</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="payment-dialog-date">Payment date</Label>
            <Input id="payment-dialog-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-dialog-account">{accountLabel}</Label>
            <Select value={selectedAccount || undefined} onValueChange={(value) => setAccountId(value ?? "")}>
              <SelectTrigger id="payment-dialog-account" className="w-full"><SelectValue placeholder="Choose a payment account" /></SelectTrigger>
              <SelectContent>{paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
            </Select>
            {!paymentAccounts.length ? <NoAccountsNotice message="You need a Cash, Bank or Credit card account to record this." /> : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="record-payment-dialog-form" disabled={pending || !selectedAccount}>{pending ? "Saving…" : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
