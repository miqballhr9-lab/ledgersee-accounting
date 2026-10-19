"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { payPayrollLiabilities } from "@/app/actions";
import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { paymentAccountLabel } from "@/lib/payment-accounts";
import { payrollLiabilityLabels, type PayrollLiabilityKind } from "@/lib/payroll-liabilities";

interface PayrollLiabilitiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owed: Record<PayrollLiabilityKind, number>;
  paymentAccounts: BookkeepingRecord[];
  format: (amount: number) => string;
  onPaid: () => void;
}

const kinds = Object.keys(payrollLiabilityLabels) as PayrollLiabilityKind[];
const defaultPayee: Record<PayrollLiabilityKind, string> = { withheld: "Tax authority", employer: "Tax authority", attachments: "" };

/** Pays over salary tax, employer contributions or salary attachments to whoever they are owed to. */
export default function PayrollLiabilitiesDialog({ open, onOpenChange, owed, paymentAccounts, format, onPaid }: PayrollLiabilitiesDialogProps) {
  const [kind, setKind] = useState<PayrollLiabilityKind>("withheld");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState(defaultPayee.withheld);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [openedFor, setOpenedFor] = useState(false);
  const selectedAccount = paymentAccounts.some((account) => account.id === accountId) ? accountId : paymentAccounts[0]?.id ?? "";

  function choose(next: PayrollLiabilityKind) {
    setKind(next);
    setAmount(owed[next] > 0 ? owed[next].toFixed(2) : "");
    setPayee(defaultPayee[next]);
  }
  // Each time it opens, start from what is owed for tax withheld.
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      choose("withheld");
      setMemo("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await payPayrollLiabilities({ kind, date, accountId: selectedAccount, amount, payee, memo });
      toast.success(`${payrollLiabilityLabels[kind]} payment recorded.`);
      onOpenChange(false);
      onPaid();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t record that payment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay taxes and contributions</DialogTitle>
          <DialogDescription>Pay over what payroll kept back or owes, so it is no longer shown as owed in your books. It is saved as an expense against the liability.</DialogDescription>
        </DialogHeader>
        <form id="payroll-liabilities-form" onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="liability-kind">What you are paying</Label>
            <Select value={kind} onValueChange={(value) => choose((value ?? "withheld") as PayrollLiabilityKind)}>
              <SelectTrigger id="liability-kind" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{kinds.map((item) => <SelectItem key={item} value={item}>{payrollLiabilityLabels[item]} · {format(Math.max(0, owed[item]))} owed</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="liability-amount">Amount</Label>
              <Input id="liability-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="liability-date">Payment date</Label>
              <Input id="liability-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Owed by payroll so far: {format(Math.max(0, owed[kind]))}. Enter the amount on the tax return or notice if it differs.</p>
          <div className="space-y-2">
            <Label htmlFor="liability-payee">Paid to</Label>
            <Input id="liability-payee" value={payee} onChange={(event) => setPayee(event.target.value)} placeholder={kind === "attachments" ? "The creditor or court" : "e.g. FBR, EOBI, Skatteverket"} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="liability-account">Paid from (Bank, Cash or Credit card)</Label>
            <Select value={selectedAccount || undefined} onValueChange={(value) => setAccountId(value ?? "")}>
              <SelectTrigger id="liability-account" className="w-full"><SelectValue placeholder="Choose a payment account" /></SelectTrigger>
              <SelectContent>{paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
            </Select>
            {!paymentAccounts.length ? <NoAccountsNotice message="You need a Cash, Bank or Credit card account to record this." /> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="liability-memo">Memo</Label>
            <Input id="liability-memo" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="e.g. Withholding tax for September" />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="payroll-liabilities-form" disabled={pending || !selectedAccount}>{pending ? "Saving…" : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
