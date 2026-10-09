"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

import { saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface AccountEditorSheetProps {
  accounts: BookkeepingRecord[];
  open: boolean;
  record: BookkeepingRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
}

const accountTypes = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;

const detailTypes: Record<(typeof accountTypes)[number], readonly string[]> = {
  Asset: ["Bank", "Cash", "Accounts receivable", "Other current assets", "Fixed assets", "Other assets"],
  Liability: ["Accounts payable", "Credit card", "Current liabilities", "Long-term liabilities"],
  Equity: ["Owner’s equity", "Retained earnings", "Opening balance equity"],
  Income: ["Sales", "Service income", "Other income"],
  Expense: ["Advertising", "Cost of goods sold", "Office expenses", "Payroll expenses", "Travel", "Other expenses"],
};

function getInitialValues(record: BookkeepingRecord | null): Record<string, string> {
  return {
    code: record?.data.code ?? "",
    name: record?.data.name ?? "",
    type: record?.data.type ?? "Asset",
    detailType: record?.data.detailType ?? "Bank",
    subAccount: record?.data.subAccount ?? "false",
    parentAccount: record?.data.parentAccount ?? "",
    openingBalance: record?.data.openingBalance ?? "",
    description: record?.data.description ?? "",
    locked: record?.data.locked ?? "false",
  };
}

export default function AccountEditorSheet({ accounts, open, record, onOpenChange, onSaved }: AccountEditorSheetProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(record));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(getInitialValues(record));
      setError("");
    }
  }, [open, record]);

  const isLocked = values.locked === "true";
  const recordWasLocked = record?.data.locked === "true";
  const fieldsDisabled = recordWasLocked || isLocked;
  const isEditing = record !== null;
  const currentType = accountTypes.find((accountType) => accountType === values.type) ?? "Asset";
  const parentOptions = accounts.filter((account) => account.id !== record?.id && account.data.name?.trim());

  function changeValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const saved = await saveBookkeepingRecord("accounts", values, record?.id);
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this account. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b border-border px-6 py-5 pr-14">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-primary">
            {isLocked ? <LockKeyhole size={14} /> : null}
            {isLocked ? "Locked account" : "Chart of accounts"}
          </div>
          <SheetTitle className="text-xl">{isEditing ? "Edit account" : "New account"}</SheetTitle>
          <SheetDescription>
            {isLocked ? "Unlock this account before changing its details." : "Add the account details used to organize your books and journal entries."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-code">Account number</Label>
                <Input id="account-code" value={values.code} onChange={(event) => changeValue("code", event.target.value)} placeholder="e.g. 1010" required disabled={fieldsDisabled || pending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-name">Account name</Label>
                <Input id="account-name" value={values.name} onChange={(event) => changeValue("name", event.target.value)} placeholder="e.g. Checking account" required disabled={fieldsDisabled || pending} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Account type</Label>
                <Select
                  value={currentType}
                  onValueChange={(value) => {
                    const nextType = accountTypes.find((accountType) => accountType === value) ?? "Asset";
                    setValues((current) => ({ ...current, type: nextType, detailType: detailTypes[nextType][0] }));
                  }}
                  disabled={fieldsDisabled || pending}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{accountTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Detail type</Label>
                <Select value={values.detailType} onValueChange={(value) => changeValue("detailType", value ?? "")} disabled={fieldsDisabled || pending}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{detailTypes[currentType].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={values.subAccount === "true"}
                  onCheckedChange={(checked) => changeValue("subAccount", checked ? "true" : "false")}
                  disabled={fieldsDisabled || pending}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">Make this a sub-account</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Nest it under another account in your chart.</span>
                </span>
              </label>
              {values.subAccount === "true" ? (
                <div className="mt-4 space-y-2 pl-7">
                  <Label>Parent account</Label>
                  <Select value={values.parentAccount || "none"} onValueChange={(value) => changeValue("parentAccount", value && value !== "none" ? value : "")} disabled={fieldsDisabled || pending}>
                  <SelectTrigger className="w-full" disabled={fieldsDisabled || pending}><SelectValue placeholder="Choose a parent account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Choose a parent account</SelectItem>
                      {parentOptions.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.code ? `${account.data.code} · ` : ""}{account.data.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-opening-balance">Opening balance</Label>
              <Input id="account-opening-balance" type="number" inputMode="decimal" step="0.01" value={values.openingBalance} onChange={(event) => changeValue("openingBalance", event.target.value)} placeholder="0.00" disabled={fieldsDisabled || pending} />
              <p className="text-xs text-muted-foreground">Enter the balance for this account when you start using MIKLEDGER.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-description">Description</Label>
              <Textarea id="account-description" value={values.description} onChange={(event) => changeValue("description", event.target.value)} placeholder="Add a note about how this account is used." className="min-h-24 resize-y" disabled={fieldsDisabled || pending} />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
              <Checkbox
                checked={isLocked}
                onCheckedChange={(checked) => changeValue("locked", checked ? "true" : "false")}
                disabled={pending}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">Lock this account</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Prevent account details from being changed until it’s unlocked.</span>
              </span>
            </label>

            {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" className="min-w-32" disabled={pending}>{pending ? "Saving…" : recordWasLocked && !isLocked ? "Unlock account" : isLocked ? "Lock account" : isEditing ? "Save changes" : "Save account"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
