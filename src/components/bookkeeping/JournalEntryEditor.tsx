"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface JournalEntryEditorProps {
  accounts: BookkeepingRecord[];
  record: BookkeepingRecord | null;
  defaults: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
}

interface JournalLine {
  id: number;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
  name: string;
}

interface SavedJournalLine {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
  name: string;
}

function emptyLines(startId = 1, count = 8): JournalLine[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    accountId: "",
    debit: "",
    credit: "",
    description: "",
    name: "",
  }));
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function accountIdForLabel(accounts: BookkeepingRecord[], label: string) {
  const normalizedLabel = label.trim().toLowerCase();
  return accounts.find((account) => {
    const name = account.data.name ?? "";
    const code = account.data.code ?? "";
    return [name, code, `${code} ${name}`.trim()].some((option) => option.toLowerCase() === normalizedLabel);
  })?.id ?? "";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  if (quoted) throw new Error("The CSV file has an unclosed quotation mark.");
  if (value.length || row.length) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows.filter((values) => values.some((cell) => cell.trim()));
}

function importedAmount(value: string) {
  const normalized = value.trim().replaceAll(",", "").replace(/^[^0-9.-]+/, "");
  if (!normalized) return "";
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("CSV debit and credit values must be non-negative numbers.");
  return amount.toFixed(2);
}

function initialLines(record: BookkeepingRecord | null, accounts: BookkeepingRecord[]) {
  if (record?.data.lines) {
    try {
      const parsed: unknown = JSON.parse(record.data.lines);
      if (Array.isArray(parsed)) {
        const savedLines = parsed.flatMap((entry, index) => {
          const line = toObject(entry);
          if (!line) return [];
          return [{
            id: index + 1,
            accountId: toText(line.accountId),
            debit: toText(line.debit),
            credit: toText(line.credit),
            description: toText(line.description),
            name: toText(line.name),
          }];
        });
        if (savedLines.length) return [...savedLines, ...emptyLines(savedLines.length + 1, Math.max(0, 8 - savedLines.length))];
      }
    } catch {
      return emptyLines();
    }
  }

  if (record) {
    const amount = record.data.amount ?? "";
    const memo = record.data.memo ?? "";
    const savedLines = [
      {
        id: 1,
        accountId: accountIdForLabel(accounts, record.data.debitAccount ?? ""),
        debit: amount,
        credit: "",
        description: memo,
        name: "",
      },
      {
        id: 2,
        accountId: accountIdForLabel(accounts, record.data.creditAccount ?? ""),
        debit: "",
        credit: amount,
        description: memo,
        name: "",
      },
    ];
    return [...savedLines, ...emptyLines(3, 6)];
  }

  return emptyLines();
}

function cents(value: string) {
  const amount = Number(value);
  return value.trim() && Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

function amountText(value: number) {
  return (value / 100).toFixed(2);
}

export default function JournalEntryEditor({ accounts, record, defaults, open, onOpenChange, onSaved }: JournalEntryEditorProps) {
  const [date, setDate] = useState(defaults.date ?? "");
  const [reference, setReference] = useState(defaults.reference ?? "");
  const [lines, setLines] = useState<JournalLine[]>(() => initialLines(record, accounts));
  const [nextLineId, setNextLineId] = useState(9);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const accountOptions = accounts.filter((account) => account.data.name?.trim() || account.data.code?.trim());

  useEffect(() => {
    const startingLines = initialLines(record, accounts);
    setDate(record?.data.date ?? defaults.date ?? "");
    setReference(record?.data.reference ?? defaults.reference ?? "");
    setLines(startingLines);
    setNextLineId(Math.max(0, ...startingLines.map((line) => line.id)) + 1);
    setError("");
    setStatus("");
  }, [accounts, defaults, record]);

  const totals = useMemo(() => lines.reduce((result, line) => ({
    debit: result.debit + cents(line.debit),
    credit: result.credit + cents(line.credit),
  }), { debit: 0, credit: 0 }), [lines]);

  function updateLine(id: number, key: keyof Omit<JournalLine, "id">, value: string) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  }

  function addLines() {
    if (lines.length >= 50) return;
    const count = Math.min(8, 50 - lines.length);
    setLines((current) => [...current, ...emptyLines(nextLineId, count)]);
    setNextLineId((current) => current + count);
  }

  function clearLines() {
    setLines(emptyLines(nextLineId, 8));
    setNextLineId((current) => current + 8);
    setError("");
    setStatus("");
  }

  function removeLine(id: number) {
    setLines((current) => current.length > 2 ? current.filter((line) => line.id !== id) : current.map((line) => line.id === id ? { ...line, accountId: "", debit: "", credit: "", description: "", name: "" } : line));
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    setError("");
    setStatus("");
    try {
      const [headers = [], ...rows] = parseCsv(await file.text());
      const normalizedHeaders = headers.map((header) => header.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, ""));
      const accountIndex = normalizedHeaders.findIndex((header) => ["account", "accountcode", "accountname"].includes(header));
      const debitIndex = normalizedHeaders.findIndex((header) => ["debit", "debits"].includes(header));
      const creditIndex = normalizedHeaders.findIndex((header) => ["credit", "credits"].includes(header));
      const descriptionIndex = normalizedHeaders.findIndex((header) => header === "description");
      const nameIndex = normalizedHeaders.findIndex((header) => header === "name");
      if (accountIndex < 0 || debitIndex < 0 || creditIndex < 0) {
        throw new Error("CSV needs Account, Debits, and Credits columns.");
      }

      const importedData = rows.flatMap((values, index) => {
        const accountLabel = values[accountIndex] ?? "";
        const debit = importedAmount(values[debitIndex] ?? "");
        const credit = importedAmount(values[creditIndex] ?? "");
        const description = descriptionIndex >= 0 ? values[descriptionIndex] ?? "" : "";
        const name = nameIndex >= 0 ? values[nameIndex] ?? "" : "";
        if (!accountLabel && !debit && !credit && !description && !name) return [];
        const accountId = accountIdForLabel(accountOptions, accountLabel);
        if (!accountId) throw new Error(`CSV row ${index + 2} has an account not found in Chart of Accounts: ${accountLabel || "(blank)"}.`);
        return [{
          accountId,
          debit,
          credit,
          description: description.slice(0, 300),
          name: name.slice(0, 160),
        }];
      });
      const importedLines = importedData.map((line, index) => ({ ...line, id: nextLineId + index }));

      if (!importedLines.length) throw new Error("The CSV doesn’t contain any journal lines.");
      const existingLines = lines.filter((line) => line.accountId || line.debit.trim() || line.credit.trim() || line.description.trim() || line.name.trim());
      if (existingLines.length + importedLines.length > 50) throw new Error("A journal can include up to 50 lines.");
      const combinedLines = [...existingLines, ...importedLines];
      setLines(combinedLines.length < 8 ? [...combinedLines, ...emptyLines(nextLineId + importedLines.length, 8 - combinedLines.length)] : combinedLines);
      setNextLineId((current) => current + importedLines.length + Math.max(0, 8 - combinedLines.length));
      setStatus(`Imported ${importedLines.length} ${importedLines.length === 1 ? "line" : "lines"}. Review the totals before saving.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "We couldn’t read that CSV file.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const filledLines = lines.filter((line) => line.accountId || line.debit.trim() || line.credit.trim() || line.description.trim() || line.name.trim());
    if (!filledLines.length) {
      setError("Add at least two journal lines.");
      return;
    }
    for (const [index, line] of filledLines.entries()) {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      if (!line.accountId) {
        setError(`Choose an account from Chart of Accounts for line ${index + 1}.`);
        return;
      }
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        setError(`Line ${index + 1} must use non-negative amounts.`);
        return;
      }
      if (cents(line.debit) === 0 && cents(line.credit) === 0) {
        setError(`Enter a debit or credit amount for line ${index + 1}.`);
        return;
      }
      if (cents(line.debit) > 0 && cents(line.credit) > 0) {
        setError(`Use either debit or credit on line ${index + 1}, not both.`);
        return;
      }
    }
    if (filledLines.length < 2 || totals.debit === 0 || totals.debit !== totals.credit) {
      setError("Total debits and credits must match before you save the journal.");
      return;
    }

    setPending(true);
    try {
      const saved = await saveBookkeepingRecord("journals", {
        date,
        reference,
        lines: JSON.stringify(filledLines.map(({ accountId, debit, credit, description, name }) => ({ accountId, debit, credit, description, name }))),
      }, record?.id);
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this journal. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-6xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{record ? "Edit journal" : "New journal"}</DialogTitle>
          <DialogDescription>Post balanced double-entry journals with a debit and a credit.</DialogDescription>
        </DialogHeader>

        <form id="journal-entry-form" onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="journal-date">Journal date <span className="text-destructive">*</span></Label>
              <Input id="journal-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journal-reference">Journal no. <span className="text-destructive">*</span></Label>
              <Input id="journal-reference" value={reference} onChange={(event) => setReference(event.target.value)} required maxLength={120} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => importInputRef.current?.click()} disabled={pending || !accountOptions.length}>Import</Button>
            <Input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import journal lines from CSV" onChange={(event) => { void importCsv(event.target.files?.[0]); event.target.value = ""; }} />
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="w-12 text-center text-[11px] uppercase tracking-wide">#</TableHead>
                  <TableHead className="min-w-64 text-[11px] uppercase tracking-wide">Account</TableHead>
                  <TableHead className="w-36 text-right text-[11px] uppercase tracking-wide">Debits</TableHead>
                  <TableHead className="w-36 text-right text-[11px] uppercase tracking-wide">Credits</TableHead>
                  <TableHead className="min-w-56 text-[11px] uppercase tracking-wide">Description</TableHead>
                  <TableHead className="min-w-36 text-[11px] uppercase tracking-wide">Name</TableHead>
                  <TableHead className="w-10"><span className="sr-only">Remove line</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={line.id}>
                    <TableCell className="border-r border-dotted border-border text-center text-xs text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="border-r border-dotted border-border">
                      <Select value={line.accountId || undefined} onValueChange={(value) => updateLine(line.id, "accountId", value ?? "")}>
                        <SelectTrigger className="w-full" aria-label={`Account for line ${index + 1}`}>
                          <SelectValue placeholder={accountOptions.length ? "Choose account" : "Add a chart account first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {accountOptions.map((account) => {
                            const code = account.data.code?.trim();
                            const name = account.data.name?.trim();
                            return <SelectItem key={account.id} value={account.id}>{code && name ? `${code} ${name}` : name || code || "Account"}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="border-r border-dotted border-border">
                      <Input aria-label={`Debit for line ${index + 1}`} type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(line.id, "debit", event.target.value)} className="text-right tabular-nums" />
                    </TableCell>
                    <TableCell className="border-r border-dotted border-border">
                      <Input aria-label={`Credit for line ${index + 1}`} type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(line.id, "credit", event.target.value)} className="text-right tabular-nums" />
                    </TableCell>
                    <TableCell className="border-r border-dotted border-border">
                      <Input aria-label={`Description for line ${index + 1}`} value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} maxLength={300} />
                    </TableCell>
                    <TableCell className="border-r border-dotted border-border">
                      <Input aria-label={`Name for line ${index + 1}`} value={line.name} onChange={(event) => updateLine(line.id, "name", event.target.value)} maxLength={160} />
                    </TableCell>
                    <TableCell className="p-1 text-center">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} onClick={() => removeLine(line.id)} disabled={pending}>
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="text-right">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{amountText(totals.debit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{amountText(totals.credit)}</TableCell>
                  <TableCell colSpan={3} className="text-right text-xs text-muted-foreground">
                    {totals.debit === totals.credit && totals.debit > 0 ? "Balanced" : `Difference ${amountText(Math.abs(totals.debit - totals.credit))}`}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {!accountOptions.length ? <p className="text-sm text-muted-foreground">Add accounts in Chart of Accounts before recording a journal.</p> : null}
          {status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLines} disabled={pending || lines.length >= 50}><Plus size={14} /> Add lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearLines} disabled={pending}>Clear all lines</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" form="journal-entry-form" disabled={pending || !accountOptions.length}>{pending ? "Saving…" : record ? "Save changes" : "Save journal"}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
