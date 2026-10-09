"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, Trash2, UploadCloud } from "lucide-react";

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
  customers: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  items: BookkeepingRecord[];
  defaults: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookkeepingRecord) => void;
}

interface InvoiceLine {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
  rate: string;
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

function readInvoiceLines(lines: string, items: BookkeepingRecord[]): InvoiceLine[] {
  const parsedLines = lines
    .split("\n")
    .map((line) => line.split("|"))
    .filter((parts) => parts.some((part) => part.trim()))
    .map((parts, index) => {
      const description = parts[0]?.trim() ?? "";
      const item = items.find((option) => option.data.name?.trim().toLowerCase() === description.toLowerCase());
      return {
        id: `saved-line-${index}`,
        itemId: item?.id ?? "",
        description,
        quantity: parts[1]?.trim() ?? "",
        rate: parts[2]?.trim() ?? "",
      };
    });

  return parsedLines.length ? parsedLines : [{ id: "new-line", itemId: "", description: "", quantity: "", rate: "" }];
}

function serializeInvoiceLines(lines: InvoiceLine[]): string {
  return lines
    .filter((line) => line.itemId || line.description.trim() || line.quantity.trim() || line.rate.trim())
    .map((line) => `${line.description.trim().replace(/[|\r\n]+/g, " ")} | ${line.quantity.trim()} | ${line.rate.trim()}`)
    .join("\n");
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function RecordEditor({ module, record, customers, vendors, items, defaults, open, onOpenChange, onSaved }: RecordEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(module, record, defaults));
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>(() => readInvoiceLines(record?.data.lineItems ?? "", items));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    setValues(getInitialValues(module, record, defaults));
    setInvoiceLines(readInvoiceLines(record?.data.lineItems ?? "", items));
    setError("");
  }, [defaults, items, module, record]);

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
    const serializedInvoiceLines = serializeInvoiceLines(invoiceLines);
    if (module.kind === "invoices") {
      const enteredLines = invoiceLines.filter((line) => line.itemId || line.description.trim() || line.quantity.trim() || line.rate.trim());
      if (!enteredLines.length) {
        setError("Add at least one item or service to this invoice.");
        return;
      }
      const invalidLine = enteredLines.findIndex((line) => {
        const quantity = Number(line.quantity);
        const rate = Number(line.rate);
        return !line.description.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0;
      });
      if (invalidLine !== -1) {
        setError(`Check line ${invalidLine + 1}: choose an item or service and enter a quantity and rate.`);
        return;
      }
    }
    const missingCustomer = module.fields.find((field) => field.key === "customer" && field.required && !values.customer?.trim());
    if (missingCustomer) {
      setError(`Choose a saved ${missingCustomer.label.toLowerCase()} before saving.`);
      return;
    }
    const missingVendor = module.fields.find((field) => field.key === "vendor" && field.required && !values.vendor?.trim());
    if (missingVendor) {
      setError(`Choose a saved ${missingVendor.label.toLowerCase()} before saving.`);
      return;
    }
    const missingCurrency = module.fields.find((field) => field.type === "currency" && field.required && !values[field.key]?.trim());
    if (missingCurrency) {
      setError(`${missingCurrency.label} is required.`);
      return;
    }
    setPending(true);
    setError("");
    try {
      const recordValues = module.kind === "invoices" ? { ...values, lineItems: serializedInvoiceLines } : values;
      const saved = await saveBookkeepingRecord(module.kind, record ? { ...record.data, ...recordValues } : recordValues, record?.id);
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this record. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const linesValue = module.kind === "invoices" ? serializeInvoiceLines(invoiceLines) : values.lineItems;
  const lineTotal = linesValue ? calculateLineTotal(linesValue, values.taxRate ?? "", values.discount ?? "") : null;
  const customerOptions = customers.filter((customer) => customer.data.name?.trim());
  const vendorOptions = vendors.filter((vendor) => vendor.data.name?.trim());

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
                    <Label
                      id={module.kind === "invoices" && field.key === "lineItems" ? "invoice-line-items-label" : undefined}
                      htmlFor={`field-${field.key}`}
                    >
                      {field.label}{field.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </Label>
                  )}

                  {field.type === "textarea" && !(module.kind === "invoices" && field.key === "lineItems") ? (
                    <Textarea
                      id={`field-${field.key}`}
                      value={value}
                      onChange={(event) => changeValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={field.key === "lineItems" ? 4 : 3}
                    />
                  ) : null}

                  {module.kind === "invoices" && field.key === "lineItems" ? (
                    <div className="space-y-3" role="group" aria-labelledby="invoice-line-items-label">
                      {invoiceLines.map((line, index) => (
                        <div key={line.id} className="grid min-w-0 grid-cols-2 items-end gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7.5rem_2.75rem]">
                          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
                            <Label htmlFor={`invoice-item-${line.id}`} className="text-xs text-muted-foreground">Item or service</Label>
                            <Select
                              value={line.itemId || undefined}
                              onValueChange={(itemId) => {
                                const item = items.find((option) => option.id === itemId);
                                if (!item) return;
                                setInvoiceLines((current) => current.map((currentLine) => currentLine.id === line.id
                                  ? {
                                      ...currentLine,
                                      itemId: item.id,
                                      description: item.data.name?.trim() ?? "",
                                      quantity: currentLine.quantity || "1",
                                      rate: item.data.rate ?? "0",
                                    }
                                  : currentLine));
                              }}
                            >
                              <SelectTrigger id={`invoice-item-${line.id}`} className="w-full" disabled={!items.length}>
                                <SelectValue placeholder={items.length ? "Choose item or service" : "Add an item or service first"} />
                              </SelectTrigger>
                              <SelectContent>
                                {items.filter((item) => item.data.name?.trim()).map((item) => {
                                  const itemName = item.data.name.trim();
                                  const itemType = item.data.itemType || "Item";
                                  const rate = Number(item.data.rate) || 0;
                                  const unit = item.data.unit?.trim();
                                  return (
                                    <SelectItem value={item.id} key={item.id}>
                                      {itemName} · {itemType} · {formatCurrency(rate, values.currency || "USD")}{unit ? ` / ${unit}` : ""}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {line.description && !line.itemId ? (
                              <p className="truncate text-xs text-muted-foreground">Saved description: {line.description}</p>
                            ) : null}
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label htmlFor={`invoice-quantity-${line.id}`} className="text-xs text-muted-foreground">Quantity</Label>
                            <Input
                              id={`invoice-quantity-${line.id}`}
                              type="number"
                              min="0.01"
                              step="any"
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(event) => setInvoiceLines((current) => current.map((currentLine) => currentLine.id === line.id ? { ...currentLine, quantity: event.target.value } : currentLine))}
                              placeholder="1"
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label htmlFor={`invoice-rate-${line.id}`} className="text-xs text-muted-foreground">Rate</Label>
                            <Input
                              id={`invoice-rate-${line.id}`}
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={line.rate}
                              onChange={(event) => setInvoiceLines((current) => current.map((currentLine) => currentLine.id === line.id ? { ...currentLine, rate: event.target.value } : currentLine))}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <div className="flex h-8 min-w-0 items-center truncate rounded-lg bg-muted px-2.5 text-sm font-medium tabular-nums">
                              {formatCurrency((Number(line.quantity) || 0) * (Number(line.rate) || 0), values.currency || "USD")}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove line ${index + 1}`}
                            onClick={() => setInvoiceLines((current) => current.filter((currentLine) => currentLine.id !== line.id))}
                            className="size-11 justify-self-end text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 size={16} strokeWidth={1.75} />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setInvoiceLines((current) => [...current, {
                          id: crypto.randomUUID(),
                          itemId: "",
                          description: "",
                          quantity: "",
                          rate: "",
                        }])}
                        className="min-h-11 gap-2"
                      >
                        <Plus size={16} strokeWidth={1.75} />
                        Add line
                      </Button>
                      {!items.length ? <p className="text-xs leading-5 text-muted-foreground">Create an item or service in Items & services, then select it here.</p> : null}
                    </div>
                  ) : null}

                  {field.key === "customer" ? (
                    <>
                      <Select
                        value={customerOptions.find((customer) => customer.data.name === value)?.id}
                        itemToStringLabel={(customerId) => {
                          const customer = customerOptions.find((option) => option.id === customerId);
                          if (!customer) return "";
                          const name = customer.data.name.trim();
                          const detail = customer.data.company?.trim() || customer.data.email?.trim();
                          return detail ? `${name} · ${detail}` : name;
                        }}
                        onValueChange={(customerId) => {
                          const customer = customerOptions.find((option) => option.id === customerId);
                          if (customer?.data.name) changeValue(field.key, customer.data.name);
                        }}
                      >
                        <SelectTrigger id={`field-${field.key}`} className="w-full" aria-required={field.required}>
                          <SelectValue placeholder={customerOptions.length ? "Choose a customer" : "Add a customer first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {customerOptions.map((customer) => {
                            const name = customer.data.name.trim();
                            const detail = customer.data.company?.trim() || customer.data.email?.trim();
                            return <SelectItem value={customer.id} key={customer.id}>{detail ? `${name} · ${detail}` : name}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                      {!customerOptions.length ? <p className="text-xs leading-5 text-muted-foreground">Add a customer in Customers before creating this record.</p> : null}
                    </>
                  ) : null}

                  {field.key === "vendor" ? (
                    <>
                      <Select
                        value={vendorOptions.find((vendor) => vendor.data.name === value)?.id}
                        onValueChange={(vendorId) => {
                          const vendor = vendorOptions.find((option) => option.id === vendorId);
                          if (vendor?.data.name) changeValue(field.key, vendor.data.name);
                        }}
                      >
                        <SelectTrigger id={`field-${field.key}`} className="w-full" aria-required={field.required}>
                          <SelectValue placeholder={vendorOptions.length ? "Choose a vendor" : "Add a vendor first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {vendorOptions.map((vendor) => {
                            const name = vendor.data.name.trim();
                            const detail = vendor.data.company?.trim() || vendor.data.email?.trim();
                            return <SelectItem value={vendor.id} key={vendor.id}>{detail ? `${name} · ${detail}` : name}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                      {!vendorOptions.length ? <p className="text-xs leading-5 text-muted-foreground">Add a vendor in Vendors before creating this record.</p> : null}
                    </>
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

                  {field.key !== "customer" && field.key !== "vendor" && (!field.type || field.type === "text" || field.type === "email" || field.type === "number" || field.type === "date") ? (
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

                  {field.help && field.type !== "file" && field.type !== "checkbox" && !(module.kind === "invoices" && field.key === "lineItems") ? <p className="text-xs leading-5 text-muted-foreground">{field.help}</p> : null}
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
