"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, UploadCloud } from "lucide-react";

import { getAttachmentUploadTarget, saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/bookkeeping/CurrencyPicker";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface RecordEditorProps {
  module: ModuleDefinition;
  record: BookkeepingRecord | null;
  defaults: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
}

function getInitialValues(module: ModuleDefinition, record: BookkeepingRecord | null, defaults: Record<string, string>) {
  return Object.fromEntries(module.fields.map((field) => [
    field.key,
    record?.data[field.key] ?? defaults[field.key] ?? (field.type === "checkbox" ? "false" : ""),
  ]));
}

function calculateLineTotal(lines: string, taxRate: string, discount: string) {
  const subtotal = lines.split("\n").reduce((sum, line) => {
    const [description, quantityValue, rateValue] = line.split("|");
    const quantity = Number(quantityValue?.trim());
    const rate = Number(rateValue?.trim());
    if (!description?.trim() || !Number.isFinite(quantity) || !Number.isFinite(rate)) return sum;
    return sum + Math.max(0, quantity) * Math.max(0, rate);
  }, 0);
  const tax = subtotal * (Math.max(0, Number(taxRate) || 0) / 100);
  return Math.max(0, subtotal + tax - Math.max(0, Number(discount) || 0));
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function RecordEditor({ module, record, defaults, open, onOpenChange, onSaved }: RecordEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(module, record, defaults));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    setValues(getInitialValues(module, record, defaults));
    setError("");
  }, [defaults, module, record]);

  function changeValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function uploadFile(key: string, file: File | undefined) {
    if (!file) return;
    setError("");
    setUploading(key);
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      setValues((current) => ({ ...current, [key]: target.publicUrl, [`${key}Name`]: file.name }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The upload didn’t finish. Please try again.");
    } finally {
      setUploading(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingCurrency = module.fields.find((field) => field.type === "currency" && field.required && !values[field.key]?.trim());
    if (missingCurrency) {
      setError(`${missingCurrency.label} is required.`);
      return;
    }
    setPending(true);
    setError("");
    try {
      const saved = await saveBookkeepingRecord(module.kind, record ? { ...record.data, ...values } : values, record?.id);
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this record. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const lineTotal = values.lineItems ? calculateLineTotal(values.lineItems, values.taxRate ?? "", values.discount ?? "") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{record ? `Edit ${module.label.toLowerCase()}` : `New ${module.label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{module.description}</DialogDescription>
        </DialogHeader>

        <form id="record-editor-form" onSubmit={submit} className="space-y-5">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {module.fields.map((field) => {
              const value = values[field.key] ?? "";
              const isWide = field.type === "textarea" || field.type === "file";
              return (
                <div key={field.key} className={`min-w-0 space-y-2 ${isWide ? "sm:col-span-2" : ""}`}>
                  {field.type === "checkbox" ? (
                    <div className="flex min-h-9 items-center gap-3 rounded-md border border-border px-3">
                      <Checkbox
                        id={`field-${field.key}`}
                        checked={value === "true"}
                        onCheckedChange={(checked) => changeValue(field.key, checked === true ? "true" : "false")}
                      />
                      <Label htmlFor={`field-${field.key}`} className="cursor-pointer font-normal">{field.label}</Label>
                    </div>
                  ) : (
                    <Label htmlFor={`field-${field.key}`}>{field.label}{field.required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
                  )}

                  {field.type === "textarea" ? (
                    <Textarea
                      id={`field-${field.key}`}
                      value={value}
                      onChange={(event) => changeValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={field.key === "lineItems" ? 4 : 3}
                    />
                  ) : null}

                  {field.type === "select" ? (
                    <Select value={value || undefined} onValueChange={(nextValue) => changeValue(field.key, nextValue ?? "")}>
                      <SelectTrigger id={`field-${field.key}`} className="w-full">
                        <SelectValue placeholder="Choose an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((option) => <SelectItem value={option} key={option}>{option}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {field.type === "currency" ? (
                    <CurrencyPicker
                      id={`field-${field.key}`}
                      value={value}
                      required={field.required}
                      onValueChange={(nextValue) => changeValue(field.key, nextValue)}
                    />
                  ) : null}

                  {field.type === "file" ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
                      <Input
                        id={`field-${field.key}`}
                        type="file"
                        accept={field.key === "logo" ? "image/png,image/jpeg,image/webp,image/gif" : "application/pdf,image/png,image/jpeg,image/webp,text/csv"}
                        onChange={(event) => void uploadFile(field.key, event.target.files?.[0])}
                        disabled={uploading === field.key}
                        className="h-10 cursor-pointer bg-card file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"
                      />
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {uploading === field.key ? <LoaderCircle size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                        <span className="truncate">{values[`${field.key}Name`] ?? (value ? "A file is attached" : field.help ?? "Choose a file to attach")}</span>
                      </p>
                    </div>
                  ) : null}

                  {(!field.type || field.type === "text" || field.type === "email" || field.type === "number" || field.type === "date") ? (
                    <Input
                      id={`field-${field.key}`}
                      type={field.type ?? "text"}
                      value={value}
                      onChange={(event) => changeValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      min={field.type === "number" ? "0" : undefined}
                      step={field.type === "number" ? "any" : undefined}
                    />
                  ) : null}

                  {field.help && field.type !== "file" && field.type !== "checkbox" ? <p className="text-xs leading-5 text-muted-foreground">{field.help}</p> : null}
                  {field.key === "lineItems" && lineTotal !== null ? (
                    <p className="flex justify-between rounded-md bg-accent/60 px-3 py-2 text-xs text-accent-foreground">
                      <span>Calculated total</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(lineTotal, values.currency || "USD")}</span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending || Boolean(uploading)}>Cancel</Button>
          <Button type="submit" form="record-editor-form" disabled={pending || Boolean(uploading)}>
            {pending ? "Saving…" : record ? "Save changes" : `Save ${module.label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
