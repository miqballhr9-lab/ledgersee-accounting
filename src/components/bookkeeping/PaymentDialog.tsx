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
  onSubmit: (date: string, accountId: string) => void;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Asks for a date and the Cash, Bank or Credit card account a payment or refund went through. */
export default function PaymentDialog({ open, onOpenChange, title, description, accountLabel = "Payment method / account", submitLabel, paymentAccounts, pending, onSubmit }: PaymentDialogProps) {
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const selectedAccount = paymentAccounts.some((account) => account.id === accountId) ? accountId : paymentAccounts[0]?.id ?? "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedAccount) onSubmit(date, selectedAccount);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id="record-payment-dialog-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-dialog-date">Date</Label>
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
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="record-payment-dialog-form" disabled={pending || !selectedAccount}>{pending ? "Saving…" : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
