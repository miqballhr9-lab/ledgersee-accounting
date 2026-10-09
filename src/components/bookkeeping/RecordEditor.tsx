"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown, Copy, LoaderCircle, Mail, MessageCircle, MessageSquareText, Plus, Printer, Share2, Trash2, UploadCloud } from "lucide-react";

import {
  createCustomerDocumentShareLink,
  createInvoiceShareLink,
  getAttachmentUploadTarget,
  saveBookkeepingRecord,
  sendCustomerDocumentRecord,
  sendInvoiceRecord,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/bookkeeping/CurrencyPicker";
import type { ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { currencyAmount, dueDateForTerms, invoiceSubtotal, parseInvoiceLines } from "@/lib/invoice-utils";

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
  onSaveComplete: (record: BookkeepingRecord, intent: "save-and-new" | "save-and-copy") => Promise<void>;
}

interface InvoiceLine {
  id: string;
  itemId: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
}

const structuredLineKinds = new Set(["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices", "purchase-orders"]);
const shareableDocumentKinds = new Set(["invoices", "estimates", "sales-orders", "credit-notes"]);
function getInitialValues(module: ModuleDefinition, record: BookkeepingRecord | null, defaults: Record<string, string>) {
  const values: Record<string, string> = {
    ...Object.fromEntries(module.fields.map((field) => [
      field.key,
      record?.data[field.key] ?? defaults[field.key] ?? (field.type === "checkbox" ? "false" : ""),
    ])),
    customerId: record?.data.customerId ?? "",
  };
  if (module.kind === "invoices") {
    values.paymentTerms = record?.data.paymentTerms || "30 days";
    values.dueDate = dueDateForTerms(values.issueDate, values.paymentTerms) || values.dueDate;
  }
  return values;
}

function readInvoiceLines(lines: string, items: BookkeepingRecord[]): InvoiceLine[] {
  const parsedLines = parseInvoiceLines(lines).map((line, index) => {
    const item = items.find((option) => option.id === line.itemId)
      ?? items.find((option) => option.data.name?.trim().toLowerCase() === line.name.trim().toLowerCase());
    return {
      id: `saved-line-${index}`,
      itemId: item?.id ?? "",
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      rate: line.rate,
    };
  });

  return parsedLines.length ? parsedLines : [{ id: "new-line", itemId: "", name: "", description: "", quantity: "", rate: "" }];
}

function serializeInvoiceLines(lines: InvoiceLine[]): string {
  return JSON.stringify(lines
    .filter((line) => line.itemId || line.name.trim() || line.description.trim() || line.quantity.trim() || line.rate.trim())
    .map((line) => ({ ...line, name: line.name.trim(), description: line.description.trim() })));
}

function catalogItemLabel(item: BookkeepingRecord, currency: string): string {
  const itemName = item.data.name?.trim() ?? "";
  const itemType = item.data.itemType || "Item";
  const rate = Number(item.data.rate) || 0;
  const unit = item.data.unit?.trim();
  return `${itemName} · ${itemType} · ${currencyAmount(rate, currency)}${unit ? ` / ${unit}` : ""}`;
}

function selectedCatalogItemLabel(items: BookkeepingRecord[], itemId: string, currency: string, fallbackName: string): string | undefined {
  const item = items.find((option) => option.id === itemId);
  return item ? catalogItemLabel(item, currency) : fallbackName || undefined;
}

export default function RecordEditor({ module, record, customers, vendors, items, defaults, open, onOpenChange, onSaved, onSaveComplete }: RecordEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(module, record, defaults));
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>(() => readInvoiceLines(record?.data.lineItems ?? "", items));
  const availableItems = items.filter((item) => item.data.name?.trim());
  const [savedRecordId, setSavedRecordId] = useState<string | null>(record?.id ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const itemsRef = useRef(items);
  const formRef = useRef<HTMLFormElement>(null);
  const sendSubmitRef = useRef<HTMLButtonElement>(null);
  const saveNewSubmitRef = useRef<HTMLButtonElement>(null);
  const saveCopySubmitRef = useRef<HTMLButtonElement>(null);
  const sendMethod = useRef("email");
  const sendWindow = useRef<Window | null>(null);

  useEffect(() => {
    setValues(getInitialValues(module, record, defaults));
    setInvoiceLines(readInvoiceLines(record?.data.lineItems ?? "", itemsRef.current));
    setSavedRecordId(record?.id ?? null);
    setError("");
    setNotice("");
    setShareLink("");
    sendMethod.current = "email";
    sendWindow.current = null;
  }, [defaults, module, record]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function changeValue(key: string, value: string) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (module.kind === "invoices" && (key === "issueDate" || key === "paymentTerms")) {
        next.dueDate = dueDateForTerms(next.issueDate ?? "", next.paymentTerms ?? "30 days");
      }
      return next;
    });
  }

  async function shareDocument() {
    if (!savedRecordId) return;
    setSharing(true);
    setError("");
    setNotice("");
    try {
      const link = module.kind === "invoices"
        ? await createInvoiceShareLink(savedRecordId)
        : await createCustomerDocumentShareLink(savedRecordId, module.kind as "estimates" | "sales-orders" | "credit-notes");
      setShareLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setNotice(`${module.label} link copied. Anyone with the link can view this document.`);
      } catch {
        setNotice(`Your ${module.label.toLowerCase()} link is ready below to copy and share.`);
      }
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : `We couldn’t create the ${module.label.toLowerCase()} link.`);
    } finally {
      setSharing(false);
    }
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

  function submitWithIntent(button: HTMLButtonElement | null) {
    if (button) formRef.current?.requestSubmit(button);
  }

  function startInvoiceSend(method: "email" | "whatsapp" | "sms") {
    sendMethod.current = method;
    setError("");
    if (method !== "email") {
      const openedWindow = window.open("about:blank", "_blank");
      if (!openedWindow) {
        setError("Allow pop-ups to open the message app, then try again.");
        return;
      }
      openedWindow.opener = null;
      sendWindow.current = openedWindow;
    }
    submitWithIntent(sendSubmitRef.current);
  }

  function closePreparedMessage() {
    sendWindow.current?.close();
    sendWindow.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : "save-and-close";
    const shouldSend = shareableDocumentKinds.has(module.kind) && intent === "save-and-send";
    const serializedDocumentLines = serializeInvoiceLines(invoiceLines);
    if (structuredLineKinds.has(module.kind)) {
      const enteredLines = invoiceLines.filter((line) => line.itemId || line.name.trim() || line.description.trim() || line.quantity.trim() || line.rate.trim());
      if (!enteredLines.length) {
        closePreparedMessage();
        setError(`Add at least one item or service to this ${module.label.toLowerCase()}.`);
        return;
      }
      const invalidLine = enteredLines.findIndex((line) => {
        const quantity = Number(line.quantity);
        const rate = Number(line.rate);
        return !line.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0;
      });
      if (invalidLine !== -1) {
        closePreparedMessage();
        setError(`Check line ${invalidLine + 1}: choose an item or service and enter a quantity and rate.`);
        return;
      }
    }
    const missingCustomer = module.fields.find((field) => field.key === "customer" && field.required && !values.customer?.trim());
    if (missingCustomer) {
      closePreparedMessage();
      setError(`Choose a saved ${missingCustomer.label.toLowerCase()} before saving.`);
      return;
    }
    const missingVendor = module.fields.find((field) => field.key === "vendor" && field.required && !values.vendor?.trim());
    if (missingVendor) {
      closePreparedMessage();
      setError(`Choose a saved ${missingVendor.label.toLowerCase()} before saving.`);
      return;
    }
    const missingCurrency = module.fields.find((field) => field.type === "currency" && field.required && !values[field.key]?.trim());
    if (missingCurrency) {
      closePreparedMessage();
      setError(`${missingCurrency.label} is required.`);
      return;
    }
    if (shouldSend && sendMethod.current !== "email") {
      const recipient = customerOptions.find((customer) => customer.id === values.customerId || customer.id === values.customer)
        ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase());
      const phoneDigits = recipient?.data.phone?.replace(/\D/g, "") ?? "";
      if (!recipient || phoneDigits.length < 7) {
        closePreparedMessage();
        setError("Add the customer’s phone number, including country code, before using WhatsApp or SMS.");
        return;
      }
      if (!sendWindow.current) {
        setError("Allow pop-ups to open the message app, then try again.");
        return;
      }
    }
    setPending(true);
    setError("");
    setNotice("");
    try {
      const selectedCustomer = shareableDocumentKinds.has(module.kind)
        ? customerOptions.find((customer) => customer.id === values.customerId || customer.id === values.customer)
          ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase())
        : undefined;
      const normalizedValues = selectedCustomer?.data.name
        ? { ...values, customer: selectedCustomer.data.name, customerId: selectedCustomer.id }
        : values;
      const recordValues = structuredLineKinds.has(module.kind) ? { ...normalizedValues, lineItems: serializedDocumentLines, ...(module.kind === "credit-notes" ? { amount: invoiceTotal.toFixed(2) } : {}) } : normalizedValues;
      const saved = await saveBookkeepingRecord(module.kind, record ? { ...record.data, ...recordValues } : recordValues, savedRecordId ?? undefined);
      setSavedRecordId(saved.id);
      onSaved(saved);
      if (shouldSend) {
        try {
          if (sendMethod.current === "email") {
            const shareToken = module.kind === "invoices"
              ? await sendInvoiceRecord(saved.id)
              : await sendCustomerDocumentRecord(saved.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
            const status = module.kind === "invoices" || module.kind === "estimates" ? "Sent" : saved.data.status;
            onSaved({ ...saved, data: { ...saved.data, shareToken, status } });
            setNotice(`${module.label} emailed to the customer.`);
          } else {
            const recipient = customerOptions.find((customer) => customer.id === saved.data.customerId || customer.id === saved.data.customer)
              ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === saved.data.customer?.trim().toLowerCase());
            const phone = recipient?.data.phone?.trim() ?? "";
            const phoneDigits = phone.replace(/\D/g, "");
            const documentLink = module.kind === "invoices"
              ? await createInvoiceShareLink(saved.id)
              : await createCustomerDocumentShareLink(saved.id, module.kind as "estimates" | "sales-orders" | "credit-notes");
            const numberKey = module.kind === "invoices" ? "invoiceNumber" : module.kind === "estimates" ? "estimateNumber" : module.kind === "sales-orders" ? "orderNumber" : "creditNumber";
            const message = `Hello ${recipient?.data.name || "there"}, ${module.label.toLowerCase()} ${saved.data[numberKey] || ""} for ${saved.data.amount || "0"} ${saved.data.currency || ""} is ready: ${documentLink}`;
            const destination = sendMethod.current === "whatsapp"
              ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`
              : `sms:${phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(message)}`;
            const openedWindow = sendWindow.current;
            if (!openedWindow) throw new Error("Allow pop-ups to open the message app, then try again.");
            openedWindow.location.href = destination;
            sendWindow.current = null;
            setShareLink(documentLink);
            setNotice(`${sendMethod.current === "whatsapp" ? "WhatsApp" : "SMS"} opened with the ${module.label.toLowerCase()} message ready. Send it from that app to finish.`);
            onSaved({ ...saved, data: { ...saved.data, shareToken: documentLink.split("/").at(-1) || "" } });
            return;
          }
        } catch (sendError) {
          sendWindow.current?.close();
          sendWindow.current = null;
          setError(`${module.label} saved, but it couldn’t be sent: ${sendError instanceof Error ? sendError.message : "Please try again."}`);
          return;
        }
      }
      if (intent === "save-and-new" || intent === "save-and-copy") {
        await onSaveComplete(saved, intent);
      } else {
        onOpenChange(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn’t save this record. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const subtotal = invoiceSubtotal(invoiceLines);
  const taxAmount = subtotal * (Math.max(0, Number(values.taxRate) || 0) / 100);
  const discount = Math.max(0, Number(values.discount) || 0);
  const invoiceTotal = Math.max(0, subtotal + taxAmount - discount);
  const hasStructuredLines = structuredLineKinds.has(module.kind);
  const customerOptions = customers.filter((customer) => customer.data.name?.trim());
  const selectedCustomer = customerOptions.find((customer) => customer.id === values.customerId)
    ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase())
    ?? customerOptions.find((customer) => customer.id === values.customer);
  const vendorOptions = vendors.filter((vendor) => vendor.data.name?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{record ? `Edit ${module.label.toLowerCase()}` : `New ${module.label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{module.description}</DialogDescription>
        </DialogHeader>

        <form ref={formRef} id="record-editor-form" onSubmit={submit} className="space-y-5">
          {shareableDocumentKinds.has(module.kind) ? (
            <>
              <button ref={sendSubmitRef} type="submit" name="intent" value="save-and-send" className="hidden" tabIndex={-1} aria-hidden="true" />
              <button ref={saveNewSubmitRef} type="submit" name="intent" value="save-and-new" className="hidden" tabIndex={-1} aria-hidden="true" />
              <button ref={saveCopySubmitRef} type="submit" name="intent" value="save-and-copy" className="hidden" tabIndex={-1} aria-hidden="true" />
            </>
          ) : null}
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
                      id={hasStructuredLines && field.key === "lineItems" ? `${module.kind}-line-items-label` : undefined}
                      htmlFor={`field-${field.key}`}
                    >
                      {field.label}{field.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </Label>
                  )}

                  {field.type === "textarea" && !(hasStructuredLines && field.key === "lineItems") ? (
                    <Textarea
                      id={`field-${field.key}`}
                      value={value}
                      onChange={(event) => changeValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={field.key === "lineItems" ? 4 : 3}
                    />
                  ) : null}

                  {hasStructuredLines && field.key === "lineItems" ? (
                    <div className="space-y-3" role="group" aria-labelledby={`${module.kind}-line-items-label`}>
                      {invoiceLines.map((line, index) => (
                        <div key={line.id} className="grid min-w-0 grid-cols-2 items-end gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1.4fr)_5rem_7rem_7.5rem_2.75rem]">
                          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
                            <Label htmlFor={`invoice-item-${line.id}`} className="text-xs text-muted-foreground">Item or service</Label>
                            <Select
                              value={line.itemId || undefined}
                              onValueChange={(itemId) => {
                                const item = availableItems.find((option) => option.id === itemId);
                                if (!item) return;
                                setInvoiceLines((current) => current.map((currentLine) => currentLine.id === line.id
                                  ? {
                                      ...currentLine,
                                      itemId: item.id,
                                      name: item.data.name?.trim() ?? "",
                                      description: currentLine.description || item.data.description?.trim() || "",
                                      quantity: currentLine.quantity || "1",
                                      rate: item.data.rate ?? "0",
                                    }
                                  : currentLine));
                              }}
                            >
                              <SelectTrigger id={`invoice-item-${line.id}`} className="w-full" disabled={!availableItems.length}>
                                <SelectValue placeholder={availableItems.length ? "Choose item or service" : "Add an item or service first"}>
                                  {selectedCatalogItemLabel(availableItems, line.itemId, values.currency || "USD", line.name)}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {availableItems.map((item) => {
                                  return (
                                    <SelectItem value={item.id} key={item.id}>
                                      {catalogItemLabel(item, values.currency || "USD")}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <Label htmlFor={`invoice-description-${line.id}`} className="text-xs text-muted-foreground">Description</Label>
                            <Input
                              id={`invoice-description-${line.id}`}
                              value={line.description}
                              onChange={(event) => setInvoiceLines((current) => current.map((currentLine) => currentLine.id === line.id ? { ...currentLine, description: event.target.value } : currentLine))}
                              placeholder="Optional details for this item or service"
                            />
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
                              {currencyAmount((Number(line.quantity) || 0) * (Number(line.rate) || 0), values.currency || "USD")}
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
                          name: "",
                          description: "",
                          quantity: "",
                          rate: "",
                        }])}
                        className="min-h-11 gap-2"
                      >
                        <Plus size={16} strokeWidth={1.75} />
                        Add line
                      </Button>
                      {!availableItems.length ? <p className="text-xs leading-5 text-muted-foreground">No saved items or services yet. Add them in <Link href="/app/items" className="font-medium text-primary underline underline-offset-4">Items &amp; services</Link>, then reopen this document.</p> : null}
                      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{currencyAmount(subtotal, values.currency || "USD")}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tax ({Math.max(0, Number(values.taxRate) || 0)}%)</span><span className="tabular-nums">{currencyAmount(taxAmount, values.currency || "USD")}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{currencyAmount(discount, values.currency || "USD")}</span></div>
                        <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold"><span>{module.label} total</span><span className="tabular-nums">{currencyAmount(invoiceTotal, values.currency || "USD")}</span></div>
                      </div>
                    </div>
                  ) : null}

                  {field.key === "customer" ? (
                    <>
                      <Select
                        value={selectedCustomer?.id}
                        itemToStringLabel={(customerId) => {
                          const customer = customerOptions.find((option) => option.id === customerId);
                          if (!customer) return "";
                          const name = customer.data.name.trim();
                          const detail = customer.data.company?.trim() || customer.data.email?.trim();
                          return detail ? `${name} · ${detail}` : name;
                        }}
                        onValueChange={(customerId) => {
                          const customer = customerOptions.find((option) => option.id === customerId);
                          if (customer?.data.name) {
                            changeValue(field.key, customer.data.name);
                            setValues((current) => ({ ...current, customer: customer.data.name, customerId: customer.id }));
                          }
                        }}
                      >
                        <SelectTrigger id={`field-${field.key}`} className="w-full" aria-required={field.required}>
                          <SelectValue placeholder={customerOptions.length ? "Choose a customer" : "Add a customer first"}>
                            {selectedCustomer?.data.name?.trim() || undefined}
                          </SelectValue>
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
                      value={module.kind === "credit-notes" && field.key === "amount" ? invoiceTotal.toFixed(2) : value}
                      onChange={(event) => changeValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      min={field.type === "number" ? "0" : undefined}
                      step={field.type === "number" ? "any" : undefined}
                      readOnly={(module.kind === "invoices" && field.key === "dueDate") || (module.kind === "credit-notes" && field.key === "amount")}
                    />
                  ) : null}

                  {field.help && field.type !== "file" && field.type !== "checkbox" && !(hasStructuredLines && field.key === "lineItems") ? <p className="text-xs leading-5 text-muted-foreground">{field.help}</p> : null}
                </div>
              );
            })}
          </div>

          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
          {notice ? (
            <div role="status" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-primary">
              <p>{notice}</p>
              {shareLink ? <a href={shareLink} target="_blank" rel="noreferrer" className="mt-1 block break-all underline underline-offset-2">{shareLink}</a> : null}
            </div>
          ) : null}
        </form>

        <DialogFooter className="flex-wrap items-center">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending || Boolean(uploading)}>Cancel</Button>
          {shareableDocumentKinds.has(module.kind) && savedRecordId ? (
            <>
              <Button type="button" variant="outline" onClick={() => void shareDocument()} disabled={sharing || pending}><Share2 size={15} />{sharing ? "Copying…" : "Share link"}</Button>
              <Button type="button" nativeButton={false} variant="outline" render={<Link href={module.kind === "invoices" ? `/app/invoices/${savedRecordId}/print` : `/app/documents/${module.kind}/${savedRecordId}/print`} target="_blank" rel="noreferrer" />}><Printer size={15} />Print / PDF</Button>
            </>
          ) : null}
          {shareableDocumentKinds.has(module.kind) ? (
            <>
              {savedRecordId ? (
                <Button type="button" variant="outline" disabled={pending || Boolean(uploading)} onClick={() => submitWithIntent(saveCopySubmitRef.current)}>
                  <Copy size={15} />Copy {module.label.toLowerCase()}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={pending || Boolean(uploading)} /> }>
                  {pending ? "Saving…" : `Save ${module.label.toLowerCase()}`}<ChevronDown size={15} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => submitWithIntent(saveNewSubmitRef.current)}>Save and new</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => formRef.current?.requestSubmit()}>Save and close</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => submitWithIntent(saveCopySubmitRef.current)}>Save and copy</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" disabled={pending || Boolean(uploading)} /> }>
                  <Share2 size={15} />{pending ? "Saving…" : "Save and send"}<ChevronDown size={15} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => startInvoiceSend("email")}><Mail size={15} />Email</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => startInvoiceSend("whatsapp")}><MessageCircle size={15} />WhatsApp</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => startInvoiceSend("sms")}><MessageSquareText size={15} />SMS</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button type="submit" form="record-editor-form" disabled={pending || Boolean(uploading)}>
              {pending ? "Saving…" : record ? "Save changes" : `Save ${module.label.toLowerCase()}`}
            </Button>
          )}
          {shareableDocumentKinds.has(module.kind) ? <p className="w-full text-right text-xs text-muted-foreground">Email sends directly; WhatsApp and SMS open a message for you to send.</p> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
