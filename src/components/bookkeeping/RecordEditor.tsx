"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ChevronDown, Copy, LoaderCircle, Repeat, Mail, MessageCircle, MessageSquareText, Plus, Printer, Share2, Trash2, UploadCloud, X } from "lucide-react";
import { readableError } from "@/lib/action-error";

import {
  createCustomerDocumentShareLink,
  createInvoiceShareLink,
  getAttachmentUploadTarget,
  listBookkeepingRecords,
  recordExpensePayment,
  saveBookkeepingRecord,
  sendCustomerDocumentRecord,
  sendInvoiceRecord,
} from "@/app/actions";
import MakeRecurringDialog from "@/components/bookkeeping/MakeRecurringDialog";
import NoAccountsNotice from "@/components/bookkeeping/NoAccountsNotice";
import type { RecurringKind } from "@/lib/recurring";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isInventoryItem } from "@/lib/inventory";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/bookkeeping/CurrencyPicker";
import type { FormField, ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { formatCustomerAddress } from "@/lib/customer-utils";
import { expenseLinesFromData } from "@/lib/expense-utils";
import { currencyAmount, dueDateForTerms, invoiceSubtotal, parseInvoiceLines } from "@/lib/invoice-utils";
import { accountCategoryForType } from "@/lib/account-types";
import { paymentAccountLabel, paymentAccountType, receivingAccountType } from "@/lib/payment-accounts";

interface RecordEditorProps {
  module: ModuleDefinition;
  record: BookkeepingRecord | null;
  customers: BookkeepingRecord[];
  vendors: BookkeepingRecord[];
  items: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  defaultCurrency?: string;
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
  bundleId?: string;
  bundleName?: string;
  bundleShow?: string;
}

const itemAccountKeys = new Set(["incomeAccountId", "expenseAccountId", "assetAccountId"]);

/** Which item fields show for each item type, as in QuickBooks' product/service forms. */
function itemFieldVisible(key: string, itemType: string) {
  const type = itemType === "Product" || !itemType ? "Inventory" : itemType;
  if (type === "Bundle") return ["name", "category", "sku", "itemType", "bundleItems", "showComponents"].includes(key);
  if (["bundleItems", "showComponents"].includes(key)) return false;
  if (type !== "Inventory" && ["openingQty", "openingDate", "reorderPoint", "assetAccountId"].includes(key)) return false;
  return true;
}

interface BundlePart {
  itemId: string;
  quantity: string;
}

function readBundleParts(value: string): BundlePart[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.flatMap((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).itemId === "string" ? [{ itemId: (part as Record<string, string>).itemId, quantity: String((part as Record<string, unknown>).quantity ?? "1") }] : [])) : [];
  } catch {
    return [];
  }
}

interface ExpenseEntryLine {
  id: string;
  category: string;
  description: string;
  amount: string;
}

/** An "Item details" line on a bill, expense or supplier credit: what was bought, how many, at what cost. */
interface PurchaseItemLine {
  id: string;
  itemId: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
}

function readPurchaseItemLines(record: BookkeepingRecord | null): PurchaseItemLine[] {
  return parseInvoiceLines(record?.data.lineItems ?? "")
    .filter((line) => line.itemId)
    .map((line, index) => ({ id: `saved-item-${index}`, itemId: line.itemId, name: line.name, description: line.description, quantity: line.quantity, rate: line.rate }));
}

const structuredLineKinds = new Set(["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices", "purchase-orders"]);
const shareableDocumentKinds = new Set(["invoices", "estimates", "sales-orders", "credit-notes"]);
/** Expenses and bills share the category · description · amount line editor. */
const categoryLineKinds = new Set(["expenses", "bills", "supplier-credits"]);

// Sales and purchase transactions open as a full-page form, as in QuickBooks Online.
const partyKeys = new Set(["customer", "vendor", "payee"]);
const footnoteKeys = new Set(["notes", "memo", "reason", "className", "location", "project", "tags", "attachment"]);
const totalKeys = new Set(["taxRate", "discount"]);
// QuickBooks reads across: address, terms, dates, then the rest.
const headerOrder = ["billingAddress", "paymentTerms", "issueDate", "billDate", "date", "expenseDate", "dueDate", "expiryDate", "deliveryDate", "expectedDate", "shippingAddress"];
// Spreadsheet-style cells, as on the journal entry.
const cellInput = "h-10 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:bg-transparent";
const cellBorder = "border-r border-dashed border-border";
const headCell = "px-2.5 py-2.5";

function getInitialValues(module: ModuleDefinition, record: BookkeepingRecord | null, defaults: Record<string, string>, customers: BookkeepingRecord[]) {
  const values: Record<string, string> = {
    ...Object.fromEntries(module.fields.map((field) => [
      field.key,
      record?.data[field.key] ?? defaults[field.key] ?? (field.type === "checkbox" ? "false" : ""),
    ])),
    customerId: record?.data.customerId ?? "",
  };
  if (module.kind === "employees") values.currency = record?.data.currency || defaults.currency || "";
  if (module.kind === "vendors") {
    // Older suppliers kept a separate display name; the form's Display name field edits `name`.
    values.name = record?.data.displayName || record?.data.name || record?.data.company || values.name;
  }
  if (module.kind === "invoices") {
    values.docType = record?.data.docType ?? defaults.docType ?? "";
    values.paymentTerms = record?.data.paymentTerms || defaults.paymentTerms || "30 days";
    values.dueDate = dueDateForTerms(values.issueDate, values.paymentTerms) || values.dueDate;
    const customer = customers.find((option) => option.id === values.customerId)
      ?? customers.find((option) => option.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase());
    if (customer) {
      values.billingAddress = values.billingAddress?.trim() || formatCustomerAddress(customer.data);
      values.shippingAddress = values.shippingAddress?.trim() || formatCustomerAddress(customer.data, "shipping");
    }
  }
  if (module.kind === "expenses") values.docType = record?.data.docType ?? defaults.docType ?? "";
  if (module.kind === "invoices" || module.kind === "bills") {
    values.paymentMethod = record?.data.paymentAccountId || record?.data.paymentMethod || (values.docType === "Sales receipt" ? "" : "Credit");
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
      ...(line.bundleId ? { bundleId: line.bundleId, bundleName: line.bundleName, bundleShow: line.bundleShow } : {}),
    };
  });

  return parsedLines.length ? parsedLines : [{ id: "new-line", itemId: "", name: "", description: "", quantity: "", rate: "" }];
}

function serializeInvoiceLines(lines: InvoiceLine[]): string {
  return JSON.stringify(lines
    .filter((line) => line.itemId || line.name.trim() || line.description.trim() || line.quantity.trim() || line.rate.trim())
    .map((line) => ({ ...line, name: line.name.trim(), description: line.description.trim() })));
}

function readExpenseEditorLines(record: BookkeepingRecord | null): ExpenseEntryLine[] {
  // Item lines are edited under Item details; the rest are categories.
  const parsed = parseInvoiceLines(record?.data.lineItems ?? "");
  const savedLines = parsed.some((line) => line.itemId)
    ? parsed.filter((line) => !line.itemId).map((line) => ({ category: line.name, description: line.description, amount: (Number(line.quantity) || 0) * (Number(line.rate) || 0) }))
    : record ? expenseLinesFromData(record.data) : [];
  if (!savedLines.length && parsed.some((line) => line.itemId)) return [];
  return savedLines.length
    ? savedLines.map((line, index) => ({
        id: `saved-expense-${index}`,
        category: line.category,
        description: line.description,
        amount: line.amount ? String(line.amount) : "",
      }))
    : [{ id: "new-expense-line", category: "", description: "", amount: "" }];
}

function serializeExpenseEditorLines(lines: ExpenseEntryLine[], itemLines: PurchaseItemLine[] = []): string {
  return JSON.stringify([
    ...lines
      // With item lines, a category line left without an amount (e.g. the supplier's default category) is ignored.
      .filter((line) => (itemLines.some((item) => item.itemId) ? line.amount.trim() || line.description.trim() : line.category.trim() || line.description.trim() || line.amount.trim()))
      .map((line) => ({
        itemId: "",
        name: line.category.trim(),
        description: line.description.trim(),
        quantity: "1",
        rate: line.amount.trim(),
      })),
    ...itemLines
      .filter((line) => line.itemId)
      .map((line) => ({ itemId: line.itemId, name: line.name.trim(), description: line.description.trim(), quantity: line.quantity.trim() || "1", rate: line.rate.trim() })),
  ]);
}

function catalogItemLabel(item: BookkeepingRecord, currency: string): string {
  const itemName = item.data.name?.trim() ?? "";
  const itemType = item.data.itemType || "Item";
  const rate = Number(item.data.rate) || 0;
  const unit = item.data.unit?.trim();
  return `${itemName} · ${itemType} · ${currencyAmount(rate, currency)}${unit ? ` / ${unit}` : ""}`;
}

export default function RecordEditor({ module, record, customers, vendors, items, accounts, defaultCurrency, defaults, open, onOpenChange, onSaved, onSaveComplete }: RecordEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => getInitialValues(module, record, defaults, customers));
  // Tax rates from Taxes (installed by Tax setup), offered on documents with a tax rate field.
  const [taxes, setTaxes] = useState<BookkeepingRecord[]>([]);
  const defaultTaxRef = useRef<{ rate: string; name: string } | null>(null);
  const hasTaxField = module.fields.some((field) => field.key === "taxRate");
  const taxSide = ["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices"].includes(module.kind) ? "Sales" : "Purchases";
  useEffect(() => {
    if (!open || !hasTaxField) return;
    let cancelled = false;
    listBookkeepingRecords("taxes")
      .then((rows) => {
        if (cancelled) return;
        const enabled = rows.filter((tax) => tax.data.enabled !== "false");
        setTaxes(enabled);
        // A new document starts on the business's default rate for its side.
        const fallback = record ? undefined : enabled.find((tax) => tax.data.isDefault === "true" && (tax.data.appliesTo || "Both") !== (taxSide === "Sales" ? "Purchases" : "Sales"));
        defaultTaxRef.current = fallback ? { rate: fallback.data.rate, name: fallback.data.name } : null;
        if (fallback) setValues((current) => (current.taxRate || current.taxName ? current : { ...current, taxRate: fallback.data.rate, taxName: fallback.data.name }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, hasTaxField, record, taxSide]);
  const taxOptions = taxes.filter((tax) => tax.data.type !== "Withholding" && (tax.data.appliesTo || "Both") !== (taxSide === "Sales" ? "Purchases" : "Sales"));
  const [customTax, setCustomTax] = useState(false);
  const [recurringPayload, setRecurringPayload] = useState<Record<string, string> | null>(null);

  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>(() => readInvoiceLines(record?.data.lineItems ?? "", items));
  const [expenseLines, setExpenseLines] = useState<ExpenseEntryLine[]>(() => readExpenseEditorLines(record));
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemLine[]>(() => readPurchaseItemLines(record));
  const availableItems = items.filter((item) => item.data.name?.trim());
  const visibleFields = module.kind === "items" ? module.fields.filter((field) => itemFieldVisible(field.key, values.itemType ?? "")) : module.fields;
  const paymentAccounts = accounts.filter((account) => (module.kind === "invoices" ? receivingAccountType(account) : paymentAccountType(account)));
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
  const saveStaySubmitRef = useRef<HTMLButtonElement>(null);
  const sendMethod = useRef("email");
  const sendWindow = useRef<Window | null>(null);

  // A refresh after saving hands down new customer and module objects; only a new record or new defaults reset the form.
  const customersRef = useRef(customers);
  const moduleRef = useRef(module);
  useEffect(() => {
    customersRef.current = customers;
    moduleRef.current = module;
  }, [customers, module]);

  useEffect(() => {
    const initial = getInitialValues(moduleRef.current, record, defaults, customersRef.current);
    const defaultTax = defaultTaxRef.current;
    setValues(!record && defaultTax && !initial.taxRate && !initial.taxName ? { ...initial, taxRate: defaultTax.rate, taxName: defaultTax.name } : initial);
    setInvoiceLines(readInvoiceLines(record?.data.lineItems ?? "", itemsRef.current));
    setExpenseLines(readExpenseEditorLines(record));
    setPurchaseItems(readPurchaseItemLines(record));
    setSavedRecordId(record?.id ?? null);
    setError("");
    setNotice("");
    setShareLink("");
    sendMethod.current = "email";
    sendWindow.current = null;
  }, [defaults, record]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function changeValue(key: string, value: string) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (module.kind === "invoices" && (key === "issueDate" || key === "paymentTerms")) {
        next.dueDate = dueDateForTerms(next.issueDate ?? "", next.paymentTerms ?? "30 days");
      }
      if (module.kind === "bills" && (key === "billDate" || key === "paymentTerms") && next.paymentTerms) {
        next.dueDate = dueDateForTerms(next.billDate ?? "", next.paymentTerms) || next.dueDate;
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
      setError(shareError instanceof Error ? readableError(shareError) : `We couldn’t create the ${module.label.toLowerCase()} link.`);
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
      setError(uploadError instanceof Error ? readableError(uploadError) : "The upload didn’t finish. Please try again.");
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

  /** The fields a save sends, also used as the pattern for "Make recurring". */
  function buildRecordValues(serializedDocumentLines: string, serializedExpenseLines: string): Record<string, string> {
    const selectedCustomer = shareableDocumentKinds.has(module.kind)
      ? customerOptions.find((customer) => customer.id === values.customerId || customer.id === values.customer)
        ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase())
      : undefined;
    const normalizedValues = selectedCustomer?.data.name
      ? { ...values, customer: selectedCustomer.data.name, customerId: selectedCustomer.id }
      : values;
    const expenseCategories = [...new Set(expenseLines.map((line) => line.category.trim()).filter(Boolean))];
    const expenseDescription = values.memo?.trim() || expenseLines.map((line) => line.description.trim()).filter(Boolean).join("; ") || expenseCategories.join(", ");
    return module.kind === "vendors"
      ? {
          ...normalizedValues,
          displayName: normalizedValues.name?.trim() || normalizedValues.company?.trim() || "",
        }
      : categoryLineKinds.has(module.kind)
      ? {
          ...normalizedValues,
          category: expenseCategories.length > 1 ? "Multiple categories" : expenseCategories[0] ?? "",
          description: expenseDescription,
          lineItems: serializedExpenseLines,
        }
      : structuredLineKinds.has(module.kind)
        ? { ...normalizedValues, lineItems: serializedDocumentLines, ...(module.kind === "credit-notes" ? { amount: invoiceTotal.toFixed(2) } : {}) }
        : normalizedValues;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : "save-and-close";
    const shouldSend = shareableDocumentKinds.has(module.kind) && intent === "save-and-send";
    const serializedDocumentLines = serializeInvoiceLines(invoiceLines);
    const serializedExpenseLines = serializeExpenseEditorLines(expenseLines, purchaseItems);
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
    if (categoryLineKinds.has(module.kind)) {
      const hasItemLines = purchaseItems.some((line) => line.itemId);
      const enteredLines = expenseLines.filter((line) => (hasItemLines ? line.amount.trim() || line.description.trim() : line.category.trim() || line.description.trim() || line.amount.trim()));
      const invalidLine = enteredLines.findIndex((line) => !line.category.trim() || !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0);
      const enteredItems = purchaseItems.filter((line) => line.itemId || line.quantity.trim() || line.rate.trim());
      const invalidItem = enteredItems.findIndex((line) => !line.itemId || !(Number(line.quantity) > 0) || !(Number(line.rate) > 0));
      if (invalidItem !== -1) {
        closePreparedMessage();
        setError(`Check item line ${invalidItem + 1}: choose a product or service and enter a quantity and a rate greater than zero.`);
        return;
      }
      if ((!enteredLines.length && !enteredItems.length) || invalidLine !== -1) {
        closePreparedMessage();
        setError(invalidLine !== -1 ? `Check line ${invalidLine + 1}: choose a category and enter an amount greater than zero.` : "Add at least one expense line with a category and amount.");
        return;
      }
    }
    if (isCheck && !record && !savedRecordId && !values.payNowAccountId) {
      setError("Choose the bank account this check is drawn on.");
      return;
    }
    if (isCardCredit && !record && !savedRecordId && !values.payNowAccountId) {
      setError("Choose the credit card the refund went to.");
      return;
    }
    if (isSalesReceipt && !record && (!values.paymentMethod || values.paymentMethod === "Credit")) {
      setError("Choose the account this sales receipt was deposited to.");
      return;
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
      const recordValues = buildRecordValues(serializedDocumentLines, serializedExpenseLines);
      const { payNowAccountId, ...valuesToSave } = recordValues as Record<string, string>;
      const firstSave = !savedRecordId;
      let saved = await saveBookkeepingRecord(module.kind, record ? { ...record.data, ...valuesToSave } : valuesToSave, savedRecordId ?? undefined);
      if (module.kind === "expenses" && firstSave && payNowAccountId) {
        // Like a QuickBooks expense: paid from the chosen account on the expense date.
        await recordExpensePayment(saved.id, saved.data.expenseDate || new Date().toISOString().slice(0, 10), payNowAccountId);
        saved = { ...saved, data: { ...saved.data, status: "Paid", paidAmount: saved.data.amount ?? "0", paymentAccountId: payNowAccountId } };
      }
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
          setError(`${module.label} saved, but it couldn’t be sent: ${sendError instanceof Error ? readableError(sendError) : "Please try again."}`);
          return;
        }
      }
      // The full-page form keeps its save buttons at the bottom right, so its messages show at the top.
      toast.success(shouldSend ? `${documentLabel} saved and emailed to the customer.` : `${documentLabel} ${record ? "updated" : "saved"}.`, isTransactionForm ? { position: "top-center" } : undefined);
      if (intent === "save-and-new" || intent === "save-and-copy") {
        await onSaveComplete(saved, intent);
      } else if (intent === "save") {
        // "Save" keeps the transaction open, as in QuickBooks.
      } else {
        onOpenChange(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t save this record. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const subtotal = invoiceSubtotal(invoiceLines);
  const taxAmount = subtotal * (Math.max(0, Number(values.taxRate) || 0) / 100);
  const discount = Math.max(0, Number(values.discount) || 0);
  const invoiceTotal = Math.max(0, subtotal + taxAmount - discount);
  const expenseTotal = expenseLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    + purchaseItems.reduce((sum, line) => sum + (line.itemId ? (Number(line.quantity) || 0) * (Number(line.rate) || 0) : 0), 0);
  const expenseTaxAmount = expenseTotal * (Math.max(0, Number(values.taxRate) || 0) / 100);
  const expenseGrandTotal = Math.max(0, expenseTotal + expenseTaxAmount - discount);
  const linesCurrency = values.currency || defaultCurrency || "USD";
  const hasStructuredLines = structuredLineKinds.has(module.kind);
  const isTransactionForm = hasStructuredLines || categoryLineKinds.has(module.kind);
  const isSalesReceipt = module.kind === "invoices" && values.docType === "Sales receipt";
  const isCheck = module.kind === "expenses" && values.docType === "Check";
  const isCardCredit = module.kind === "expenses" && values.docType === "Credit card credit";
  const documentLabel = isSalesReceipt ? "Sales receipt" : isCheck ? "Check" : module.label;
  const customerOptions = customers.filter((customer) => customer.data.name?.trim());
  const expenseAccounts = accounts.filter((account) =>
    account.data.locked !== "true" && accountCategoryForType(account.data.accountType ?? "") === "Expense",
  );
  const expenseCategories = accounts.filter((account) =>
    account.data.type === "Expense" && account.data.locked !== "true" && account.data.name?.trim(),
  );
  const selectedCustomer = customerOptions.find((customer) => customer.id === values.customerId)
    ?? customerOptions.find((customer) => customer.data.name?.trim().toLowerCase() === values.customer?.trim().toLowerCase())
    ?? customerOptions.find((customer) => customer.id === values.customer);
  const vendorOptions = vendors.filter((vendor) => vendor.data.name?.trim());

  function fieldBlock(field: FormField, className = "") {
    const value = values[field.key] ?? "";
    return (
      <div key={field.key} className={`min-w-0 space-y-2 ${className}`}>
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
            id={(hasStructuredLines || categoryLineKinds.has(module.kind)) && field.key === "lineItems" ? `${module.kind}-line-items-label` : undefined}
            htmlFor={`field-${field.key}`}
          >
            {field.label}{field.required ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
        )}

        {module.kind === "items" && itemAccountKeys.has(field.key) ? (() => {
          const options = accounts.filter((account) => account.data.name?.trim() && (field.key === "incomeAccountId" ? account.data.type === "Income" : field.key === "expenseAccountId" ? account.data.type === "Expense" : account.data.type === "Asset" && !["Cash and cash equivalents", "Accounts receivable (A/R)"].includes(account.data.accountType ?? "")));
          return (
            <Select value={value || "default"} onValueChange={(nextValue) => changeValue(field.key, nextValue === "default" ? "" : nextValue ?? "")}>
              <SelectTrigger id={`field-${field.key}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{field.key === "incomeAccountId" ? "Default (Sales)" : field.key === "expenseAccountId" ? "Default (Cost of goods sold)" : "Default (Inventory)"}</SelectItem>
                {options.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.code ? `${account.data.code} · ` : ""}{account.data.name}</SelectItem>)}
                {value && !options.some((account) => account.id === value) ? <SelectItem value={value}>Previously saved account</SelectItem> : null}
              </SelectContent>
            </Select>
          );
        })() : null}

        {module.kind === "items" && field.key === "bundleItems" ? (() => {
          const parts = readBundleParts(value);
          const rows = parts.length ? parts : [{ itemId: "", quantity: "1" }];
          const choices = availableItems.filter((item) => item.data.itemType !== "Bundle" && item.id !== record?.id);
          const setParts = (next: BundlePart[]) => changeValue("bundleItems", JSON.stringify(next));
          const price = rows.reduce((sum, part) => sum + (Number(choices.find((item) => item.id === part.itemId)?.data.rate) || 0) * (Number(part.quantity) || 0), 0);
          return (
            <div className="space-y-2 rounded-lg border border-border p-3" role="group" aria-label="Bundle products and services">
              {rows.map((part, partIndex) => (
                <div key={partIndex} className="grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`bundle-item-${partIndex}`} className="text-xs text-muted-foreground">Product/service</Label>
                    <Select value={part.itemId || null} onValueChange={(nextValue) => setParts(rows.map((entry, i) => (i === partIndex ? { ...entry, itemId: nextValue ?? "" } : entry)))}>
                      <SelectTrigger id={`bundle-item-${partIndex}`} className="w-full"><SelectValue placeholder="Choose product or service">{choices.find((item) => item.id === part.itemId)?.data.name}</SelectValue></SelectTrigger>
                      <SelectContent>{choices.map((item) => <SelectItem key={item.id} value={item.id}>{item.data.name} <span className="text-xs text-muted-foreground">· {currencyAmount(Number(item.data.rate) || 0, defaultCurrency || "USD")}</span></SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`bundle-qty-${partIndex}`} className="text-xs text-muted-foreground">Qty</Label>
                    <Input id={`bundle-qty-${partIndex}`} type="number" min="0.001" step="any" value={part.quantity} onChange={(event) => setParts(rows.map((entry, i) => (i === partIndex ? { ...entry, quantity: event.target.value } : entry)))} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove bundle line ${partIndex + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => setParts(rows.filter((_, i) => i !== partIndex))}><Trash2 size={16} /></Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" disabled={!choices.length} onClick={() => setParts([...rows, { itemId: "", quantity: "1" }])}><Plus size={15} />Add product/service</Button>
                <span className="text-sm text-muted-foreground">Bundle price: <span className="font-medium text-foreground tabular-nums">{currencyAmount(price, defaultCurrency || "USD")}</span></span>
              </div>
              <p className="text-xs text-muted-foreground">On an invoice the bundle adds these lines; each keeps its own stock and income account. Prices can be changed on the invoice.</p>
            </div>
          );
        })() : null}

        {field.type === "textarea" && field.key !== "bundleItems" && !(hasStructuredLines && field.key === "lineItems") && !(categoryLineKinds.has(module.kind) && field.key === "lineItems") ? (
          <Textarea
            id={`field-${field.key}`}
            value={value}
            onChange={(event) => changeValue(field.key, event.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            rows={field.key === "lineItems" ? 4 : 3}
          />
        ) : null}


        {field.key === "customer" ? (
          <>
            <Select
              value={selectedCustomer?.id ?? null}
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
                  setValues((current) => ({
                    ...current,
                    customer: customer.data.name,
                    customerId: customer.id,
                    ...(module.kind === "invoices" ? {
                      billingAddress: formatCustomerAddress(customer.data),
                      shippingAddress: formatCustomerAddress(customer.data, "shipping"),
                    } : {}),
                  }));
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
              value={vendorOptions.find((vendor) => vendor.data.name === value)?.id ?? null}
              onValueChange={(vendorId) => {
                const vendor = vendorOptions.find((option) => option.id === vendorId);
                if (vendor?.data.name) {
                  changeValue(field.key, vendor.data.name);
                  if ((module.kind === "bills" || module.kind === "supplier-credits") && vendor.data.defaultExpenseAccount) {
                    const expenseAccount = expenseAccounts.find((account) => account.id === vendor.data.defaultExpenseAccount);
                    const categoryName = expenseAccount?.data.name?.trim();
                    if (categoryName) {
                      // Prefill the first empty bill line with the supplier's default category.
                      setExpenseLines((current) => {
                        const target = current.findIndex((line) => !line.category.trim());
                        if (target === -1) return current;
                        return current.map((line, index) => index === target ? { ...line, category: categoryName } : line);
                      });
                    }
                  }
                }
              }}
            >
              <SelectTrigger id={`field-${field.key}`} className="w-full" aria-required={field.required}>
                <SelectValue placeholder={vendorOptions.length ? "Choose a supplier" : "Add a supplier first"} />
              </SelectTrigger>
              <SelectContent>
                {vendorOptions.map((vendor) => {
                  const name = vendor.data.displayName?.trim() || vendor.data.name.trim();
                  const detail = [vendor.data.company?.trim(), vendor.data.email?.trim()].find((value) => value && value !== name);
                  return <SelectItem value={vendor.id} key={vendor.id}>{detail ? `${name} · ${detail}` : name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            {!vendorOptions.length ? <p className="text-xs leading-5 text-muted-foreground">Add a supplier in Suppliers before creating this record.</p> : null}
          </>
        ) : null}

        {field.key === "defaultExpenseAccount" && module.kind === "vendors" ? (
          <Select value={value || "none"} onValueChange={(nextValue) => changeValue(field.key, nextValue === "none" ? "" : nextValue ?? "")}>
            <SelectTrigger id={`field-${field.key}`} className="w-full">
              <SelectValue placeholder="Choose an expense category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No default</SelectItem>
              {expenseAccounts.map((account) => <SelectItem value={account.id} key={account.id}>{account.data.name || "Unnamed account"}</SelectItem>)}
              {value && !expenseAccounts.some((account) => account.id === value) ? <SelectItem value={value}>{value} · previously saved</SelectItem> : null}
            </SelectContent>
          </Select>
        ) : null}


        {field.type === "select" && field.key === "paymentMethod" && (module.kind === "invoices" || module.kind === "bills") ? (
          <>
            <Select value={value || (isSalesReceipt ? null : "Credit")} onValueChange={(nextValue) => changeValue(field.key, nextValue ?? "Credit")}>
              <SelectTrigger id={`field-${field.key}`} className="w-full" disabled={Boolean(record)}>
                <SelectValue placeholder="Choose a payment account" />
              </SelectTrigger>
              <SelectContent>
                {isSalesReceipt ? null : <SelectItem value="Credit">Credit · unpaid</SelectItem>}
                {paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
                {record && !record.data.paymentAccountId && value !== "Credit" ? (
                  <SelectItem value={value}>{value} · previously saved</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {!paymentAccounts.length && !record ? <NoAccountsNotice message="To record this as paid, add a Cash, Bank or Credit card account. Otherwise it stays unpaid on credit." /> : null}
            {!record && !isSalesReceipt && value && value !== "Credit" ? (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="field-amountPaid">{module.kind === "invoices" ? "Amount received" : "Amount paid"}</Label>
                <Input id="field-amountPaid" type="number" min="0.01" step="0.01" inputMode="decimal" value={values.amountPaid ?? ""} placeholder="Full amount" onChange={(event) => changeValue("amountPaid", event.target.value)} />
                <p className="text-xs text-muted-foreground">Leave empty for the full amount, or enter part of it; the rest stays open.</p>
              </div>
            ) : null}
          </>
        ) : null}

        {module.kind === "employees" && field.key === "paymentAccountId" ? (
          <>
            <Select value={value || null} onValueChange={(nextValue) => changeValue(field.key, nextValue ?? "")}>
              <SelectTrigger id={`field-${field.key}`} className="w-full">
                <SelectValue placeholder={paymentAccounts.length ? "Choose a Cash, Bank, or Credit card account" : "Add an account in Chart of Accounts first"} />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        ) : null}

        {field.type === "select" && field.key !== "defaultExpenseAccount" && !(module.kind === "items" && itemAccountKeys.has(field.key)) && !(module.kind === "employees" && field.key === "paymentAccountId") && !(field.key === "paymentMethod" && (module.kind === "invoices" || module.kind === "bills")) ? (
          <Select value={value || null} onValueChange={(nextValue) => changeValue(field.key, nextValue ?? "")}>
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

        {field.key === "taxRate" && taxOptions.length ? (
          <Select
            value={customTax ? "custom" : taxOptions.find((tax) => tax.data.name === values.taxName)?.id ?? (values.taxRate && Number(values.taxRate) !== 0 ? taxOptions.find((tax) => Number(tax.data.rate) === Number(values.taxRate))?.id ?? "custom" : "none")}
            onValueChange={(next) => {
              if (next === "custom") { setCustomTax(true); return; }
              setCustomTax(false);
              const tax = taxOptions.find((item) => item.id === next);
              setValues((current) => ({ ...current, taxRate: tax ? tax.data.rate : "", taxName: tax ? tax.data.name : "" }));
            }}
          >
            <SelectTrigger id={`field-${field.key}-select`} className="w-full" aria-label="Tax"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No tax</SelectItem>
              {taxOptions.map((tax) => <SelectItem key={tax.id} value={tax.id}>{tax.data.name} · {tax.data.rate}%</SelectItem>)}
              <SelectItem value="custom">Custom rate…</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {field.key !== "customer" && field.key !== "vendor" && !(field.key === "taxRate" && taxOptions.length && !customTax) && (!field.type || field.type === "text" || field.type === "email" || field.type === "number" || field.type === "date") ? (
          <Input
            id={`field-${field.key}`}
            type={field.type ?? "text"}
            value={module.kind === "credit-notes" && field.key === "amount" ? invoiceTotal.toFixed(2) : value}
            list={module.kind === "expenses" && field.key === "payee" ? "expense-payees" : undefined}
            onChange={(event) => { if (field.key === "taxRate") setValues((current) => ({ ...current, taxName: "" })); changeValue(field.key, event.target.value); }}
            placeholder={field.placeholder}
            required={field.required}
            min={field.type === "number" ? "0" : undefined}
            step={field.type === "number" ? "any" : undefined}
            readOnly={(module.kind === "invoices" && field.key === "dueDate") || (module.kind === "credit-notes" && field.key === "amount")}
          />
        ) : null}
        {module.kind === "expenses" && field.key === "payee" ? <datalist id="expense-payees">{vendorOptions.map((vendor) => <option value={vendor.data.name} key={vendor.id} />)}</datalist> : null}

        {field.help && field.type !== "file" && field.type !== "checkbox" && !(field.key === "paymentMethod" && !paymentAccounts.length && !record) && !(hasStructuredLines && field.key === "lineItems") && !(categoryLineKinds.has(module.kind) && field.key === "lineItems") ? <p className="text-xs leading-5 text-muted-foreground">{field.help}</p> : null}
      </div>
    );
  }

  // QuickBooks price rules: a customer's price rule raises or lowers each sales price picked for them.
  function priceFor(rate: string | undefined) {
    const base = Number(rate) || 0;
    if (!["invoices", "estimates", "sales-orders", "credit-notes", "recurring-invoices"].includes(module.kind)) return rate ?? "0";
    const customer = customers.find((option) => option.id === values.customerId) ?? customers.find((option) => (option.data.name ?? "").trim().toLowerCase() === (values.customer ?? "").trim().toLowerCase());
    const adjustment = Number(customer?.data.priceAdjustment) || 0;
    return adjustment ? (Math.round(base * (1 + adjustment / 100) * 100) / 100).toFixed(2) : rate ?? "0";
  }

  function chooseLineItem(lineId: string, itemId: string) {
    const item = availableItems.find((option) => option.id === itemId);
    if (!item) return;
    if (item.data.itemType === "Bundle") {
      // Like QuickBooks, a bundle brings in its products and services as lines of their own.
      const parts = readBundleParts(item.data.bundleItems ?? "").flatMap((part, partIndex) => {
        const component = availableItems.find((option) => option.id === part.itemId);
        return component ? [{ id: `${lineId}-b${Date.now()}-${partIndex}`, itemId: component.id, name: component.data.name?.trim() ?? "", description: component.data.description?.trim() || "", quantity: part.quantity || "1", rate: priceFor(component.data.rate), bundleId: item.id, bundleName: item.data.name?.trim() ?? "Bundle", bundleShow: item.data.showComponents === "false" ? "false" : "true" }] : [];
      });
      if (parts.length) setInvoiceLines((current) => current.flatMap((currentLine) => (currentLine.id === lineId ? parts : [currentLine])));
      return;
    }
    setInvoiceLines((current) => current.map((currentLine) => currentLine.id === lineId
      ? { ...currentLine, itemId: item.id, name: item.data.name?.trim() ?? "", description: currentLine.description || item.data.description?.trim() || "", quantity: currentLine.quantity || "1", rate: priceFor(item.data.rate) }
      : currentLine));
  }

  const updateInvoiceLine = (lineId: string, patch: Partial<InvoiceLine>) => setInvoiceLines((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  const updateExpenseLine = (lineId: string, patch: Partial<ExpenseEntryLine>) => setExpenseLines((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  const updatePurchaseItem = (lineId: string, patch: Partial<PurchaseItemLine>) => setPurchaseItems((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  const blankInvoiceLine = (): InvoiceLine => ({ id: crypto.randomUUID(), itemId: "", name: "", description: "", quantity: "", rate: "" });
  const blankExpenseLine = (): ExpenseEntryLine => ({ id: crypto.randomUUID(), category: "", description: "", amount: "" });
  const lineTableClass = "w-full min-w-[860px] border-collapse text-sm";
  const lineHeadRow = "border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide text-foreground";

  if (isTransactionForm) {
    const moneyCurrency = hasStructuredLines ? values.currency || defaultCurrency || "USD" : linesCurrency;
    const documentTotal = hasStructuredLines ? invoiceTotal : expenseGrandTotal;
    const documentSubtotal = hasStructuredLines ? subtotal : expenseTotal;
    const documentTax = hasStructuredLines ? taxAmount : expenseTaxAmount;
    const paidBefore = Number(record?.data.paidAmount) || 0;
    const paidNow = !record && values.paymentMethod && values.paymentMethod !== "Credit" ? (Number(values.amountPaid) || documentTotal) : 0;
    const tracksBalance = (module.kind === "invoices" && !isSalesReceipt) || module.kind === "bills";
    const paid = Math.min(documentTotal, paidBefore + paidNow);
    const headline = tracksBalance
      ? { label: "Balance due", amount: Math.max(0, documentTotal - paid) }
      : { label: module.kind === "credit-notes" || module.kind === "supplier-credits" ? "Total credit" : "Amount", amount: documentTotal };
    const fieldsShown = visibleFields.filter((field) => field.key !== "lineItems" && !(module.kind === "credit-notes" && field.key === "amount"));
    const partyFields = fieldsShown.filter((field) => partyKeys.has(field.key));
    const rank = (key: string, index: number) => (headerOrder.includes(key) ? headerOrder.indexOf(key) : 100 + index);
    const headerFields = fieldsShown
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => !partyKeys.has(field.key) && !footnoteKeys.has(field.key) && !totalKeys.has(field.key))
      .sort((left, right) => rank(left.field.key, left.index) - rank(right.field.key, right.index))
      .map(({ field }) => field);
    const footnoteFields = fieldsShown.filter((field) => footnoteKeys.has(field.key));
    const taxField = fieldsShown.find((field) => field.key === "taxRate");
    const discountField = fieldsShown.find((field) => field.key === "discount");
    const titleValue = module.kind === "expenses" ? values.referenceNumber : values[module.titleKey];
    const busy = pending || Boolean(uploading);
    const footerGhost = "text-sidebar-foreground hover:bg-white/10 hover:text-white";
    const hasItemLines = purchaseItems.length > 0;
    const canRepeat = ["invoices", "bills", "expenses"].includes(module.kind) && !isSalesReceipt;
    const startRecurring = () => {
      if (!(documentTotal > 0)) {
        setError(`Add the ${module.label.toLowerCase()}'s lines before making it recurring.`);
        return;
      }
      if (partyFields.some((field) => field.required && !values[field.key]?.trim())) {
        setError(`Choose the ${partyFields[0]?.label.toLowerCase() ?? "contact"} before making it recurring.`);
        return;
      }
      setError("");
      setRecurringPayload(buildRecordValues(serializeInvoiceLines(invoiceLines), serializeExpenseEditorLines(expenseLines, purchaseItems)));
    };

    const productTable = hasStructuredLines ? (
      <section className="rounded-xl border border-border bg-card" aria-labelledby={`${module.kind}-line-items-label`}>
        <h3 id={`${module.kind}-line-items-label`} className="px-5 pb-3 pt-4 text-base font-semibold">Product or service</h3>
        <div className="overflow-x-auto border-y border-border">
          <table className={lineTableClass}>
            <thead>
              <tr className={lineHeadRow}>
                <th className={`w-10 py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                <th className={`min-w-60 text-left ${headCell} ${cellBorder}`}>Product/service</th>
                <th className={`min-w-64 text-left ${headCell} ${cellBorder}`}>Description</th>
                <th className={`w-24 text-right ${headCell} ${cellBorder}`}>Qty</th>
                <th className={`w-32 text-right ${headCell} ${cellBorder}`}>Rate</th>
                <th className={`w-36 text-right ${headCell} ${cellBorder}`}>Amount</th>
                <th className="w-12"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {invoiceLines.map((line, index) => {
                const picked = availableItems.find((item) => item.id === line.itemId);
                const onHand = picked && isInventoryItem(picked) && picked.data.qtyOnHand !== undefined ? Number(picked.data.qtyOnHand) || 0 : null;
                // Like QuickBooks, selling more than is on hand is allowed but flagged.
                const short = ["invoices", "sales-orders"].includes(module.kind) && onHand !== null && Number(line.quantity) > onHand;
                return (
                  <tr key={line.id} className="group border-b border-border align-top transition-colors hover:bg-muted/30">
                    <td className={`py-2.5 pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Select value={line.itemId || null} onValueChange={(itemId) => chooseLineItem(line.id, itemId ?? "")}>
                        <SelectTrigger id={`invoice-item-${line.id}`} aria-label={`Product or service for line ${index + 1}`} className={`${cellInput} !h-10 justify-between`} disabled={!availableItems.length}>
                          <SelectValue placeholder={availableItems.length ? "Choose item or service" : "Add an item or service first"}>{picked?.data.name?.trim() || line.name || undefined}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-72">
                          {availableItems.filter((item) => module.kind !== "purchase-orders" || item.data.itemType !== "Bundle").map((item) => (
                            <SelectItem value={item.id} key={item.id}>
                              {catalogItemLabel(item, values.currency || "USD")}
                              {isInventoryItem(item) && item.data.qtyOnHand !== undefined ? <span className="ml-1 text-xs text-muted-foreground">· {Number(item.data.qtyOnHand).toLocaleString()} on hand</span> : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {line.bundleId ? <p className="px-2.5 pb-2 text-xs text-primary">Part of bundle: {line.bundleName}</p> : null}
                      {short ? <p className="px-2.5 pb-2 text-xs text-amber-700 dark:text-amber-400">Only {onHand?.toLocaleString()} on hand. You can still save; stock will show below zero until you receive more.</p> : null}
                    </td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Input id={`invoice-description-${line.id}`} aria-label={`Description for line ${index + 1}`} value={line.description} onChange={(event) => updateInvoiceLine(line.id, { description: event.target.value })} className={cellInput} />
                    </td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Input id={`invoice-quantity-${line.id}`} aria-label={`Quantity for line ${index + 1}`} type="number" min="0.01" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => updateInvoiceLine(line.id, { quantity: event.target.value })} className={`${cellInput} text-right tabular-nums`} />
                    </td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Input id={`invoice-rate-${line.id}`} aria-label={`Rate for line ${index + 1}`} type="number" min="0" step="any" inputMode="decimal" value={line.rate} onChange={(event) => updateInvoiceLine(line.id, { rate: event.target.value })} className={`${cellInput} text-right tabular-nums`} />
                    </td>
                    <td className={`px-2.5 py-2.5 text-right font-medium tabular-nums ${cellBorder}`}>{currencyAmount((Number(line.quantity) || 0) * (Number(line.rate) || 0), moneyCurrency)}</td>
                    <td className="px-1 py-1 text-center">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => setInvoiceLines((current) => current.filter((entry) => entry.id !== line.id))}><Trash2 size={14} /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setInvoiceLines((current) => [...current, blankInvoiceLine()])}><Plus size={14} />Add product or service</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setInvoiceLines([blankInvoiceLine()])}>Clear all lines</Button>
        </div>
        {!availableItems.length ? <p className="px-5 pb-4 text-xs leading-5 text-muted-foreground">No saved items or services yet. Add them in <Link href="/app/items" className="font-medium text-primary underline underline-offset-4">Items &amp; services</Link>, then reopen this document.</p> : null}
      </section>
    ) : null;

    const categoryTable = categoryLineKinds.has(module.kind) ? (
      <section className="rounded-xl border border-border bg-card" aria-labelledby={`${module.kind}-line-items-label`}>
        <h3 id={`${module.kind}-line-items-label`} className="px-5 pb-3 pt-4 text-base font-semibold">Category details</h3>
        <div className="overflow-x-auto border-y border-border">
          <table className={lineTableClass}>
            <thead>
              <tr className={lineHeadRow}>
                <th className={`w-10 py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                <th className={`min-w-60 text-left ${headCell} ${cellBorder}`}>Category</th>
                <th className={`min-w-72 text-left ${headCell} ${cellBorder}`}>Description</th>
                <th className={`w-40 text-right ${headCell} ${cellBorder}`}>Amount</th>
                <th className="w-12"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {expenseLines.map((line, index) => {
                const selectedAccount = expenseCategories.find((account) => account.data.name === line.category);
                const selectedValue = selectedAccount?.id ?? (line.category ? `saved-${line.id}` : "none");
                return (
                  <tr key={line.id} className="group border-b border-border transition-colors hover:bg-muted/30">
                    <td className={`py-2.5 pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Select value={selectedValue} onValueChange={(nextValue) => updateExpenseLine(line.id, { category: expenseCategories.find((option) => option.id === nextValue)?.data.name?.trim() ?? "" })}>
                        <SelectTrigger id={`expense-category-${line.id}`} aria-label={`Category for line ${index + 1}`} className={`${cellInput} !h-10 justify-between`}>
                          <SelectValue placeholder="Choose category" />
                        </SelectTrigger>
                        <SelectContent className="min-w-64">
                          <SelectItem value="none">Choose category</SelectItem>
                          {expenseCategories.map((account) => <SelectItem value={account.id} key={account.id}>{account.data.name}</SelectItem>)}
                          {line.category && !selectedAccount ? <SelectItem value={`saved-${line.id}`}>{line.category} · previously saved</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Input id={`expense-description-${line.id}`} aria-label={`Description for line ${index + 1}`} value={line.description} onChange={(event) => updateExpenseLine(line.id, { description: event.target.value })} placeholder={module.kind === "bills" ? "What was this bill for?" : module.kind === "supplier-credits" ? "What is this credit for?" : "What was this expense for?"} className={cellInput} />
                    </td>
                    <td className={`p-0 ${cellBorder}`}>
                      <Input id={`expense-amount-${line.id}`} aria-label={`Amount for line ${index + 1}`} type="number" min="0.01" step="any" inputMode="decimal" value={line.amount} onChange={(event) => updateExpenseLine(line.id, { amount: event.target.value })} className={`${cellInput} text-right tabular-nums`} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove expense line ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => setExpenseLines((current) => current.filter((entry) => entry.id !== line.id))}><Trash2 size={14} /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setExpenseLines((current) => [...current, blankExpenseLine()])}><Plus size={14} />Add lines</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setExpenseLines([blankExpenseLine()])}>Clear all lines</Button>
        </div>
        {!expenseCategories.length ? <div className="px-5 pb-4"><NoAccountsNotice message="You need Expense accounts in your Chart of accounts to categorize spending." /></div> : null}
      </section>
    ) : null;

    const itemTable = categoryLineKinds.has(module.kind) ? (
      <section className="rounded-xl border border-border bg-card" aria-label="Item details">
        <div className="px-5 pb-3 pt-4">
          <h3 className="text-base font-semibold">Item details</h3>
          <p className="text-xs text-muted-foreground">Products bought for stock go here: inventory items add to quantity on hand at this cost.</p>
        </div>
        {hasItemLines ? (
          <div className="overflow-x-auto border-y border-border">
            <table className={lineTableClass}>
              <thead>
                <tr className={lineHeadRow}>
                  <th className={`w-10 py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                  <th className={`min-w-60 text-left ${headCell} ${cellBorder}`}>Product/service</th>
                  <th className={`min-w-64 text-left ${headCell} ${cellBorder}`}>Description</th>
                  <th className={`w-24 text-right ${headCell} ${cellBorder}`}>Qty</th>
                  <th className={`w-32 text-right ${headCell} ${cellBorder}`}>Rate</th>
                  <th className={`w-36 text-right ${headCell} ${cellBorder}`}>Amount</th>
                  <th className="w-12"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {purchaseItems.map((line, index) => {
                  const picked = availableItems.find((item) => item.id === line.itemId);
                  return (
                    <tr key={line.id} className="group border-b border-border transition-colors hover:bg-muted/30">
                      <td className={`py-2.5 pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Select value={line.itemId || null} onValueChange={(nextValue) => {
                          const item = availableItems.find((option) => option.id === nextValue);
                          updatePurchaseItem(line.id, { itemId: item?.id ?? "", name: item?.data.name?.trim() ?? "", rate: line.rate || item?.data.cost || "", description: line.description || item?.data.description || "" });
                        }}>
                          <SelectTrigger id={`purchase-item-${line.id}`} aria-label={`Product for item line ${index + 1}`} className={`${cellInput} !h-10 justify-between`}><SelectValue placeholder="Choose product">{picked?.data.name ?? (line.name || undefined)}</SelectValue></SelectTrigger>
                          <SelectContent className="min-w-72">
                            {availableItems.filter((item) => item.data.itemType !== "Bundle").map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.data.name}{isInventoryItem(item) ? <span className="ml-1 text-xs text-muted-foreground">· Inventory{item.data.qtyOnHand !== undefined ? ` · ${Number(item.data.qtyOnHand).toLocaleString()} on hand` : ""}</span> : <span className="ml-1 text-xs text-muted-foreground">· {item.data.itemType || "Service"}</span>}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`p-0 ${cellBorder}`}><Input id={`purchase-description-${line.id}`} aria-label={`Description for item line ${index + 1}`} value={line.description} onChange={(event) => updatePurchaseItem(line.id, { description: event.target.value })} className={cellInput} /></td>
                      <td className={`p-0 ${cellBorder}`}><Input id={`purchase-qty-${line.id}`} aria-label={`Quantity for item line ${index + 1}`} type="number" min="0.001" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => updatePurchaseItem(line.id, { quantity: event.target.value })} className={`${cellInput} text-right tabular-nums`} /></td>
                      <td className={`p-0 ${cellBorder}`}><Input id={`purchase-rate-${line.id}`} aria-label={`Rate for item line ${index + 1}`} type="number" min="0.01" step="any" inputMode="decimal" value={line.rate} onChange={(event) => updatePurchaseItem(line.id, { rate: event.target.value })} className={`${cellInput} text-right tabular-nums`} /></td>
                      <td className={`px-2.5 py-2.5 text-right font-medium tabular-nums ${cellBorder}`}>{currencyAmount((Number(line.quantity) || 0) * (Number(line.rate) || 0), linesCurrency)}</td>
                      <td className="px-1 py-1 text-center"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove item line ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => setPurchaseItems((current) => current.filter((entry) => entry.id !== line.id))}><Trash2 size={14} /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={!availableItems.length} onClick={() => setPurchaseItems((current) => [...current, { id: crypto.randomUUID(), itemId: "", name: "", description: "", quantity: "1", rate: "" }])}><Plus size={14} />Add item line</Button>
          {hasItemLines ? <Button type="button" variant="outline" size="sm" onClick={() => setPurchaseItems([])}>Clear all lines</Button> : null}
        </div>
        {!availableItems.length ? <p className="px-5 pb-4 text-xs text-muted-foreground">Add products in Items &amp; services to buy them here.</p> : null}
      </section>
    ) : null;

    const amountRow = (label: string, amount: number, strong = false, negative = false) => (
      <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-border pt-3 text-base font-semibold" : ""}`}>
        <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
        <span className="tabular-nums">{negative ? "−" : ""}{currencyAmount(amount, moneyCurrency)}</span>
      </div>
    );

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl font-semibold">
                {record ? documentLabel : `New ${documentLabel.toLowerCase()}`}{titleValue ? <span className="ml-2 font-normal text-muted-foreground">no. {titleValue}</span> : null}
              </DialogTitle>
              <DialogDescription className="sr-only">{module.description}</DialogDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}><X size={20} /></Button>
          </header>

          <form ref={formRef} id="record-editor-form" onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
            <button ref={sendSubmitRef} type="submit" name="intent" value="save-and-send" className="hidden" tabIndex={-1} aria-hidden="true" />
            <button ref={saveNewSubmitRef} type="submit" name="intent" value="save-and-new" className="hidden" tabIndex={-1} aria-hidden="true" />
            <button ref={saveCopySubmitRef} type="submit" name="intent" value="save-and-copy" className="hidden" tabIndex={-1} aria-hidden="true" />
            <button ref={saveStaySubmitRef} type="submit" name="intent" value="save" className="hidden" tabIndex={-1} aria-hidden="true" />
            <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6">
              <section className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
                    {partyFields.map((field) => fieldBlock(field))}
                    {module.kind === "expenses" && !record ? (
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="field-payNowAccountId">{isCheck ? <>Bank account <span className="text-destructive">*</span></> : isCardCredit ? <>Credit card <span className="text-destructive">*</span></> : "Payment account"}</Label>
                        <Select value={values.payNowAccountId || (isCheck || isCardCredit ? null : "unpaid")} onValueChange={(next) => changeValue("payNowAccountId", next === "unpaid" ? "" : next ?? "")}>
                          <SelectTrigger id="field-payNowAccountId" className="w-full" disabled={Boolean(savedRecordId)}><SelectValue placeholder={isCardCredit ? "Choose a credit card" : "Choose a bank account"} /></SelectTrigger>
                          <SelectContent>
                            {isCheck || isCardCredit ? null : <SelectItem value="unpaid">Not paid yet</SelectItem>}
                            {paymentAccounts.filter((account) => (isCheck ? paymentAccountType(account) === "Bank" : isCardCredit ? paymentAccountType(account) === "Credit card" : true)).map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <p className="text-xs leading-5 text-muted-foreground">{isCheck ? "The bank account the check is drawn on." : isCardCredit ? "The credit card the supplier refunded to." : "The Cash, Bank or Credit card account this was paid from, on the expense date."}</p>
                      </div>
                    ) : null}
                    {selectedCustomer && partyFields.some((field) => field.key === "customer") ? (
                      <div className="min-w-0 space-y-2">
                        <Label>Customer email</Label>
                        <p className="flex h-9 items-center truncate rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">{selectedCustomer.data.email?.trim() || "No email saved for this customer"}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 lg:text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{headline.label}</p>
                    <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums" data-testid="headline-amount">{currencyAmount(headline.amount, moneyCurrency)}</p>
                  </div>
                </div>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  {headerFields.map((field) => fieldBlock(field))}
                </div>
              </section>

              {productTable}
              {categoryTable}
              {itemTable}

              <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  {footnoteFields.map((field) => fieldBlock(field))}
                </div>
                <div className="space-y-3 self-start rounded-xl border border-border bg-card p-5 text-sm">
                  {amountRow("Subtotal", documentSubtotal)}
                  {taxField ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                      {fieldBlock(taxField)}
                      <span className="pb-2 tabular-nums">{currencyAmount(documentTax, moneyCurrency)}</span>
                    </div>
                  ) : null}
                  {discountField ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                      {fieldBlock(discountField)}
                      <span className="pb-2 tabular-nums">−{currencyAmount(discount, moneyCurrency)}</span>
                    </div>
                  ) : null}
                  {amountRow("Total", documentTotal, true)}
                  {tracksBalance && paid > 0 ? amountRow(module.kind === "invoices" ? "Amount received" : "Amount paid", paid, false, true) : null}
                  {tracksBalance ? amountRow("Balance due", headline.amount, true) : null}
                </div>
              </section>

              {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
              {notice ? (
                <div role="status" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-primary">
                  <p>{notice}</p>
                  {shareLink ? <a href={shareLink} target="_blank" rel="noreferrer" className="mt-1 block break-all underline underline-offset-2">{shareLink}</a> : null}
                </div>
              ) : null}
            </div>
          </form>

          <footer className="flex flex-wrap items-center justify-between gap-2 bg-sidebar px-4 py-3 text-sidebar-foreground sm:px-6">
            <Button type="button" variant="ghost" className={footerGhost} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <div className="flex flex-wrap items-center gap-1">
              {canRepeat ? <Button type="button" variant="ghost" className={footerGhost} disabled={busy} onClick={startRecurring}><Repeat size={15} />Make recurring</Button> : null}
              {shareableDocumentKinds.has(module.kind) && savedRecordId ? (
                <>
                  <Button type="button" variant="ghost" className={footerGhost} nativeButton={false} render={<Link href={module.kind === "invoices" ? `/app/invoices/${savedRecordId}/print` : `/app/documents/${module.kind}/${savedRecordId}/print`} target="_blank" rel="noreferrer" />}><Printer size={15} />Print or preview</Button>
                  <Button type="button" variant="ghost" className={footerGhost} onClick={() => void shareDocument()} disabled={sharing || pending}><Share2 size={15} />{sharing ? "Copying…" : "Share link"}</Button>
                  <Button type="button" variant="ghost" className={footerGhost} disabled={busy} onClick={() => submitWithIntent(saveCopySubmitRef.current)}><Copy size={15} />Copy</Button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-white" disabled={busy} onClick={() => submitWithIntent(saveStaySubmitRef.current)}>{pending ? "Saving…" : "Save"}</Button>
              <div className="flex">
                {shareableDocumentKinds.has(module.kind) ? (
                  <Button type="button" className="rounded-r-none" disabled={busy} onClick={() => startInvoiceSend("email")}><Mail size={15} />Save and send</Button>
                ) : (
                  <Button type="submit" form="record-editor-form" className="rounded-r-none" disabled={busy}>Save and close</Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" className="rounded-l-none border-l border-primary-foreground/25 px-2" aria-label="More save options" disabled={busy} />}>
                    <ChevronDown size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="min-w-48">
                    {shareableDocumentKinds.has(module.kind) ? (
                      <>
                        <DropdownMenuItem onClick={() => startInvoiceSend("whatsapp")}><MessageCircle size={15} />Save and send by WhatsApp</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => startInvoiceSend("sms")}><MessageSquareText size={15} />Save and send by SMS</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => formRef.current?.requestSubmit()}>Save and close</DropdownMenuItem>
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={() => submitWithIntent(saveNewSubmitRef.current)}>Save and new</DropdownMenuItem>
                    {shareableDocumentKinds.has(module.kind) ? <DropdownMenuItem onClick={() => submitWithIntent(saveCopySubmitRef.current)}>Save and copy</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </footer>
        </DialogContent>
        {recurringPayload ? (
          <MakeRecurringDialog
            open
            onOpenChange={(next) => { if (!next) setRecurringPayload(null); }}
            kind={module.kind as RecurringKind}
            payload={recurringPayload}
            defaultName={[values.customer || values.vendor || values.payee, module.label].filter(Boolean).join(" · ")}
          />
        ) : null}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]`}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{record ? `Edit ${module.label.toLowerCase()}` : `New ${module.label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{module.description}</DialogDescription>
        </DialogHeader>

        <form ref={formRef} id="record-editor-form" onSubmit={submit} className="space-y-5">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {visibleFields.map((field, index) => {
              const isWide = field.type === "textarea" || field.type === "file";
              const startsSection = Boolean(field.section && visibleFields[index - 1]?.section !== field.section);
              return (
                <Fragment key={field.key}>
                  {startsSection ? <div className="border-b border-border pb-2 pt-1 text-sm font-semibold text-foreground sm:col-span-2">{field.section}</div> : null}
                  {fieldBlock(field, isWide ? "sm:col-span-2" : "")}
                </Fragment>
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
          <Button type="submit" form="record-editor-form" disabled={pending || Boolean(uploading)}>
            {pending ? "Saving…" : record ? "Save changes" : `Save ${module.label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
