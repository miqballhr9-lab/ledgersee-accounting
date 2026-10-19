"use client";

import { useState } from "react";
import { toast } from "sonner";

import { saveBookkeepingRecord } from "@/app/actions";
import { refundCustomerCredit } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount, invoiceTax, parseInvoiceLines, serialList } from "@/lib/invoice-utils";

interface PosReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipts: BookkeepingRecord[];
  returns: BookkeepingRecord[];
  items: BookkeepingRecord[];
  payAccounts: BookkeepingRecord[];
  currency: string;
  today: string;
  onDone: () => void;
}

const num = (value: string | undefined) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Takes goods back at the till against a sales receipt: a credit note for
 * what comes back (stock and serial numbers return to the warehouse they
 * left) refunded at once from the cash or bank account chosen.
 */
export default function PosReturnDialog({ open, onOpenChange, receipts, returns, items, payAccounts, currency, today, onDone }: PosReturnDialogProps) {
  const sorted = [...receipts].sort((a, b) => (b.data.issueDate ?? "").localeCompare(a.data.issueDate ?? "") || (b.data.invoiceNumber ?? "").localeCompare(a.data.invoiceNumber ?? ""));
  const [receiptId, setReceiptId] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [chosenSerials, setChosenSerials] = useState<Record<number, string[]>>({});
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const money = (value: number) => currencyAmount(value, currency);

  const receipt = sorted.find((entry) => entry.id === receiptId);
  const lines = receipt ? parseInvoiceLines(receipt.data.lineItems ?? "") : [];
  const earlier = returns.filter((credit) => credit.data.sourceReceiptId === receipt?.id && credit.data.status !== "Void");
  // What earlier returns already took back from each line.
  const returnedQty = (itemId: string, name: string) => earlier.reduce((sum, credit) => sum + parseInvoiceLines(credit.data.lineItems ?? "").filter((line) => (itemId ? line.itemId === itemId : line.name === name)).reduce((total, line) => total + num(line.quantity), 0), 0);
  const returnedSerials = new Set(earlier.flatMap((credit) => parseInvoiceLines(credit.data.lineItems ?? "").flatMap((line) => serialList(line.serials))));
  const isSerial = (itemId: string) => items.find((item) => item.id === itemId)?.data.tracking === "Serial number";

  const rows = lines.map((line, index) => {
    const serial = isSerial(line.itemId);
    const left = Math.max(0, num(line.quantity) - returnedQty(line.itemId, line.name));
    const serialsLeft = serial ? serialList(line.serials).filter((value) => !returnedSerials.has(value)) : [];
    const quantity = serial ? (chosenSerials[index] ?? []).length : Math.min(left, Math.max(0, Math.floor(num(quantities[index]))));
    return { line, index, serial, left, serialsLeft, quantity };
  });
  const back = rows.filter((row) => row.quantity > 0);
  const receiptSubtotal = lines.reduce((sum, line) => sum + num(line.quantity) * num(line.rate), 0);
  const subtotal = back.reduce((sum, row) => sum + row.quantity * num(row.line.rate), 0);
  // The receipt's discount comes back in proportion to what is returned.
  const discount = receiptSubtotal > 0 ? Math.round(num(receipt?.data.discount) * (subtotal / receiptSubtotal) * 100) / 100 : 0;
  const returnLines = back.map((row) => ({ itemId: row.line.itemId, name: row.line.name, description: "Returned at the till", quantity: String(row.quantity), rate: row.line.rate, ...(row.line.taxRate ? { taxRate: row.line.taxRate } : {}), ...(row.serial ? { serials: (chosenSerials[row.index] ?? []).join(", ") } : {}) }));
  const tax = invoiceTax(returnLines, num(receipt?.data.taxRate));
  const refund = Math.max(0, subtotal + tax - discount);
  // The refund goes back the way the sale was paid, unless another account is chosen.
  const paidInto = receipt?.data.paymentAccountId || "";
  const selectedAccount = payAccounts.some((account) => account.id === accountId) ? accountId : payAccounts.some((account) => account.id === paidInto) ? paidInto : payAccounts[0]?.id ?? "";

  function choose(id: string) {
    setReceiptId(id);
    setQuantities({});
    setChosenSerials({});
    setAccountId("");
  }

  async function submit() {
    if (!receipt || !back.length || !selectedAccount) return;
    setSaving(true);
    try {
      const sequence = Math.max(0, ...returns.map((credit) => Number(/^POSR-(\d+)$/.exec(credit.data.creditNumber ?? "")?.[1] ?? 0))) + 1;
      const credit = await saveBookkeepingRecord("credit-notes", {
        creditNumber: `POSR-${String(sequence).padStart(4, "0")}`,
        invoiceNumber: receipt.data.invoiceNumber ?? "",
        customer: receipt.data.customer ?? "",
        ...(receipt.data.customerId ? { customerId: receipt.data.customerId } : {}),
        date: today,
        currency: receipt.data.currency || currency,
        exchangeRate: receipt.data.exchangeRate || "1",
        lineItems: JSON.stringify(returnLines),
        taxRate: receipt.data.taxRate || "",
        discount: discount ? discount.toFixed(2) : "",
        reason: `Returned at the till from ${receipt.data.invoiceNumber || "a sales receipt"}`,
        ...(receipt.data.warehouse ? { warehouse: receipt.data.warehouse } : {}),
        sourceReceiptId: receipt.id,
        posReturn: "true",
      });
      await refundCustomerCredit(credit.id, today, selectedAccount);
      toast.success(`Refunded ${money(refund)} for ${receipt.data.invoiceNumber}.`, { position: "top-center" });
      choose("");
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "The return couldn’t be saved.", { position: "top-center" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return and refund</DialogTitle>
          <DialogDescription>Choose the receipt, then what is coming back. The stock returns to the shelf and the money is refunded.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pos-return-receipt">Receipt</Label>
            <Select value={receiptId || null} onValueChange={(value) => choose(value ?? "")}>
              <SelectTrigger id="pos-return-receipt" className="w-full"><SelectValue placeholder="Choose a receipt">{receipt ? `${receipt.data.invoiceNumber} · ${receipt.data.issueDate} · ${money(num(receipt.data.amount))}` : undefined}</SelectValue></SelectTrigger>
              <SelectContent>{sorted.slice(0, 200).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.data.invoiceNumber} · {entry.data.issueDate} · {entry.data.customer} · {money(num(entry.data.amount))}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {receipt ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((row) => (
                <li key={row.index} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.line.name}</p>
                      <p className="text-xs text-muted-foreground">{row.line.quantity} sold × {money(num(row.line.rate))}{row.left < num(row.line.quantity) ? ` · ${num(row.line.quantity) - row.left} already returned` : ""}</p>
                    </div>
                    {row.serial ? null : (
                      <Input aria-label={`Quantity of ${row.line.name} to return`} className="h-9 w-20 text-center tabular-nums" type="number" min="0" max={row.left} step="1" disabled={!row.left} value={quantities[row.index] ?? ""} placeholder="0" onChange={(event) => setQuantities((current) => ({ ...current, [row.index]: event.target.value }))} />
                    )}
                  </div>
                  {row.serial ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {row.serialsLeft.length ? row.serialsLeft.map((value) => (
                        <label key={value} className="flex items-center gap-1.5 text-xs">
                          <Checkbox checked={(chosenSerials[row.index] ?? []).includes(value)} onCheckedChange={(checked) => setChosenSerials((current) => ({ ...current, [row.index]: checked ? [...(current[row.index] ?? []), value] : (current[row.index] ?? []).filter((item) => item !== value) }))} />
                          SN {value}
                        </label>
                      )) : <p className="text-xs text-muted-foreground">All returned.</p>}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {receipt ? (
            <div className="space-y-1.5">
              <Label htmlFor="pos-return-account">Refund from</Label>
              <Select value={selectedAccount || null} onValueChange={(value) => setAccountId(value ?? "")}>
                <SelectTrigger id="pos-return-account" className="w-full"><SelectValue placeholder="Choose an account">{payAccounts.find((account) => account.id === selectedAccount)?.data.name}</SelectValue></SelectTrigger>
                <SelectContent>{payAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          {back.length ? (
            <dl className="space-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Returned goods</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
              {discount ? <div className="flex justify-between"><dt className="text-muted-foreground">Discount given back</dt><dd className="tabular-nums">−{money(discount)}</dd></div> : null}
              {tax ? <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{money(tax)}</dd></div> : null}
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Refund</dt><dd className="tabular-nums" data-testid="pos-refund">{money(refund)}</dd></div>
            </dl>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !back.length || !selectedAccount}>{saving ? "Saving…" : `Refund ${back.length ? money(refund) : ""}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
