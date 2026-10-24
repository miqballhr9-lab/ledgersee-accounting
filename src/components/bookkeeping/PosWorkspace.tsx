"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Camera, CreditCard, Minus, Package, PauseCircle, Play, Plus, Printer, ReceiptText, ScanBarcode, Search, ShoppingCart, Trash2, Undo2, Warehouse, X } from "lucide-react";

import { saveBookkeepingRecord } from "@/app/actions";
import PosReturnDialog from "@/components/bookkeeping/PosReturnDialog";
import PosSalesDialog from "@/components/bookkeeping/PosSalesDialog";
import CameraScanner from "@/components/bookkeeping/CameraScanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { isInventoryItem } from "@/lib/inventory";
import { currencyAmount, invoiceTax } from "@/lib/invoice-utils";
import { receivingAccountType } from "@/lib/payment-accounts";
import { customerPriceBook, priceBookPrice } from "@/lib/price-books";
import { useHeldSales, type HeldSale } from "@/lib/pos-held";

interface PosWorkspaceProps {
  items: BookkeepingRecord[];
  customers: BookkeepingRecord[];
  /** CRM price books, for customers who have one. */
  priceBooks?: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  taxes: BookkeepingRecord[];
  /** Sales receipts, for today's takings and the next receipt number. */
  receipts: BookkeepingRecord[];
  /** Returns already taken at the till (credit notes made from a receipt). */
  returns?: BookkeepingRecord[];
  /** Warehouse names, the default first; empty when the business has none. */
  warehouses?: string[];
  /** Stock of each item in each warehouse. */
  stockAt?: Record<string, Record<string, number>>;
  /** Serial numbers in stock, and where. */
  serials?: Array<{ itemId: string; number: string; warehouse: string }>;
  settings: Record<string, string>;
  currency: string;
  today: string;
  /** Only the business's Admin may delete a sale or take its payment off. */
  isAdmin?: boolean;
  /** The business, so sales held on this device stay with it. */
  businessId?: string;
}

interface CartLine {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  /** For items tracked by serial number: the one sold for each unit. */
  serials?: string[];
}

interface CompletedSale {
  id: string;
  number: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  tax: number;
  taxLabel: string;
  total: number;
  paidWith: string;
  tendered: number;
  change: number;
  customer: string;
  at: string;
}

const WALK_IN = "Walk-in customer";
const num = (value: string | undefined) => (Number.isFinite(Number(value)) ? Number(value) : 0);
// Only stock items are counted; services and non-stock products can always be sold.
const isStocked = (item: BookkeepingRecord) => isInventoryItem(item);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);

/**
 * A till for the shop counter: pick products (or scan a barcode or SKU), take
 * cash or card, and the sale is saved as a paid sales receipt, so stock, the
 * ledger and every report follow. Prints a narrow receipt for a slip printer.
 */
const bySerial = (item: BookkeepingRecord) => item.data.tracking === "Serial number";

export default function PosWorkspace({ items, customers, priceBooks = [], accounts, taxes, receipts, returns = [], warehouses = [], stockAt = {}, serials = [], settings, currency, today, isAdmin = false, businessId = "" }: PosWorkspaceProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const products = useMemo(() => items.filter((item) => item.data.name?.trim() && item.data.itemType !== "Bundle" && item.data.active !== "false"), [items]);
  const categories = useMemo(() => [...new Set(products.map((item) => item.data.category?.trim()).filter((category): category is string => Boolean(category)))].sort(), [products]);
  const payAccounts = useMemo(() => accounts.filter((account) => receivingAccountType(account)), [accounts]);
  const salesTaxes = useMemo(() => taxes.filter((tax) => tax.data.enabled !== "false" && tax.data.type !== "Withholding" && (tax.data.appliesTo || "Both") !== "Purchases"), [taxes]);
  const defaultTax = salesTaxes.find((tax) => tax.data.isDefault === "true");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [basket, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState(WALK_IN);
  const [discount, setDiscount] = useState("");
  const [taxId, setTaxId] = useState(defaultTax?.id ?? "none");
  const [paying, setPaying] = useState<"cash" | "card" | null>(null);
  const [accountId, setAccountId] = useState("");
  const [tendered, setTendered] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<CompletedSale | null>(null);
  const [lastNumber, setLastNumber] = useState(0);
  const [warehouse, setWarehouse] = useState(warehouses[0] ?? "");
  const [returning, setReturning] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const { held, save: saveHeld } = useHeldSales(businessId);

  const money = (value: number) => currencyAmount(value, currency);
  // With warehouses, only what the chosen one holds can be sold.
  const stockOf = (item: BookkeepingRecord) => (warehouses.length ? stockAt[item.id]?.[warehouse] ?? 0 : num(item.data.qtyOnHand ?? item.data.openingQty));
  const inCart = (itemId: string) => basket.find((line) => line.itemId === itemId)?.quantity ?? 0;
  /** Serial numbers of the item in stock here and not already in the sale. */
  const freeSerials = (itemId: string) => {
    const taken = new Set(basket.find((line) => line.itemId === itemId)?.serials ?? []);
    return serials.filter((entry) => entry.itemId === itemId && (!warehouses.length || entry.warehouse.toLowerCase() === warehouse.toLowerCase()) && !taken.has(entry.number)).map((entry) => entry.number);
  };

  const shown = products.filter((item) => {
    const needle = search.trim().toLowerCase();
    if (category !== "All" && item.data.category?.trim() !== category) return false;
    return !needle || [item.data.name, item.data.sku, item.data.barcode, item.data.category].some((value) => value?.toLowerCase().includes(needle));
  });

  // The chosen customer's price book (CRM) sets the price of the items it lists.
  const book = customerPriceBook(customers.find((entry) => entry.id === customer), priceBooks);
  const cart = basket.map((line) => {
    const special = priceBookPrice(book, line.itemId, line.quantity);
    return special === undefined ? line : { ...line, price: special };
  });
  const tax = salesTaxes.find((entry) => entry.id === taxId);
  const taxRate = tax ? num(tax.data.rate) : 0;
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discountValue = Math.min(Math.max(0, num(discount)), subtotal);
  const taxValue = invoiceTax(cart.map((line) => ({ quantity: String(line.quantity), rate: String(line.price) })), taxRate);
  const total = Math.max(0, subtotal + taxValue - discountValue);
  const cashGiven = num(tendered);
  const change = Math.max(0, cashGiven - total);

  // Today's takings at the till.
  const todays = receipts.filter((receipt) => receipt.data.posSale === "true" && receipt.data.issueDate === today);
  const takings = todays.reduce((sum, receipt) => sum + num(receipt.data.amount), 0);
  const byMethod = (method: string) => todays.filter((receipt) => receipt.data.posPayment === method).reduce((sum, receipt) => sum + num(receipt.data.amount), 0);
  const todaysReturns = returns.filter((credit) => credit.data.date === today && credit.data.status === "Refunded").reduce((sum, credit) => sum + num(credit.data.amount), 0);
  const nextNumber = Math.max(lastNumber, ...receipts.map((receipt) => Number(/^POS-(\d+)$/.exec(receipt.data.invoiceNumber ?? "")?.[1] ?? 0))) + 1;

  /** Adds one unit; a serial-numbered item takes the serial scanned, else the next one in stock. */
  function add(item: BookkeepingRecord, serial?: string) {
    if (isStocked(item) && inCart(item.id) + 1 > stockOf(item)) {
      toast.error(`Only ${stockOf(item)} of ${item.data.name} in stock${warehouses.length ? ` in ${warehouse}` : ""}.`, { position: "top-center" });
      return;
    }
    let number = "";
    if (bySerial(item)) {
      const free = freeSerials(item.id);
      number = serial && free.includes(serial) ? serial : serial ? "" : free[0] ?? "";
      if (!number) {
        toast.error(serial ? `Serial ${serial} is already in this sale or not in stock here.` : `No serial number of ${item.data.name} is in stock${warehouses.length ? ` in ${warehouse}` : ""}.`, { position: "top-center" });
        return;
      }
    }
    setCart((current) => current.some((line) => line.itemId === item.id)
      ? current.map((line) => (line.itemId === item.id ? { ...line, quantity: line.quantity + 1, ...(number ? { serials: [...(line.serials ?? []), number] } : {}) } : line))
      : [...current, { itemId: item.id, name: item.data.name.trim(), price: num(item.data.rate), quantity: 1, ...(number ? { serials: [number] } : {}) }]);
  }

  function setQuantity(itemId: string, quantity: number) {
    const item = products.find((entry) => entry.id === itemId);
    if (item && isStocked(item) && quantity > stockOf(item)) {
      toast.error(`Only ${stockOf(item)} of ${item.data.name} in stock${warehouses.length ? ` in ${warehouse}` : ""}.`, { position: "top-center" });
      return;
    }
    // Serial-numbered items gain or drop serial numbers with the quantity.
    if (item && bySerial(item) && quantity > inCart(itemId)) {
      const extra = freeSerials(itemId).slice(0, quantity - inCart(itemId));
      if (extra.length < quantity - inCart(itemId)) {
        toast.error(`Not enough serial numbers of ${item.data.name} in stock.`, { position: "top-center" });
        return;
      }
      setCart((current) => current.map((line) => (line.itemId === itemId ? { ...line, quantity, serials: [...(line.serials ?? []), ...extra] } : line)));
      return;
    }
    setCart((current) => (quantity <= 0 ? current.filter((line) => line.itemId !== itemId) : current.map((line) => (line.itemId === itemId ? { ...line, quantity, ...(line.serials ? { serials: line.serials.slice(0, quantity) } : {}) } : line))));
  }

  /** Adds the product whose barcode or SKU is this code; false when there is none. */
  function addByCode(raw: string) {
    const code = raw.trim().toLowerCase();
    // A scanned serial number adds that very unit.
    const serial = code ? serials.find((entry) => entry.number.toLowerCase() === code && (!warehouses.length || entry.warehouse.toLowerCase() === warehouse.toLowerCase())) : undefined;
    const bySerialNumber = serial ? products.find((item) => item.id === serial.itemId) : undefined;
    if (serial && bySerialNumber) {
      add(bySerialNumber, serial.number);
      return true;
    }
    const match = code ? products.find((item) => item.data.barcode?.trim().toLowerCase() === code || item.data.sku?.trim().toLowerCase() === code) : undefined;
    if (match) add(match);
    return Boolean(match);
  }

  /** Enter in the search box adds the product whose barcode or SKU matches, as a scanner does; else the only product found. */
  function scan() {
    const code = search.trim();
    if (!code) return;
    if (addByCode(code)) setSearch("");
    else if (shown.length === 1) {
      add(shown[0]);
      setSearch("");
    } else toast.error(`No product with barcode or SKU “${code}”.`, { position: "top-center" });
  }

  // A USB or Bluetooth scanner types the code fast and presses Enter. Caught anywhere on the page,
  // so a scan works even when the cursor isn't in the search box.
  const addByCodeRef = useRef(addByCode);
  useEffect(() => {
    addByCodeRef.current = addByCode;
  });
  useEffect(() => {
    let buffer = "";
    let lastKey = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const now = Date.now();
      if (now - lastKey > 60) buffer = "";
      lastKey = now;
      if (event.key === "Enter") {
        if (buffer.length >= 3) {
          event.preventDefault();
          if (!addByCodeRef.current(buffer)) toast.error(`No product with barcode or SKU “${buffer}”.`, { position: "top-center" });
        }
        buffer = "";
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) buffer += event.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [cameraOpen, setCameraOpen] = useState(false);

  function startPayment(method: "cash" | "card") {
    if (!cart.length) return;
    // Cash goes to a cash account; card to a bank account, as the money lands there.
    const preferred = payAccounts.find((account) => (method === "cash" ? /cash/i : /bank|card|stripe|pos/i).test(`${account.data.name} ${account.data.detailType}`) && !/undeposited/i.test(account.data.name ?? ""));
    setAccountId(preferred?.id ?? payAccounts[0]?.id ?? "");
    setTendered(method === "cash" ? "" : total.toFixed(2));
    setPaying(method);
  }

  async function completeSale() {
    if (!paying || !accountId) return;
    if (paying === "cash" && cashGiven + 0.005 < total) {
      toast.error("The cash given is less than the total.", { position: "top-center" });
      return;
    }
    const number = `POS-${String(nextNumber).padStart(4, "0")}`;
    const chosen = customers.find((entry) => entry.id === customer);
    const account = payAccounts.find((entry) => entry.id === accountId);
    setSaving(true);
    try {
      const saved = await saveBookkeepingRecord("invoices", {
        docType: "Sales receipt",
        invoiceNumber: number,
        customer: chosen?.data.name?.trim() || WALK_IN,
        ...(chosen ? { customerId: chosen.id } : {}),
        issueDate: today,
        paymentTerms: "Due on receipt",
        paymentMethod: accountId,
        currency,
        exchangeRate: "1",
        lineItems: JSON.stringify(cart.map((line) => ({ itemId: line.itemId, name: line.name, description: "", quantity: String(line.quantity), rate: line.price.toFixed(2), ...(line.serials?.length ? { serials: line.serials.join(", ") } : {}) }))),
        ...(warehouses.length ? { warehouse } : {}),
        taxRate: String(taxRate),
        taxName: tax?.data.name ?? "",
        discount: discountValue ? discountValue.toFixed(2) : "",
        notes: "Point of sale",
        posSale: "true",
        posPayment: paying === "cash" ? "Cash" : "Card",
        ...(paying === "cash" ? { cashTendered: cashGiven.toFixed(2), changeDue: change.toFixed(2) } : {}),
      });
      setLastNumber(nextNumber);
      setDone({
        id: saved.id, number, lines: cart, subtotal, discount: discountValue, tax: taxValue, taxLabel: tax ? `${tax.data.name}` : "Tax", total,
        paidWith: `${paying === "cash" ? "Cash" : "Card"} · ${account?.data.name ?? ""}`, tendered: paying === "cash" ? cashGiven : total, change: paying === "cash" ? change : 0,
        customer: chosen?.data.name?.trim() || WALK_IN, at: new Date().toLocaleString(),
      });
      setPaying(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "The sale couldn’t be saved.", { position: "top-center" });
    } finally {
      setSaving(false);
    }
  }

  /** Puts the sale being rung up aside, so the next customer can be served. */
  function holdSale(quiet = false) {
    if (!basket.length) return held;
    const chosen = customers.find((entry) => entry.id === customer);
    const entry: HeldSale = { id: crypto.randomUUID(), at: new Date().toISOString(), customer, customerName: chosen?.data.name?.trim() || WALK_IN, lines: basket, discount, taxId, warehouse };
    const next = [entry, ...held].slice(0, 30);
    try {
      saveHeld(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The sale couldn't be held.", { position: "top-center" });
      return held;
    }
    setCart([]);
    setDiscount("");
    setCustomer(WALK_IN);
    setTendered("");
    if (!quiet) toast.success(`Sale held for ${entry.customerName}. Resume it from "Held".`, { position: "top-center" });
    setTimeout(() => searchRef.current?.focus(), 50);
    return next;
  }

  /** Brings a held sale back to the register; a sale already being rung up is held first. */
  function resumeSale(entry: HeldSale) {
    const list = basket.length ? holdSale(true) : held;
    saveHeld(list.filter((sale) => sale.id !== entry.id));
    setCart(entry.lines);
    setCustomer(customers.some((option) => option.id === entry.customer) ? entry.customer : WALK_IN);
    setDiscount(entry.discount);
    setTaxId(entry.taxId);
    if (entry.warehouse && warehouses.includes(entry.warehouse)) setWarehouse(entry.warehouse);
    setHeldOpen(false);
    if (basket.length) toast.message("The sale you were on is now held.", { position: "top-center" });
  }

  function newSale() {
    setCart([]);
    setDiscount("");
    setCustomer(WALK_IN);
    setTendered("");
    setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  /** A saved sale, back in the shape the receipt printer takes, to print it again. */
  function printSaved(receipt: BookkeepingRecord) {
    let lines: CartLine[] = [];
    try {
      const parsed: Array<Record<string, string>> = JSON.parse(receipt.data.lineItems || "[]");
      lines = parsed.map((line) => ({ itemId: line.itemId ?? "", name: line.name ?? "", price: num(line.rate), quantity: num(line.quantity), ...(line.serials ? { serials: line.serials.split(",").map((serial) => serial.trim()).filter(Boolean) } : {}) }));
    } catch {
      lines = [];
    }
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const discountTaken = num(receipt.data.discount);
    const totalPaid = num(receipt.data.amount);
    printReceipt({
      id: receipt.id, number: receipt.data.invoiceNumber || "", lines, subtotal, discount: discountTaken, tax: Math.max(0, totalPaid - subtotal + discountTaken), taxLabel: receipt.data.taxName || "Tax", total: totalPaid,
      paidWith: num(receipt.data.paidAmount) > 0 ? [receipt.data.posPayment, receipt.data.paymentAccountName].filter(Boolean).join(" · ") : "Unpaid",
      tendered: num(receipt.data.cashTendered) || num(receipt.data.paidAmount), change: num(receipt.data.changeDue),
      customer: receipt.data.customer || WALK_IN, at: new Date(receipt.createdAt).toLocaleString(),
    });
  }

  /** A narrow receipt for an 80 mm slip printer, in its own window so nothing else prints. */
  function printReceipt(sale: CompletedSale) {
    const win = window.open("", "_blank", "width=380,height=640");
    if (!win) {
      toast.error("Allow pop-ups to print the receipt.", { position: "top-center" });
      return;
    }
    const row = (left: string, right: string, strong = false) => `<tr${strong ? " class=\"strong\"" : ""}><td>${escapeHtml(left)}</td><td class="r">${escapeHtml(right)}</td></tr>`;
    const company = settings.companyName || "Receipt";
    const address = [settings.address, settings.city, settings.country].filter(Boolean).join(", ");
    const taxId = settings.trn || settings.ntn || "";
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sale.number)}</title><style>
      body{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;width:72mm;margin:0 auto;padding:6px;color:#000}
      h1{font-size:15px;text-align:center;margin:0}p{margin:2px 0;text-align:center}table{width:100%;border-collapse:collapse;margin-top:6px}
      td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}.line{border-top:1px dashed #000;margin:6px 0}.strong td{font-weight:700;font-size:13px}
      @page{size:80mm auto;margin:4mm}</style></head><body>
      <h1>${escapeHtml(company)}</h1>${address ? `<p>${escapeHtml(address)}</p>` : ""}${taxId ? `<p>Tax no. ${escapeHtml(taxId)}</p>` : ""}
      <div class="line"></div><p>Receipt ${escapeHtml(sale.number)}</p><p>${escapeHtml(sale.at)}</p><p>${escapeHtml(sale.customer)}</p><div class="line"></div>
      <table>${sale.lines.map((line) => `${row(line.name, money(line.price * line.quantity))}<tr><td colspan="2">&nbsp;&nbsp;${line.quantity} × ${escapeHtml(money(line.price))}${line.serials?.length ? `<br>&nbsp;&nbsp;SN ${escapeHtml(line.serials.join(", "))}` : ""}</td></tr>`).join("")}</table>
      <div class="line"></div><table>${row("Subtotal", money(sale.subtotal))}${sale.discount ? row("Discount", `-${money(sale.discount)}`) : ""}${sale.tax ? row(sale.taxLabel, money(sale.tax)) : ""}${row("TOTAL", money(sale.total), true)}
      ${row(sale.paidWith, money(sale.tendered))}${sale.change ? row("Change", money(sale.change)) : ""}</table>
      <div class="line"></div><p>Thank you for shopping with us</p>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 lg:h-[calc(100dvh-4rem)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Point of sale</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Register</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {warehouses.length ? (
            <div className="rounded-lg border border-border bg-card px-3 py-1.5">
              <Label htmlFor="pos-warehouse" className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground"><Warehouse size={11} />Selling from</Label>
              <Select value={warehouse} onValueChange={(value) => setWarehouse(value ?? warehouses[0])} disabled={cart.length > 0}>
                <SelectTrigger id="pos-warehouse" className="h-7 min-w-36 border-0 px-0 font-semibold shadow-none" title={cart.length ? "Finish or clear the sale to change warehouse" : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>{warehouses.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          <Button type="button" variant="outline" className="h-auto gap-2 self-stretch" onClick={() => setHeldOpen(true)} disabled={!held.length}><PauseCircle size={15} />Held{held.length ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{held.length}</span> : null}</Button>
          <Button type="button" variant="outline" className="h-auto gap-2 self-stretch" onClick={() => setSalesOpen(true)}><ReceiptText size={15} />Sales</Button>
          <Button type="button" variant="outline" className="h-auto gap-2 self-stretch" onClick={() => setReturning(true)} disabled={!receipts.length}><Undo2 size={15} />Return / refund</Button>
          {[["Today's sales", String(todays.length)], ["Takings", money(takings)], ["Cash", money(byMethod("Cash"))], ["Card", money(byMethod("Card"))], ...(todaysReturns ? [["Refunds", `−${money(todaysReturns)}`]] : [])].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card" aria-label="Products">
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); scan(); } }}
                placeholder="Search products, or scan a barcode / SKU and press Enter"
                className="h-11 pl-9"
                aria-label="Search or scan products"
              />
            </div>
            <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setCameraOpen(true)} aria-label="Scan with camera"><Camera size={16} /><span className="hidden sm:inline">Camera</span></Button>
            </div>
            {categories.length ? (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {["All", ...categories].map((entry) => (
                  <Button key={entry} type="button" size="sm" variant={category === entry ? "default" : "outline"} className="shrink-0 rounded-full" onClick={() => setCategory(entry)}>{entry}</Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {shown.length ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((item) => {
                  const stocked = isStocked(item);
                  const left = stockOf(item) - inCart(item.id);
                  const out = stocked && left <= 0;
                  return (
                    <button key={item.id} type="button" onClick={() => add(item)} disabled={out}
                      className="flex min-h-28 flex-col justify-between rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50">
                      <span className="flex items-start gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Package size={16} /></span>
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{item.data.name}</span>
                      </span>
                      <span className="mt-2 flex items-end justify-between gap-2">
                        <span className="font-semibold tabular-nums">{money(num(item.data.rate))}</span>
                        <span className={`text-[11px] ${out ? "text-destructive" : "text-muted-foreground"}`}>{stocked ? (out ? "Out of stock" : `${left} left`) : item.data.itemType === "Non-inventory" ? "Non-stock" : "Service"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid h-full min-h-48 place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Search className="mx-auto mb-2" size={20} />
                  {products.length ? "No product matches." : <>No products yet. Add them in <Link href="/app/items" className="font-medium text-primary underline underline-offset-4">Items &amp; services</Link>.</>}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-card" aria-label="Current sale">
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart size={17} />Current sale</h2>
            {cart.length ? (
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => holdSale()} title="Put this sale aside and serve the next customer"><PauseCircle size={14} />Hold</Button>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCart([])}><X size={14} />Clear</Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2 border-b border-border p-3">
            <Label htmlFor="pos-customer" className="text-xs text-muted-foreground">Customer</Label>
            <Select value={customer} onValueChange={(value) => setCustomer(value ?? WALK_IN)}>
              <SelectTrigger id="pos-customer" className="w-full"><SelectValue>{customers.find((entry) => entry.id === customer)?.data.name ?? WALK_IN}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={WALK_IN}>{WALK_IN}</SelectItem>
                {customers.filter((entry) => entry.data.name?.trim()).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.data.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-h-32 flex-1 overflow-y-auto">
            {cart.length ? (
              <ul className="divide-y divide-border">
                {cart.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{money(line.price)} each</p>
                      {line.serials?.length ? <p className="truncate text-[11px] text-muted-foreground" title={line.serials.join(", ")}>SN {line.serials.join(", ")}</p> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`One less ${line.name}`} onClick={() => setQuantity(line.itemId, line.quantity - 1)}><Minus size={13} /></Button>
                      <Input aria-label={`Quantity of ${line.name}`} className="h-8 w-12 px-1 text-center tabular-nums" inputMode="numeric" value={String(line.quantity)} onChange={(event) => setQuantity(line.itemId, Math.max(0, Math.floor(num(event.target.value))))} />
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`One more ${line.name}`} onClick={() => setQuantity(line.itemId, line.quantity + 1)}><Plus size={13} /></Button>
                    </div>
                    <p className="w-24 text-right text-sm font-semibold tabular-nums">{money(line.price * line.quantity)}</p>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${line.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setQuantity(line.itemId, 0)}><Trash2 size={14} /></Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid h-full min-h-32 place-items-center px-6 text-center text-sm text-muted-foreground">Tap a product or scan a barcode to start a sale.</div>
            )}
          </div>
          <div className="space-y-2 border-t border-border p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="pos-discount" className="text-xs text-muted-foreground">Discount ({currency})</Label>
                <Input id="pos-discount" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pos-tax" className="text-xs text-muted-foreground">Tax</Label>
                <Select value={taxId} onValueChange={(value) => setTaxId(value ?? "none")}>
                  <SelectTrigger id="pos-tax" className="h-9 w-full"><SelectValue>{tax ? `${tax.data.name}` : "No tax"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tax</SelectItem>
                    {salesTaxes.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.data.name} · {entry.data.rate}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <dl className="space-y-1 pt-1">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
              {discountValue ? <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular-nums">−{money(discountValue)}</dd></div> : null}
              {taxValue ? <div className="flex justify-between"><dt className="text-muted-foreground">Tax {taxRate}%</dt><dd className="tabular-nums">{money(taxValue)}</dd></div> : null}
              <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="pos-total">{money(total)}</dd></div>
            </dl>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button type="button" size="lg" className="h-12 gap-2" disabled={!cart.length || !payAccounts.length} onClick={() => startPayment("cash")}><Banknote size={18} />Cash</Button>
              <Button type="button" size="lg" variant="secondary" className="h-12 gap-2" disabled={!cart.length || !payAccounts.length} onClick={() => startPayment("card")}><CreditCard size={18} />Card</Button>
            </div>
            {!payAccounts.length ? <p className="text-xs text-destructive">Add a Cash or Bank account in Chart of accounts to take payments.</p> : null}
          </div>
        </aside>
      </div>

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Held sales</DialogTitle>
            <DialogDescription>Sales put aside on this till. Resume one to add more and take payment; nothing is in the books until it is completed.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {held.map((entry) => {
              const count = entry.lines.reduce((sum, line) => sum + line.quantity, 0);
              const value = entry.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
              return (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.customerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{count} {count === 1 ? "item" : "items"} · {money(value)} before tax · held {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="truncate text-xs text-muted-foreground">{entry.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")}</p>
                  </div>
                  <Button type="button" size="sm" className="gap-1" onClick={() => resumeSale(entry)}><Play size={14} />Resume</Button>
                  <Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Remove the sale held for ${entry.customerName}`} onClick={() => { if (window.confirm(`Remove the sale held for ${entry.customerName}? It was never completed, so nothing else changes.`)) saveHeld(held.filter((sale) => sale.id !== entry.id)); }}><Trash2 size={15} /></Button>
                </li>
              );
            })}
            {!held.length ? <li className="px-3 py-8 text-center text-sm text-muted-foreground">No sales on hold.</li> : null}
          </ul>
        </DialogContent>
      </Dialog>
      <PosSalesDialog open={salesOpen} onOpenChange={setSalesOpen} receipts={receipts} returns={returns} payAccounts={payAccounts} currency={currency} today={today} onPrint={printSaved} onChanged={() => router.refresh()} isAdmin={isAdmin} />
      <PosReturnDialog open={returning} onOpenChange={setReturning} receipts={receipts} returns={returns} items={items} payAccounts={payAccounts} currency={currency} today={today} onDone={() => router.refresh()} />

      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} onCode={(code) => { if (!addByCode(code)) toast.error(`No product with barcode “${code}”.`, { position: "top-center" }); }} />

      <Dialog open={Boolean(paying)} onOpenChange={(open) => { if (!open && !saving) setPaying(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{paying === "cash" ? "Cash payment" : "Card payment"}</DialogTitle>
            <DialogDescription>Total to pay: <span className="font-semibold text-foreground">{money(total)}</span></DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pos-account">Money goes to</Label>
              <Select value={accountId} onValueChange={(value) => setAccountId(value ?? "")}>
                <SelectTrigger id="pos-account" className="w-full"><SelectValue>{payAccounts.find((account) => account.id === accountId)?.data.name ?? "Choose an account"}</SelectValue></SelectTrigger>
                <SelectContent>{payAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.data.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {paying === "cash" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pos-tendered">Cash received</Label>
                  <Input id="pos-tendered" autoFocus inputMode="decimal" value={tendered} onChange={(event) => setTendered(event.target.value)} placeholder={total.toFixed(2)} className="h-11 text-lg tabular-nums"
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void completeSale(); } }} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([Math.ceil(total), Math.ceil(total / 10) * 10, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000])].filter((value) => value >= total).slice(0, 4).map((value) => (
                    <Button key={value} type="button" variant="outline" size="sm" onClick={() => setTendered(String(value))}>{money(value)}</Button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
                  <span className="text-sm text-muted-foreground">Change to give</span>
                  <span className="text-xl font-semibold tabular-nums" data-testid="pos-change">{money(change)}</span>
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Take {money(total)} on the card terminal, then complete the sale.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setPaying(null)}>Back</Button>
            <Button type="button" disabled={saving || !accountId || (paying === "cash" && cashGiven + 0.005 < total)} onClick={() => void completeSale()}>{saving ? "Saving…" : "Complete sale"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(done)} onOpenChange={(open) => { if (!open) newSale(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ReceiptText size={18} className="text-primary" />Sale complete</DialogTitle>
            <DialogDescription>Receipt {done?.number} · {done ? money(done.total) : ""}</DialogDescription>
          </DialogHeader>
          {done?.change ? (
            <div className="rounded-lg bg-primary/10 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">Change to give</p>
              <p className="text-3xl font-semibold tabular-nums" data-testid="pos-done-change">{money(done.change)}</p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" className="gap-2" onClick={() => done && printReceipt(done)}><Printer size={15} />Print receipt</Button>
            <Button type="button" autoFocus onClick={newSale}>New sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
