"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronDown, LockKeyhole } from "lucide-react";

import { saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
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
import { accountCategoryForType, accountDetailsForType, accountTypeGroups, inferAccountType, migrateDetailType } from "@/lib/account-types";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface AccountEditorSheetProps {
  accounts: BookkeepingRecord[];
  currency: string;
  open: boolean;
  record: BookkeepingRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
}

function getInitialValues(record: BookkeepingRecord | null): Record<string, string> {
  const legacyType = record?.data.type ?? "";
  const legacyDetail = record?.data.detailType ?? "";
  const accountType = record?.data.accountType || inferAccountType(legacyType, legacyDetail);

  return {
    code: record?.data.code ?? "",
    name: record?.data.name ?? "",
    type: legacyType,
    accountType,
    detailType: migrateDetailType(accountType, legacyDetail),
    subAccount: record?.data.subAccount ?? "false",
    parentAccount: record?.data.parentAccount ?? "",
    openingBalance: record?.data.openingBalance ?? "",
    openingBalanceDate: record?.data.openingBalanceDate ?? record?.createdAt.slice(0, 10) ?? "",
    description: record?.data.description ?? "",
    locked: record?.data.locked ?? "false",
  };
}

function localToday() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function AccountEditorSheet({ accounts, currency, open, record, onOpenChange, onSaved }: AccountEditorSheetProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(record));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const saveNewSubmitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      const initialValues = getInitialValues(record);
      if (!record && !initialValues.openingBalanceDate) initialValues.openingBalanceDate = localToday();
      setValues(initialValues);
      setError("");
    }
  }, [open, record]);

  const isLocked = values.locked === "true";
  const recordWasLocked = record?.data.locked === "true";
  const fieldsDisabled = recordWasLocked || isLocked;
  const isEditing = record !== null;
  const detailTypes = accountDetailsForType(values.accountType);
  const parentOptions = accounts.filter((account) => account.id !== record?.id && account.data.name?.trim() && account.data.subAccount !== "true" && account.data.type === values.type);
  const openingBalanceTotals = useMemo(() => {
    const totals: Record<"Asset" | "Liability" | "Equity", number> = { Asset: 0, Liability: 0, Equity: 0 };
    accounts.forEach((account) => {
      if (account.id === record?.id) return;
      const category = account.data.type || accountCategoryForType(account.data.accountType ?? "");
      if (!(category in totals)) return;
      const effectiveDate = account.data.openingBalanceDate || account.createdAt.slice(0, 10);
      if (values.openingBalanceDate && effectiveDate > values.openingBalanceDate) return;
      totals[category as keyof typeof totals] += Number(account.data.openingBalance || 0) || 0;
    });

    const selectedCategory = accountCategoryForType(values.accountType);
    if (values.name.trim() && selectedCategory in totals) {
      totals[selectedCategory as keyof typeof totals] += Number(values.openingBalance || 0) || 0;
    }
    return totals;
  }, [accounts, record?.id, values.accountType, values.name, values.openingBalance, values.openingBalanceDate]);

  function changeValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function selectAccountType(accountType: string) {
    const category = accountCategoryForType(accountType);
    const nextDetailType = accountDetailsForType(accountType)[0] ?? "";
    setValues((current) => ({
      ...current,
      type: category,
      accountType,
      detailType: nextDetailType,
      parentAccount: current.type === category ? current.parentAccount : "",
    }));
  }

  function submitWithIntent(button: HTMLButtonElement | null) {
    if (button) formRef.current?.requestSubmit(button);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent = submitter === saveNewSubmitRef.current ? "save-and-new" : null;
    setPending(true);
    setError("");

    try {
      const saved = await saveBookkeepingRecord("accounts", values, record?.id);
      onSaved(saved);
      if (intent === "save-and-new" && !record) {
        const nextValues = getInitialValues(null);
        nextValues.openingBalanceDate = localToday();
        setValues(nextValues);
        formRef.current?.querySelector<HTMLInputElement>("#account-name")?.focus();
      } else {
        onOpenChange(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this account. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[760px]">
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

        <form ref={formRef} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <button ref={saveNewSubmitRef} type="submit" name="intent" value="save-and-new" className="hidden" tabIndex={-1} aria-hidden="true" />
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-name">Account name <span className="text-destructive">*</span></Label>
                <Input id="account-name" value={values.name} onChange={(event) => changeValue("name", event.target.value)} placeholder="e.g. Checking account" required disabled={fieldsDisabled || pending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-code">Account number</Label>
                <Input id="account-code" value={values.code} onChange={(event) => changeValue("code", event.target.value)} placeholder="Optional" disabled={fieldsDisabled || pending} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-type">Account type <span className="text-destructive">*</span></Label>
                <Select
                  value={values.accountType}
                  onValueChange={(value) => selectAccountType(value ?? "")}
                  disabled={fieldsDisabled || pending}
                >
                  <SelectTrigger id="account-type" className="w-full"><SelectValue placeholder="Select account type" /></SelectTrigger>
                  <SelectContent align="start" className="max-h-[min(70dvh,560px)]">
                    {accountTypeGroups.map((group) => (
                      <SelectGroup key={group.category}>
                        <SelectLabel>{group.heading}</SelectLabel>
                        {group.accountTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-detail-type">Detail type <span className="text-destructive">*</span></Label>
                <Select value={values.detailType} onValueChange={(value) => changeValue("detailType", value ?? "")} disabled={fieldsDisabled || pending || !values.accountType}>
                  <SelectTrigger id="account-detail-type" className="w-full"><SelectValue placeholder="Select detail type" /></SelectTrigger>
                  <SelectContent align="start" className="max-h-[min(70dvh,560px)]">
                    {detailTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
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
                      {parentOptions.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-opening-balance">Opening balance</Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="account-opening-balance" type="number" inputMode="decimal" step="0.01" value={values.openingBalance} onChange={(event) => changeValue("openingBalance", event.target.value)} placeholder="0.00" disabled={fieldsDisabled || pending} />
                <div className="space-y-2">
                  <Label htmlFor="account-opening-date">As of</Label>
                  <Input id="account-opening-date" type="date" value={values.openingBalanceDate} onChange={(event) => changeValue("openingBalanceDate", event.target.value)} required={Boolean(values.openingBalance)} disabled={fieldsDisabled || pending} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Enter the account balance on the date you started using MIKLEDGER.</p>
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

            <section aria-label="Balance sheet preview" className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Balance Sheet preview</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Saved opening balances through {values.openingBalanceDate || "the selected date"}.</p>
                </div>
                <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">Preview</span>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3">
                {(["Asset", "Liability", "Equity"] as const).map((category) => (
                  <div key={category} className="min-w-0 border-t border-border pt-3">
                    <dt className="truncate text-xs text-muted-foreground">{category === "Asset" ? "Assets" : category === "Liability" ? "Liabilities" : "Equity"}</dt>
                    <dd className="mt-1 truncate text-sm font-semibold tabular-nums">{formatCurrency(openingBalanceTotals[category], currency)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">This preview uses opening balances only; saved transactions and journal entries are not included.</p>
            </section>

            {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <div className="flex items-center">
              <Button type="submit" className={!isEditing && !isLocked ? "rounded-r-none" : "min-w-32"} disabled={pending}>
                {pending ? "Saving…" : recordWasLocked && !isLocked ? "Unlock account" : isLocked ? "Lock account" : isEditing ? "Save changes" : "Save account"}
              </Button>
              {!isEditing && !isLocked ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" aria-label="More save options" variant="default" size="icon" className="rounded-l-none border-l border-primary-foreground/20" disabled={pending} />}>
                    <ChevronDown size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => submitWithIntent(saveNewSubmitRef.current)}>Save and new</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => formRef.current?.requestSubmit()}>Save and close</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
