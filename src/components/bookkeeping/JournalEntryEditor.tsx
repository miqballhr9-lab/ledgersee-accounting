"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Copy, FileUp, GripVertical, LoaderCircle, Paperclip, Plus, Trash2, X } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { getAttachmentUploadTarget, saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface JournalEntryEditorProps {
  accounts: BookkeepingRecord[];
  record: BookkeepingRecord | null;
  defaults: Record<string, string>;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
  /** Called instead of closing when the person chooses "Save and new". */
  onSaveAndNew: (record: BookkeepingRecord) => void;
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

function accountLabel(account: BookkeepingRecord) {
  const name = account.data.name?.trim();
  return name || "Unnamed account";
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

function moneyText(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(value / 100);
  } catch {
    return `${currency} ${amountText(value)}`;
  }
}

// Spreadsheet-style cells: no box until a cell is focused, like a ledger sheet.
const cellInput = "h-11 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:bg-transparent";
const cellBorder = "border-r border-dashed border-border";

export default function JournalEntryEditor({ accounts, record, defaults, currency, open, onOpenChange, onSaved, onSaveAndNew }: JournalEntryEditorProps) {
  const [date, setDate] = useState(defaults.date ?? "");
  const [reference, setReference] = useState(defaults.reference ?? "");
  const [lines, setLines] = useState<JournalLine[]>(() => initialLines(record, accounts));
  const [nextLineId, setNextLineId] = useState(9);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [memo, setMemo] = useState(record?.data.memo ?? "");
  const [attachment, setAttachment] = useState({ url: record?.data.attachment ?? "", name: record?.data.attachmentName ?? "" });
  const [uploading, setUploading] = useState(false);
  const [draggedLineId, setDraggedLineId] = useState<number | null>(null);
  const saveAndNewRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const accountOptions = accounts.filter((account) => account.data.name?.trim());

  useEffect(() => {
    const startingLines = initialLines(record, accounts);
    setDate(record?.data.date ?? defaults.date ?? "");
    setReference(record?.data.reference ?? defaults.reference ?? "");
    setLines(startingLines);
    setMemo(record?.data.memo ?? "");
    setAttachment({ url: record?.data.attachment ?? "", name: record?.data.attachmentName ?? "" });
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

  function copyLine(id: number) {
    if (lines.length >= 50) return;
    setLines((current) => current.flatMap((line) => line.id === id ? [line, { ...line, id: nextLineId }] : [line]));
    setNextLineId((current) => current + 1);
  }

  function moveLine(fromId: number, toId: number) {
    if (fromId === toId) return;
    setLines((current) => {
      const from = current.findIndex((line) => line.id === fromId);
      const to = current.findIndex((line) => line.id === toId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moving] = next.splice(from, 1);
      next.splice(to, 0, moving);
      return next;
    });
  }

  async function uploadAttachment(file: File | undefined) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      setAttachment({ url: target.publicUrl, name: file.name });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? readableError(uploadError) : "The upload didn’t finish. Please try again.");
    } finally {
      setUploading(false);
    }
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
      setError(importError instanceof Error ? readableError(importError) : "We couldn’t read that CSV file.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    saveAndNewRef.current = submitter?.getAttribute("data-intent") === "save-and-new";
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
        currency: record?.data.currency || currency,
        memo,
        attachment: attachment.url,
        attachmentName: attachment.name,
        lines: JSON.stringify(filledLines.map(({ accountId, debit, credit, description, name }) => ({ accountId, debit, credit, description, name }))),
      }, record?.id);
      onSaved(saved);
      if (saveAndNewRef.current) onSaveAndNew(saved);
      else onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t save this journal. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(1400px,calc(100vw-3rem))]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{record ? "Edit journal" : "New journal"}</DialogTitle>
          <DialogDescription>Post balanced double-entry journals with a debit and a credit.</DialogDescription>
        </DialogHeader>

        <form ref={formRef} id="journal-entry-form" onSubmit={submit} className="space-y-5">
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
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => importInputRef.current?.click()} disabled={pending || !accountOptions.length} title="Import lines from a CSV with Account, Debits, Credits, Description and Name columns"><FileUp size={15} />Import</Button>
            <Input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import journal lines from CSV" onChange={(event) => { void importCsv(event.target.files?.[0]); event.target.value = ""; }} />
          </div>

          <div className="-mt-3 overflow-x-auto border-y border-border">
            <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  <th className="w-8" aria-label="Reorder" />
                  <th className={`w-9 py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                  <th className={`min-w-60 px-2.5 py-2.5 text-left ${cellBorder}`}>Account</th>
                  <th className={`w-40 px-2.5 py-2.5 text-right ${cellBorder}`}>Debits</th>
                  <th className={`w-40 px-2.5 py-2.5 text-right ${cellBorder}`}>Credits</th>
                  <th className={`min-w-64 px-2.5 py-2.5 text-left ${cellBorder}`}>Description</th>
                  <th className={`min-w-40 px-2.5 py-2.5 text-left ${cellBorder}`}>Name</th>
                  <th className="w-20"><span className="sr-only">Line actions</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const selectedAccount = accountOptions.find((account) => account.id === line.accountId);
                  const selectedLabel = selectedAccount ? accountLabel(selectedAccount) : line.accountId ? "Account unavailable" : undefined;
                  return (
                    <tr
                      key={line.id}
                      className={`group border-b border-border transition-colors hover:bg-muted/30 ${draggedLineId === line.id ? "opacity-50" : ""}`}
                      onDragOver={(event) => { if (draggedLineId !== null) event.preventDefault(); }}
                      onDrop={(event) => { event.preventDefault(); if (draggedLineId !== null) moveLine(draggedLineId, line.id); setDraggedLineId(null); }}
                    >
                      <td className="text-center">
                        <span
                          draggable
                          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedLineId(line.id); }}
                          onDragEnd={() => setDraggedLineId(null)}
                          className="inline-flex cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
                          aria-label={`Drag line ${index + 1} to reorder`}
                          title="Drag to reorder"
                        >
                          <GripVertical size={15} />
                        </span>
                      </td>
                      <td className={`pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Select
                          value={line.accountId || null}
                          items={accountOptions.map((account) => ({ value: account.id, label: accountLabel(account) }))}
                          onValueChange={(value) => updateLine(line.id, "accountId", value ?? "")}
                        >
                          <SelectTrigger className={`${cellInput} !h-11 justify-between [&_svg]:opacity-0 group-hover:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100`} aria-label={`Account for line ${index + 1}`}>
                            <SelectValue placeholder={accountOptions.length ? "" : "Add a chart account first"}>{selectedLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {accountOptions.map((account) => <SelectItem key={account.id} value={account.id}>{accountLabel(account)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Input aria-label={`Debit for line ${index + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={line.debit} onChange={(event) => updateLine(line.id, "debit", event.target.value)} className={`${cellInput} text-right tabular-nums`} />
                      </td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Input aria-label={`Credit for line ${index + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={line.credit} onChange={(event) => updateLine(line.id, "credit", event.target.value)} className={`${cellInput} text-right tabular-nums`} />
                      </td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Input aria-label={`Description for line ${index + 1}`} value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} maxLength={300} className={cellInput} />
                      </td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Input aria-label={`Name for line ${index + 1}`} value={line.name} onChange={(event) => updateLine(line.id, "name", event.target.value)} maxLength={160} className={cellInput} />
                      </td>
                      <td className="px-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy line ${index + 1}`} title="Copy line" onClick={() => copyLine(line.id)} disabled={pending || lines.length >= 50}>
                            <Copy size={14} />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove line ${index + 1}`} title="Remove line" onClick={() => removeLine(line.id)} disabled={pending}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm font-semibold">
                  <td />
                  <td className={cellBorder} />
                  <td className={`px-2.5 py-3 text-right ${cellBorder}`}>Total</td>
                  <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{moneyText(totals.debit, currency)}</td>
                  <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{moneyText(totals.credit, currency)}</td>
                  <td colSpan={3} className="px-2.5 py-3 text-right text-xs font-medium">
                    {totals.debit === 0 && totals.credit === 0
                      ? null
                      : totals.debit === totals.credit
                        ? <span className="text-primary">Balanced</span>
                        : <span className="text-destructive">Out of balance by {moneyText(Math.abs(totals.debit - totals.credit), currency)}</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLines} disabled={pending || lines.length >= 50}><Plus size={14} />Add lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearLines} disabled={pending}>Clear all lines</Button>
          </div>

          <div className="grid gap-5 pt-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="journal-memo">Memo</Label>
              <Textarea id="journal-memo" value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={4000} className="min-h-32" />
            </div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              <div className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-4 py-5 text-center">
                {attachment.url ? (
                  <div className="flex max-w-full items-center gap-2 text-sm">
                    <Paperclip size={14} className="shrink-0 text-muted-foreground" />
                    <a href={attachment.url} target="_blank" rel="noreferrer" className="truncate text-primary underline-offset-4 hover:underline">{attachment.name || "Attachment"}</a>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove attachment" onClick={() => setAttachment({ url: "", name: "" })} disabled={pending}><X size={13} /></Button>
                  </div>
                ) : (
                  <>
                    <Button type="button" variant="link" className="h-auto p-0" onClick={() => attachmentInputRef.current?.click()} disabled={uploading || pending}>
                      {uploading ? <><LoaderCircle size={14} className="animate-spin" />Uploading…</> : "Add attachment"}
                    </Button>
                    <p className="text-xs text-muted-foreground">PDF or image, up to 20 MB</p>
                  </>
                )}
                <Input ref={attachmentInputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,text/csv" className="hidden" aria-label="Add attachment" onChange={(event) => { void uploadAttachment(event.target.files?.[0]); event.target.value = ""; }} />
              </div>
            </div>
          </div>

          {!accountOptions.length ? <p className="text-sm text-muted-foreground">Add accounts in Chart of Accounts before recording a journal.</p> : null}
          {status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        </form>

        <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <div className="flex items-center gap-2">
            <Button type="submit" form="journal-entry-form" variant="outline" disabled={pending || uploading || !accountOptions.length}>{pending ? "Saving…" : "Save"}</Button>
            <div className="flex">
              <Button type="submit" form="journal-entry-form" data-intent="save-and-new" className="rounded-r-none" disabled={pending || uploading || !accountOptions.length}>Save and new</Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" className="rounded-l-none border-l border-primary-foreground/25 px-2" aria-label="More save options" disabled={pending || uploading || !accountOptions.length}><ChevronDown size={15} /></Button>} />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => formRef.current?.requestSubmit()}>Save and close</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
