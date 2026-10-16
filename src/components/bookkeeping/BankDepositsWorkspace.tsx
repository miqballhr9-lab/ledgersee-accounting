"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Landmark, Plus, Trash2, Upload } from "lucide-react";

import { deleteBankDeposit, importBankStatement, saveBankDeposit, saveTransfer } from "@/app/banking-actions";
import FullPageForm, { footerGhost } from "@/components/bookkeeping/FullPageForm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount } from "@/lib/invoice-utils";
import { isUndepositedFunds, paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";

interface Props {
  deposits: BookkeepingRecord[];
  payments: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  bankAccounts: BookkeepingRecord[];
  currency: string;
  today: string;
}

interface OtherLine {
  key: number;
  accountId: string;
  description: string;
  amount: string;
}

const blankLine = (key: number): OtherLine => ({ key, accountId: "", description: "", amount: "" });

/** QuickBooks' Bank deposit, Transfer and Upload from file, in one Banking page. */
export default function BankDepositsWorkspace({ deposits, payments, accounts, bankAccounts, currency, today }: Props) {
  const router = useRouter();
  const money = (value: number) => currencyAmount(value, currency);
  const banks = accounts.filter((account) => {
    const type = paymentAccountType(account);
    return type === "Bank" || type === "Cash";
  });
  const moneyAccounts = accounts.filter((account) => paymentAccountType(account));
  const undepositedIds = new Set(accounts.filter((account) => isUndepositedFunds(account)).map((account) => account.id));
  const waiting = payments.filter((payment) => undepositedIds.has(payment.data.paymentAccountId ?? "") && !payment.data.depositId)
    .sort((a, b) => (a.data.paymentDate ?? "").localeCompare(b.data.paymentDate ?? ""));
  const otherAccounts = accounts.filter((account) => account.data.locked !== "true" && !isUndepositedFunds(account) && account.data.name)
    .sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  const statementAccounts = [...new Set([...bankAccounts.map((account) => account.data.name ?? ""), ...moneyAccounts.map((account) => account.data.name ?? "")].filter(Boolean))];

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositDate, setDepositDate] = useState(today);
  const [depositAccount, setDepositAccount] = useState("");
  const [memo, setMemo] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [lines, setLines] = useState<OtherLine[]>([blankLine(1), blankLine(2)]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ date: today, fromAccountId: "", toAccountId: "", amount: "", memo: "" });
  const [importOpen, setImportOpen] = useState(false);
  const [importAccount, setImportAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosenTotal = waiting.filter((payment) => chosen.includes(payment.id)).reduce((sum, payment) => sum + (Number(payment.data.amount) || 0), 0);
  const otherTotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  function startDeposit() {
    setDepositDate(today);
    setDepositAccount((banks.find((account) => paymentAccountType(account) === "Bank") ?? banks[0])?.id ?? "");
    setMemo("");
    setChosen([]);
    setLines([blankLine(1), blankLine(2)]);
    setDepositOpen(true);
  }

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await work();
      toast.success(done, { position: "top-center" });
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That couldn’t be saved. Please try again.", { position: "top-center" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitDeposit(close: boolean) {
    const ok = await run(() => saveBankDeposit({
      date: depositDate,
      accountId: depositAccount,
      memo,
      paymentIds: chosen,
      lines: lines.filter((line) => line.accountId || line.amount).map(({ accountId, description, amount }) => ({ accountId, description, amount })),
    }), `Deposit of ${money(chosenTotal + otherTotal)} saved.`);
    if (!ok) return;
    if (close) setDepositOpen(false);
    else startDeposit();
  }

  async function submitTransfer() {
    if (await run(() => saveTransfer(transfer), `Transfer of ${money(Number(transfer.amount) || 0)} saved.`)) setTransferOpen(false);
  }

  async function submitImport(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setBusy(true);
    try {
      const result = await importBankStatement(importAccount, text);
      toast.success(`${result.imported} ${result.imported === 1 ? "line" : "lines"} imported${result.skipped ? `, ${result.skipped} already there` : ""}. Review them in Transactions.`, { position: "top-center" });
      setImportOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That couldn’t be saved. Please try again.", { position: "top-center" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounts / Banking</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Bank deposits</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Bank the customer payments waiting in Undeposited funds, move money between your accounts, and upload bank statements.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => { setImportAccount(statementAccounts[0] ?? ""); setImportOpen(true); }}><Upload size={15} />Upload statement</Button>
          <Button variant="outline" className="gap-2" onClick={() => { setTransfer({ date: today, fromAccountId: moneyAccounts[0]?.id ?? "", toAccountId: moneyAccounts[1]?.id ?? "", amount: "", memo: "" }); setTransferOpen(true); }}><ArrowLeftRight size={15} />Transfer</Button>
          <Button className="gap-2" onClick={startDeposit}><Plus size={15} />Bank deposit</Button>
        </div>
      </section>

      {waiting.length ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3.5">
          <p className="text-sm"><span className="font-medium">{waiting.length} {waiting.length === 1 ? "payment is" : "payments are"} waiting in Undeposited funds</span> · {money(waiting.reduce((sum, payment) => sum + (Number(payment.data.amount) || 0), 0))}</p>
          <Button size="sm" onClick={startDeposit}>Deposit them</Button>
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <p className="text-sm font-semibold">Deposits</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{deposits.length} {deposits.length === 1 ? "deposit" : "deposits"}</p>
        </div>
        {deposits.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Deposited to</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...deposits].sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? "")).map((deposit) => {
                let count = 0;
                try { count = (JSON.parse(deposit.data.paymentIds || "[]") as unknown[]).length; } catch { count = 0; }
                return (
                  <TableRow key={deposit.id}>
                    <TableCell className="whitespace-nowrap text-[13px]">{deposit.data.date}</TableCell>
                    <TableCell className="text-[13px]">{deposit.data.reference}</TableCell>
                    <TableCell className="text-[13px]">{deposit.data.accountName}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-[13px] text-muted-foreground">{deposit.data.memo || "—"}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{count}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium tabular-nums">{money(Number(deposit.data.amount) || 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete deposit ${deposit.data.reference}`} disabled={busy} onClick={() => {
                        if (window.confirm("Delete this deposit? Its payments go back to Undeposited funds.")) void run(() => deleteBankDeposit(deposit.id), "Deposit deleted.");
                      }}><Trash2 size={15} /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Landmark className="text-muted-foreground" />
            <p className="text-sm font-medium">No deposits yet</p>
            <p className="max-w-md text-sm text-muted-foreground">Receive customer payments into Undeposited funds, then bank them together here, as they appear on your bank statement.</p>
          </div>
        )}
      </section>

      <FullPageForm
        open={depositOpen}
        onOpenChange={setDepositOpen}
        title="Bank deposit"
        description="Deposit customer payments and other money into a bank account."
        footer={(
          <>
            <Button type="button" variant="ghost" className={footerGhost} onClick={() => setDepositOpen(false)}>Cancel</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void submitDeposit(false)}>Save and new</Button>
              <Button type="button" disabled={busy} onClick={() => void submitDeposit(true)}>{busy ? "Saving…" : "Save and close"}</Button>
            </div>
          </>
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="deposit-account">Account</Label>
              <Select value={depositAccount || null} onValueChange={(value) => setDepositAccount(String(value ?? ""))}>
                <SelectTrigger id="deposit-account" className="w-64"><SelectValue placeholder="Choose a bank account">{banks.find((account) => account.id === depositAccount) ? paymentAccountLabel(banks.find((account) => account.id === depositAccount)!) : undefined}</SelectValue></SelectTrigger>
                <SelectContent>{banks.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deposit-date">Date</Label>
              <Input id="deposit-date" type="date" value={depositDate} onChange={(event) => setDepositDate(event.target.value)} className="w-44" />
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
            <p className="text-3xl font-semibold tabular-nums">{money(chosenTotal + otherTotal)}</p>
          </div>
        </div>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Select the payments included in this deposit</h2>
          </div>
          {waiting.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox aria-label="Select all payments" checked={chosen.length === waiting.length} onCheckedChange={(checked) => setChosen(checked ? waiting.map((payment) => payment.id) : [])} /></TableHead>
                  <TableHead>Received from</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell><Checkbox aria-label={`Include ${payment.data.invoiceNumber}`} checked={chosen.includes(payment.id)} onCheckedChange={(checked) => setChosen((current) => (checked ? [...current, payment.id] : current.filter((id) => id !== payment.id)))} /></TableCell>
                    <TableCell className="text-[13px]">{payment.data.customer || "—"}</TableCell>
                    <TableCell className="text-[13px]">{payment.data.paymentDate}</TableCell>
                    <TableCell className="text-[13px]">Payment · {payment.data.invoiceNumber}</TableCell>
                    <TableCell className="text-[13px]">{payment.data.referenceNumber || "—"}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{money(Number(payment.data.amount) || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="px-4 py-6 text-sm text-muted-foreground">No payments are waiting in Undeposited funds. Choose Undeposited funds as the account when you receive a payment.</p>}
          <p className="border-t border-border px-4 py-2.5 text-right text-sm">{chosen.length} selected · <span className="font-medium tabular-nums">{money(chosenTotal)}</span></p>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Add funds to this deposit</h2>
            <p className="text-xs text-muted-foreground">Other money in, such as a refund, a loan or the owner&apos;s own money, with the account it comes from.</p>
          </div>
          <div className="space-y-2 p-4">
            {lines.map((line, index) => (
              <div key={line.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_10rem_auto]">
                <Select value={line.accountId || null} onValueChange={(value) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, accountId: String(value ?? "") } : item)))}>
                  <SelectTrigger aria-label={`Line ${index + 1} account`} className="w-full"><SelectValue placeholder="Received from account">{otherAccounts.find((account) => account.id === line.accountId)?.data.name}</SelectValue></SelectTrigger>
                  <SelectContent>{otherAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label={`Line ${index + 1} description`} placeholder="Description" value={line.description} onChange={(event) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, description: event.target.value } : item)))} />
                <Input aria-label={`Line ${index + 1} amount`} type="number" min="0" step="0.01" placeholder="0.00" className="text-right" value={line.amount} onChange={(event) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, amount: event.target.value } : item)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((current) => (current.length > 1 ? current.filter((item) => item.key !== line.key) : [blankLine(line.key + 1)]))}><Trash2 size={15} /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, blankLine(Math.max(0, ...current.map((item) => item.key)) + 1)])}>Add lines</Button>
          </div>
        </section>

        <div className="grid max-w-xl gap-1.5">
          <Label htmlFor="deposit-memo">Memo</Label>
          <Input id="deposit-memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
        </div>
      </FullPageForm>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer</DialogTitle>
            <DialogDescription>Move money between your bank, cash and card accounts.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {(["fromAccountId", "toAccountId"] as const).map((key) => (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={`transfer-${key}`}>{key === "fromAccountId" ? "Transfer funds from" : "Transfer funds to"}</Label>
                <Select value={transfer[key] || null} onValueChange={(value) => setTransfer({ ...transfer, [key]: String(value ?? "") })}>
                  <SelectTrigger id={`transfer-${key}`} className="w-full"><SelectValue placeholder="Choose an account">{moneyAccounts.find((account) => account.id === transfer[key]) ? paymentAccountLabel(moneyAccounts.find((account) => account.id === transfer[key])!) : undefined}</SelectValue></SelectTrigger>
                  <SelectContent>{moneyAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="transfer-amount">Amount</Label><Input id="transfer-amount" type="number" min="0" step="0.01" value={transfer.amount} onChange={(event) => setTransfer({ ...transfer, amount: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="transfer-date">Date</Label><Input id="transfer-date" type="date" value={transfer.date} onChange={(event) => setTransfer({ ...transfer, date: event.target.value })} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="transfer-memo">Memo</Label><Input id="transfer-memo" value={transfer.memo} onChange={(event) => setTransfer({ ...transfer, memo: event.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void submitTransfer()}>{busy ? "Saving…" : "Save transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload a bank statement</DialogTitle>
            <DialogDescription>A CSV file from your bank with Date, Description and Amount columns, or Debit and Credit columns. Lines already imported are skipped, and your bank rules categorise the new ones.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="import-account">Bank account</Label>
            <Select value={importAccount || null} onValueChange={(value) => setImportAccount(String(value ?? ""))}>
              <SelectTrigger id="import-account" className="w-full"><SelectValue placeholder="Choose the account" /></SelectTrigger>
              <SelectContent>{statementAccounts.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void submitImport(file); }} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button type="button" className="gap-2" disabled={busy || !importAccount} onClick={() => fileRef.current?.click()}><Upload size={15} />{busy ? "Importing…" : "Choose CSV file"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
