"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, Pencil, Plus, Search, Trash2, WalletCards } from "lucide-react";

import { deleteBookkeepingRecord } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AccountEditorSheet from "@/components/bookkeeping/AccountEditorSheet";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface ChartOfAccountsWorkspaceProps {
  accounts: BookkeepingRecord[];
  currency: string;
}

const accountTypes = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;

function formatCurrency(amount: string | undefined, currency: string) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function ChartOfAccountsWorkspace({ accounts: initialAccounts, currency }: ChartOfAccountsWorkspaceProps) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BookkeepingRecord | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<BookkeepingRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => setAccounts(initialAccounts), [initialAccounts]);

  const sortedAccounts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return accounts
      .filter((account) => {
        const values = [account.data.code, account.data.name, account.data.type, account.data.detailType, account.data.description];
        const matchesSearch = !normalizedSearch || values.some((value) => value?.toLowerCase().includes(normalizedSearch));
        const accountType = account.data.type || "Unclassified";
        return matchesSearch && (typeFilter === "all" || accountType === typeFilter);
      })
      .sort((left, right) => {
        const codeOrder = (left.data.code || "").localeCompare(right.data.code || "", undefined, { numeric: true });
        return codeOrder || (left.data.name || "").localeCompare(right.data.name || "");
      });
  }, [accounts, search, typeFilter]);

  const parentNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.data.name || account.data.code || "Account"])), [accounts]);

  function openNewAccount() {
    setEditingAccount(null);
    setSheetOpen(true);
  }

  function openEditAccount(account: BookkeepingRecord) {
    setEditingAccount(account);
    setSheetOpen(true);
  }

  function handleSaved(saved: BookkeepingRecord) {
    setAccounts((current) => {
      const exists = current.some((account) => account.id === saved.id);
      return exists ? current.map((account) => account.id === saved.id ? saved : account) : [saved, ...current];
    });
  }

  async function confirmDelete() {
    if (!deletingAccount) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteBookkeepingRecord("accounts", deletingAccount.id);
      setAccounts((current) => current.filter((account) => account.id !== deletingAccount.id));
      setDeletingAccount(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "We couldn’t delete this account. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-full space-y-6 p-4 sm:p-6 lg:p-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Books / Accounting</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Chart of accounts</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Manage the accounts that organize your business activity and journal entries.</p>
        </div>
        <Button className="gap-2" onClick={openNewAccount}><Plus size={16} />New account</Button>
      </section>

      <section aria-label="Accounts by type" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {accountTypes.map((type) => {
          const count = accounts.filter((account) => account.data.type === type).length;
          const selected = typeFilter === type;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={selected}
              onClick={() => setTypeFilter(selected ? "all" : type)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${selected ? "border-primary/40 bg-accent/60" : "border-border bg-card hover:bg-muted/50"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{type} accounts</span>
                <span className="tabular-nums text-lg font-semibold">{count}</span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{type === "Asset" ? "What the business owns" : type === "Liability" ? "What the business owes" : type === "Equity" ? "Owner’s share" : type === "Income" ? "Money earned" : "Money spent"}</span>
            </button>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Accounts</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{sortedAccounts.length} {sortedAccounts.length === 1 ? "account" : "accounts"}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="relative min-w-0 sm:w-64">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts" aria-label="Search accounts" className="pl-9" />
            </div>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value ?? "all")}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by account type"><SelectValue placeholder="All account types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All account types</SelectItem>
                {accountTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                {accounts.some((account) => !account.data.type) ? <SelectItem value="Unclassified">Unclassified</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>
        </div>

        {sortedAccounts.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/35 hover:bg-muted/35">
                <TableHead className="w-32 px-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Account no.</TableHead>
                <TableHead className="min-w-52 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Name</TableHead>
                <TableHead className="min-w-48 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Type / detail type</TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Opening balance</TableHead>
                <TableHead className="w-28 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</TableHead>
                <TableHead className="w-24 px-5 text-right" aria-label="Account actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAccounts.map((account) => (
                <TableRow key={account.id} className="group">
                  <TableCell className="px-5 font-mono text-xs tabular-nums text-muted-foreground">{account.data.code || "—"}</TableCell>
                  <TableCell>
                    <button type="button" className="max-w-full text-left" onClick={() => openEditAccount(account)}>
                      <span className="block max-w-[320px] truncate text-sm font-medium text-foreground">{account.data.name || "Untitled account"}</span>
                      {account.data.subAccount === "true" ? <span className="mt-0.5 block max-w-[320px] truncate text-xs text-muted-foreground">Sub-account{account.data.parentAccount && parentNames.has(account.data.parentAccount) ? ` of ${parentNames.get(account.data.parentAccount)}` : ""}</span> : null}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="font-medium">{account.data.type || "Unclassified"}</Badge>
                      {account.data.detailType ? <span className="text-xs text-muted-foreground">{account.data.detailType}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(account.data.openingBalance, currency)}</TableCell>
                  <TableCell className="text-right">
                    {account.data.locked === "true" ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole size={13} />Locked</span> : <span className="text-xs text-muted-foreground">Active</span>}
                  </TableCell>
                  <TableCell className="px-5 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${account.data.name || "account"}`} onClick={() => openEditAccount(account)}><Pencil size={14} /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${account.data.name || "account"}`} title={account.data.locked === "true" ? "Unlock this account before deleting it" : "Delete account"} disabled={account.data.locked === "true"} className="text-muted-foreground hover:text-destructive" onClick={() => { setDeleteError(""); setDeletingAccount(account); }}><Trash2 size={14} /></Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
            <div className="max-w-sm">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><WalletCards size={20} /></span>
              <h3 className="mt-4 text-sm font-semibold">{accounts.length === 0 ? "Start your chart of accounts" : "No matching accounts"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{accounts.length === 0 ? "Add the accounts you use to track money in, money out, and balances." : "Try another search or account type."}</p>
              {accounts.length === 0 ? <Button className="mt-4 gap-2" onClick={openNewAccount}><Plus size={15} />Add first account</Button> : null}
            </div>
          </div>
        )}
      </section>

      <AccountEditorSheet accounts={accounts} open={sheetOpen} record={editingAccount} onOpenChange={setSheetOpen} onSaved={handleSaved} />

      <Dialog open={Boolean(deletingAccount)} onOpenChange={(open) => { if (!open && !deleting) setDeletingAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this account?</DialogTitle>
            <DialogDescription>{deletingAccount?.data.name} will be removed from your chart. Accounts used in journal entries can’t be deleted.</DialogDescription>
          </DialogHeader>
          {deleteError ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingAccount(null)} disabled={deleting}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
