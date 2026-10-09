"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Check, CircleAlert, CircleCheck, Landmark, MoveRight } from "lucide-react";

import { completeBankReconciliation } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface BankReconciliationWorkspaceProps {
  accounts: BookkeepingRecord[];
  transactions: BookkeepingRecord[];
  reconciliations: BookkeepingRecord[];
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + 1);
  return localDate(parsed);
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function latestStatementDate(reconciliations: BookkeepingRecord[], accountId: string) {
  return reconciliations
    .filter((record) => record.data.bankAccountId === accountId)
    .map((record) => record.data.statementDate)
    .filter(Boolean)
    .sort((first, second) => second.localeCompare(first))[0] ?? "";
}

export default function BankReconciliationWorkspace({ accounts, transactions: initialTransactions, reconciliations: initialReconciliations }: BankReconciliationWorkspaceProps) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [statementDate, setStatementDate] = useState(() => {
    const currentAccount = accounts[0];
    const latest = currentAccount ? latestStatementDate(initialReconciliations, currentAccount.id) : "";
    const today = localDate(new Date());
    return latest && latest >= today ? nextDate(latest) : today;
  });
  const [endingBalanceInput, setEndingBalanceInput] = useState("");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [reconciliations, setReconciliations] = useState(initialReconciliations);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const bankAccount = accounts.find((record) => record.id === bankAccountId);
  const currency = bankAccount?.data.currency || "USD";
  const accountHistory = useMemo(
    () => reconciliations
      .filter((record) => record.data.bankAccountId === bankAccountId)
      .sort((first, second) => second.data.statementDate.localeCompare(first.data.statementDate)),
    [bankAccountId, reconciliations],
  );
  const mostRecentStatement = accountHistory[0];
  const statementStartsAfterLatest = Boolean(mostRecentStatement && statementDate <= mostRecentStatement.data.statementDate);
  const previousReconciliation = accountHistory.find((record) => record.data.statementDate < statementDate);
  const openingBalance = Number(previousReconciliation?.data.endingBalance ?? bankAccount?.data.openingBalance ?? 0) || 0;
  const openingDate = previousReconciliation?.data.statementDate ?? "";

  const periodTransactions = useMemo(() => transactions
    .filter((record) => {
      const data = record.data;
      return data.account === bankAccount?.data.name &&
        data.reconciled !== "true" &&
        Boolean(data.date) &&
        data.date <= statementDate &&
        (!openingDate || data.date > openingDate);
    })
    .sort((first, second) => first.data.date.localeCompare(second.data.date)),
  [bankAccount?.data.name, openingDate, statementDate, transactions]);

  const selectedTransactions = periodTransactions.filter((record) => selectedTransactionIds.includes(record.id));
  const clearedNet = selectedTransactions.reduce((total, record) => {
    const amountCents = Math.round((Number(record.data.amount) || 0) * 100);
    return total + (record.data.type === "Withdrawal" ? -amountCents : record.data.type === "Deposit" ? amountCents : 0);
  }, 0) / 100;
  const calculatedBalance = openingBalance + clearedNet;
  const statementEndingBalance = endingBalanceInput === "" ? null : Number(endingBalanceInput);
  const difference = statementEndingBalance === null || !Number.isFinite(statementEndingBalance)
    ? null
    : Math.round((statementEndingBalance - calculatedBalance) * 100) / 100;
  const canComplete = Boolean(
    bankAccount &&
    statementDate &&
    statementEndingBalance !== null &&
    Number.isFinite(statementEndingBalance) &&
    difference === 0 &&
    !statementStartsAfterLatest &&
    !pending,
  );

  function changeAccount(value: string) {
    setBankAccountId(value);
    setSelectedTransactionIds([]);
    setEndingBalanceInput("");
    setError("");
    setNotice("");
    const latest = latestStatementDate(reconciliations, value);
    const today = localDate(new Date());
    setStatementDate(latest && latest >= today ? nextDate(latest) : today);
  }

  function toggleTransaction(id: string, checked: boolean) {
    setSelectedTransactionIds((current) => checked ? [...current, id] : current.filter((currentId) => currentId !== id));
    setError("");
    setNotice("");
  }

  async function submitReconciliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canComplete) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const created = await completeBankReconciliation(bankAccountId, statementDate, endingBalanceInput, selectedTransactionIds);
      setReconciliations((current) => [created, ...current]);
      setTransactions((current) => current.map((record) => selectedTransactionIds.includes(record.id)
        ? { ...record, data: { ...record.data, reconciled: "true", reconciliationId: created.id } }
        : record));
      setSelectedTransactionIds([]);
      setEndingBalanceInput("");
      setNotice(`Statement reconciled for ${bankAccount?.data.name}.`);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "That statement couldn’t be reconciled. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Banking / Reconciliation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reconciliation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Compare a bank statement with the transactions recorded in MIKLEDGER.</p>
        </div>
        <Card className="flex flex-col items-start gap-4 border-border p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground"><Landmark size={20} /></span>
          <div>
            <h2 className="text-base font-semibold">Add a bank account first</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">Create the account you want to reconcile, then record or import its statement transactions.</p>
          </div>
          <Button nativeButton={false} render={<Link href="/app/bank-accounts" />}>Set up banking</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Banking / Reconciliation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reconciliation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Match recorded transactions to your bank statement and carry a verified balance into the next period.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/app/transactions" />}>View transactions</Button>
      </div>

      <form onSubmit={submitReconciliation} className="mt-6 space-y-6">
        <Card className="grid gap-5 border-border p-4 sm:grid-cols-3 sm:p-5">
          <div className="space-y-2">
            <Label htmlFor="reconciliation-account">Bank account</Label>
            <Select value={bankAccountId} onValueChange={(value) => { if (value) changeAccount(value); }}>
              <SelectTrigger id="reconciliation-account" className="w-full"><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name || "Unnamed account"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="statement-date">Statement ending date</Label>
            <Input id="statement-date" type="date" value={statementDate} min={mostRecentStatement ? nextDate(mostRecentStatement.data.statementDate) : undefined} onChange={(event) => { setStatementDate(event.target.value); setError(""); setNotice(""); }} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="statement-ending-balance">Statement ending balance</Label>
            <Input id="statement-ending-balance" type="number" step="0.01" value={endingBalanceInput} onChange={(event) => { setEndingBalanceInput(event.target.value); setError(""); setNotice(""); }} placeholder="0.00" required />
          </div>
        </Card>

        {statementStartsAfterLatest ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Reconcile this account in date order, starting after {formatDate(mostRecentStatement?.data.statementDate ?? "")}.</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border p-4">
            <p className="text-xs font-medium text-muted-foreground">Statement starts with</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{formatCurrency(openingBalance, currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{openingDate ? `After ${formatDate(openingDate)}` : "Opening balance"}</p>
          </Card>
          <Card className="border-border p-4">
            <p className="text-xs font-medium text-muted-foreground">Selected transactions</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{formatCurrency(clearedNet, currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{selectedTransactions.length} selected</p>
          </Card>
          <Card className="border-border p-4">
            <p className="text-xs font-medium text-muted-foreground">Ledger balance</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{formatCurrency(calculatedBalance, currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Opening plus selected deposits and withdrawals</p>
          </Card>
          <Card className={`border-border p-4 ${difference === 0 ? "border-primary/40 bg-accent/35" : ""}`}>
            <p className="text-xs font-medium text-muted-foreground">Difference</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{difference === null ? "—" : formatCurrency(difference, currency)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {difference === 0 ? <><CircleCheck size={14} className="text-primary" /> Balanced</> : difference === null ? "Enter your statement balance" : <><CircleAlert size={14} /> Select transactions until it reaches zero</>}
            </p>
          </Card>
        </div>

        <Card className="overflow-hidden border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold">Transactions to clear</h2>
              <p className="mt-1 text-xs text-muted-foreground">{openingDate ? `${formatDate(openingDate)} onward` : "From the account opening balance"} through {formatDate(statementDate)}</p>
            </div>
            <Badge variant="outline" className="font-normal">{periodTransactions.length} available</Badge>
          </div>

          {periodTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"><span className="sr-only">Select</span></TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodTransactions.map((transaction) => {
                    const direction = transaction.data.type;
                    const amount = Number(transaction.data.amount);
                    const selectable = (direction === "Deposit" || direction === "Withdrawal") && Number.isFinite(amount) && amount > 0;
                    const selected = selectedTransactionIds.includes(transaction.id);
                    return (
                      <TableRow key={transaction.id} data-state={selected ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            disabled={!selectable || pending}
                            onCheckedChange={(checked) => toggleTransaction(transaction.id, checked === true)}
                            aria-label={`Select ${transaction.data.description || "transaction"}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(transaction.data.date)}</TableCell>
                        <TableCell className="min-w-48 font-medium">{transaction.data.description || "Untitled transaction"}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            {direction === "Withdrawal" ? <ArrowDownRight size={15} /> : direction === "Deposit" ? <ArrowUpRight size={15} /> : null}
                            {direction || "Direction needed"}
                          </span>
                        </TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-medium tabular-nums ${direction === "Withdrawal" ? "text-muted-foreground" : ""}`}>
                          {direction === "Withdrawal" ? "−" : "+"}{formatCurrency(Number.isFinite(amount) ? amount : 0, currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium">No uncleared transactions in this period</p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Add your bank statement activity under Transactions, using the selected account name, then return to clear it here.</p>
              <Button className="mt-4" variant="outline" nativeButton={false} render={<Link href="/app/transactions" />}>Add transactions</Button>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">This matches transactions you’ve entered against a statement. MIKLEDGER doesn’t connect directly to your bank.</p>
            <Button type="submit" disabled={!canComplete} className="shrink-0">
              {pending ? "Saving reconciliation…" : "Complete reconciliation"}<MoveRight size={15} />
            </Button>
          </div>
        </Card>

        {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="rounded-md border border-primary/30 bg-accent/35 px-4 py-3 text-sm text-foreground"><Check size={15} className="mr-2 inline text-primary" />{notice}</p> : null}
      </form>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Recent reconciliations</h2>
            <p className="mt-1 text-xs text-muted-foreground">Completed statements for {bankAccount?.data.name || "this account"}</p>
          </div>
          <span className="text-xs text-muted-foreground">{accountHistory.length} total</span>
        </div>
        <Card className="overflow-hidden border-border">
          {accountHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Statement date</TableHead><TableHead>Opening balance</TableHead><TableHead>Ending balance</TableHead><TableHead>Transactions cleared</TableHead><TableHead className="text-right">Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {accountHistory.slice(0, 5).map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{formatDate(record.data.statementDate)}</TableCell>
                      <TableCell className="tabular-nums">{formatCurrency(Number(record.data.openingBalance) || 0, currency)}</TableCell>
                      <TableCell className="tabular-nums">{formatCurrency(Number(record.data.endingBalance) || 0, currency)}</TableCell>
                      <TableCell>{record.data.clearedCount || "0"}</TableCell>
                      <TableCell className="text-right"><Badge variant="outline" className="gap-1 border-primary/30 text-primary"><CircleCheck size={12} />Reconciled</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">Your completed statements will appear here.</div>
          )}
        </Card>
      </section>
    </div>
  );
}
