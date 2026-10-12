"use client";

import { useState } from "react";
import { toast } from "sonner";

import { convertLead } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { dealStages, fullName } from "@/lib/crm-config";
import { errorText, type CrmContextValue } from "@/components/crm/crm-shared";

interface ConvertLeadDialogProps {
  lead: BookkeepingRecord | null;
  onOpenChange: (open: boolean) => void;
  context: CrmContextValue;
  /** Called after converting, so the screen can reload the new account, contact and deal. */
  onConverted: () => void;
}

function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function ConvertLeadDialog({ lead, onOpenChange, context, onConverted }: ConvertLeadDialogProps) {
  const [accountId, setAccountId] = useState("");
  const [createDeal, setCreateDeal] = useState(true);
  const [deal, setDeal] = useState({ dealName: "", amount: "", closingDate: inDays(30), stage: "Qualification" });
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLead, setLastLead] = useState<string | null>(null);
  if ((lead?.id ?? null) !== lastLead) {
    setLastLead(lead?.id ?? null);
    if (lead) {
      const company = lead.data.company?.trim().toLowerCase();
      const match = (context.store.customers ?? []).find((customer) => customer.data.name?.trim().toLowerCase() === company);
      setAccountId(match?.id ?? "");
      setCreateDeal(true);
      setDeal({ dealName: lead.data.company || fullName(lead.data), amount: "", closingDate: inDays(30), stage: "Qualification" });
      setOwner(lead.data.owner || context.me);
    }
  }

  if (!lead) return null;
  const customers = [...(context.store.customers ?? [])].sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  const name = fullName(lead.data) || lead.data.company;

  async function submit() {
    if (!lead) return;
    setBusy(true);
    try {
      await convertLead(lead.id, { accountId: accountId || undefined, createDeal, owner, ...deal });
      toast.success(`${name} converted.`);
      onOpenChange(false);
      onConverted();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Convert lead ({name})</DialogTitle>
          <DialogDescription>The lead becomes a contact under an account. Accounts are your customers in Sales, so you can quote and invoice them straight away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="convert-account">Account</Label>
            <Select value={accountId || "new"} onValueChange={(value) => setAccountId(value === "new" ? "" : String(value ?? ""))}>
              <SelectTrigger id="convert-account" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Create new account: {lead.data.company || name}</SelectItem>
                {customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>Add to existing: {customer.data.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">Create new contact: <span className="font-medium">{name}</span></p>
          <div className="space-y-1.5">
            <Label htmlFor="convert-owner">Assign to owner</Label>
            <Select value={owner || null} onValueChange={(value) => setOwner(String(value ?? ""))}>
              <SelectTrigger id="convert-owner" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{[...new Set([...context.owners, owner].filter(Boolean))].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={createDeal} onCheckedChange={(checked) => setCreateDeal(Boolean(checked))} />
            Create a new deal for this account
          </label>
          {createDeal ? (
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="convert-deal-name">Deal name</Label>
                <Input id="convert-deal-name" value={deal.dealName} onChange={(event) => setDeal({ ...deal, dealName: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-amount">Amount ({context.currency})</Label>
                <Input id="convert-amount" type="number" min={0} step="0.01" value={deal.amount} onChange={(event) => setDeal({ ...deal, amount: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-closing">Closing date</Label>
                <Input id="convert-closing" type="date" value={deal.closingDate} onChange={(event) => setDeal({ ...deal, closingDate: event.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="convert-stage">Stage</Label>
                <Select value={deal.stage} onValueChange={(value) => setDeal({ ...deal, stage: String(value ?? "Qualification") })}>
                  <SelectTrigger id="convert-stage" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{dealStages.filter((item) => !item.stage.startsWith("Closed")).map((item) => <SelectItem key={item.stage} value={item.stage}>{item.stage} ({item.probability}%)</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Converting…" : "Convert"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
