import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { parseInvoiceLines, type InvoiceLineData } from "@/lib/invoice-utils";

/**
 * Inventory the QuickBooks Online way: stock on hand and its value are
 * worked out from the documents themselves. Invoices take stock out and
 * credit notes put it back; bills and expenses with inventory lines, and
 * received purchase orders, bring it in; manual receipts, deliveries and
 * counts adjust it. Cost leaves stock first-in, first-out (FIFO).
 */

export const inventoryTypes = ["Inventory", "Non-inventory", "Service"] as const;

/** "Product" is how inventory items were saved before the QuickBooks types. */
export function isInventoryItem(item: Pick<BookkeepingRecord, "data"> | undefined) {
  return item?.data.itemType === "Inventory" || item?.data.itemType === "Product";
}

export function itemTypeLabel(type: string | undefined) {
  return type === "Product" ? "Inventory" : type || "Inventory";
}

export type InventoryRole =
  | "opening" | "sale" | "return" | "bill" | "purchase-return" | "po-receipt" | "adjust-in" | "adjust-out" | "delivery";

export interface InventoryEvent {
  itemId: string;
  date: string;
  /** Orders events on one day: stock in before stock out. */
  order: number;
  role: InventoryRole;
  type: string;
  number: string;
  name: string;
  quantity: number;
  /** Cost per unit for stock coming in; FIFO cost per unit for stock going out. */
  unitCost: number;
  /** Total cost moved: positive in, negative out. */
  value: number;
  onHand: number;
  assetValue: number;
  sourceKind: string;
  sourceId: string;
}

export interface InventoryItemSummary {
  item: BookkeepingRecord;
  onHand: number;
  value: number;
  averageCost: number;
  events: InventoryEvent[];
}

function num(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exchange(data: Record<string, string>) {
  const rate = num(data.exchangeRate);
  return data.currency && rate > 0 ? rate : 1;
}

/** Lines that carry an item, with the document's discount spread across them (tax excluded). */
export function pricedLines(data: Record<string, string>, raw = data.lineItems ?? "") {
  const lines = parseInvoiceLines(raw);
  const subtotal = lines.reduce((sum, line) => sum + num(line.quantity) * num(line.rate), 0);
  const net = num(data.amount) - num(data.taxAmount);
  const scale = subtotal > 0 && net > 0 ? net / subtotal : 1;
  return lines.map((line: InvoiceLineData) => ({ ...line, qty: num(line.quantity), unit: num(line.rate) * scale * exchange(data) }));
}

const inactive = (status: string | undefined) => ["Draft", "Cancelled", "Void", "Pending approval"].includes(status ?? "");

/** Whether a purchase order's items were received into stock (so its bill doesn't add them again). */
function receivedOrder(order: BookkeepingRecord | undefined) {
  return Boolean(order && (order.data.receivedAt || order.data.status === "Received"));
}

export function buildInventory(records: BookkeepingRecord[], asOf = "9999-12-31"): Map<string, InventoryItemSummary> {
  const items = records.filter((record) => record.kind === "items" && isInventoryItem(record));
  const tracked = new Map(items.map((item) => [item.id, item]));
  const orders = new Map(records.filter((record) => record.kind === "purchase-orders").map((record) => [record.id, record]));
  const ordersByNumber = new Map(records.filter((record) => record.kind === "purchase-orders" && record.data.poNumber).map((record) => [record.data.poNumber, record]));
  /** inUnit is the cost per unit of stock coming in; returns and stock-outs use FIFO or the average. */
  const raw: Array<Omit<InventoryEvent, "unitCost" | "value" | "onHand" | "assetValue"> & { inUnit?: number }> = [];
  const movements = records.filter((record) => record.kind === "inventory-movements");
  const cost = (item: BookkeepingRecord) => num(item.data.cost);

  // Opening stock: the initial quantity, or for older items whatever stock existed before any recorded movement.
  for (const item of items) {
    const movedTotal = movements.filter((movement) => movement.data.itemId === item.id).reduce((sum, movement) => sum + num(movement.data.change), 0);
    const opening = item.data.openingQty !== undefined && item.data.openingQty !== "" ? num(item.data.openingQty) : num(item.data.stock) - movedTotal;
    if (Math.abs(opening) > 1e-9) {
      raw.push({ inUnit: cost(item), itemId: item.id, date: item.data.openingDate || item.createdAt.slice(0, 10), order: 0, role: opening > 0 ? "opening" : "adjust-out", type: "Opening quantity", number: "", name: "", quantity: opening, sourceKind: "items", sourceId: item.id });
    }
  }

  for (const movement of movements) {
    const item = tracked.get(movement.data.itemId ?? "");
    if (!item) continue;
    const change = num(movement.data.change);
    if (!change) continue;
    const fromOrder = movement.data.purchaseOrderId ? orders.get(movement.data.purchaseOrderId) : movement.data.notes === "Received from purchase order" ? ordersByNumber.get(movement.data.reference ?? "") : undefined;
    let unit = num(movement.data.unitCost) || cost(item);
    if (fromOrder) {
      const line = pricedLines(fromOrder.data).find((entry) => entry.itemId === item.id);
      if (line) unit = line.unit;
    }
    const role: InventoryRole = fromOrder && change > 0 ? "po-receipt" : movement.data.movementType === "Delivery" ? "delivery" : change > 0 ? "adjust-in" : "adjust-out";
    raw.push({ inUnit: unit, itemId: item.id, date: movement.data.date || movement.createdAt.slice(0, 10), order: change > 0 ? 1 : 3, role, type: role === "po-receipt" ? "Purchase order receipt" : role === "delivery" ? "Delivery" : "Inventory adjustment", number: movement.data.reference ?? "", name: movement.data.notes ?? "", quantity: change, sourceKind: role === "po-receipt" && fromOrder ? "purchase-orders" : "inventory-movements", sourceId: role === "po-receipt" && fromOrder ? fromOrder.id : movement.id });
  }

  for (const record of records) {
    const data = record.data;
    if (inactive(data.status)) continue;
    if (record.kind === "invoices" || record.kind === "credit-notes") {
      const sale = record.kind === "invoices";
      for (const line of pricedLines(data)) {
        if (!tracked.has(line.itemId) || !line.qty) continue;
        raw.push({ itemId: line.itemId, date: (sale ? data.issueDate : data.date) || record.createdAt.slice(0, 10), order: sale ? 2 : 1, role: sale ? "sale" : "return", type: sale ? "Invoice" : "Credit note", number: (sale ? data.invoiceNumber : data.creditNumber) ?? "", name: data.customer ?? "", quantity: sale ? -line.qty : line.qty, sourceKind: record.kind, sourceId: record.id });
      }
    }
    if (record.kind === "bills" || record.kind === "expenses" || record.kind === "supplier-credits") {
      const credit = record.kind === "supplier-credits";
      const order = data.sourcePurchaseOrderId ? orders.get(data.sourcePurchaseOrderId) : undefined;
      // Items on a received purchase order are already in stock.
      if (order && receivedOrder(order)) continue;
      const lines = pricedLines(data, data.purchaseLineItems || data.lineItems || "");
      for (const [index, line] of lines.entries()) {
        if (!tracked.has(line.itemId) || !line.qty) continue;
        const date = (record.kind === "bills" ? data.billDate : record.kind === "expenses" ? data.expenseDate : data.date) || record.createdAt.slice(0, 10);
        raw.push({ inUnit: line.unit, itemId: line.itemId, date, order: credit ? 3 : 1, role: credit ? "purchase-return" : "bill", type: record.kind === "bills" ? "Bill" : record.kind === "expenses" ? "Expense" : "Supplier credit", number: (record.kind === "bills" ? data.billNumber : record.kind === "expenses" ? data.referenceNumber : data.creditNumber) ?? "", name: (record.kind === "expenses" ? data.payee : data.vendor) ?? "", quantity: credit ? -line.qty : line.qty, sourceKind: record.kind, sourceId: `${record.id}#${index}` });
      }
    }
  }

  const summaries = new Map<string, InventoryItemSummary>();
  for (const item of items) summaries.set(item.id, { item, onHand: 0, value: 0, averageCost: cost(item), events: [] });

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const layers = new Map<string, Array<{ qty: number; unit: number }>>();
  /** Units sold before they were in stock; the next stock in covers them first. */
  const deficit = new Map<string, number>();
  for (const event of raw) {
    if (event.date > asOf) continue;
    const summary = summaries.get(event.itemId);
    if (!summary) continue;
    const stack = layers.get(event.itemId) ?? [];
    layers.set(event.itemId, stack);
    let value: number;
    let unit: number;
    if (event.quantity > 0) {
      // Returns from customers come back at the current average cost.
      unit = event.role === "return" || event.inUnit === undefined ? summary.averageCost : event.inUnit;
      const owed = deficit.get(event.itemId) ?? 0;
      const covered = Math.min(owed, event.quantity);
      if (covered > 0) deficit.set(event.itemId, owed - covered);
      if (event.quantity - covered > 1e-9) stack.push({ qty: event.quantity - covered, unit });
      value = event.quantity * unit;
    } else {
      // FIFO: take cost from the oldest stock first; selling more than is on hand uses the last known cost.
      let remaining = -event.quantity;
      value = 0;
      while (remaining > 1e-9 && stack.length) {
        const layer = stack[0];
        const taken = Math.min(layer.qty, remaining);
        value -= taken * layer.unit;
        layer.qty -= taken;
        remaining -= taken;
        if (layer.qty <= 1e-9) stack.shift();
      }
      if (remaining > 1e-9) {
        value -= remaining * summary.averageCost;
        deficit.set(event.itemId, (deficit.get(event.itemId) ?? 0) + remaining);
      }
      unit = event.quantity ? Math.abs(value / event.quantity) : 0;
    }
    summary.onHand += event.quantity;
    summary.value += value;
    if (summary.onHand > 1e-9 && summary.value > 0) summary.averageCost = summary.value / summary.onHand;
    const recorded: Omit<InventoryEvent, "unitCost" | "value" | "onHand" | "assetValue"> & { inUnit?: number } = { ...event };
    delete recorded.inUnit;
    summary.events.push({ ...recorded, unitCost: unit, value, onHand: summary.onHand, assetValue: summary.value });
  }
  for (const summary of summaries.values()) {
    summary.onHand = Math.round(summary.onHand * 1000) / 1000;
    summary.value = Math.round(summary.value * 100) / 100;
  }
  return summaries;
}

/** Stock on hand for one item, from a full set of records. */
export function onHandFor(records: BookkeepingRecord[], itemId: string) {
  return buildInventory(records).get(itemId)?.onHand ?? 0;
}

/** The kinds the inventory engine reads. */
export const inventoryKinds = ["items", "inventory-movements", "invoices", "credit-notes", "bills", "expenses", "supplier-credits", "purchase-orders"] as const;
