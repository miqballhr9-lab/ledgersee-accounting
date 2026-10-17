/**
 * Where stock is kept, and which lots and serial numbers came in and went out.
 * Quantities and values come from the inventory engine; this splits them by
 * the warehouse each document names (the first warehouse when it names none),
 * and moves them between warehouses with stock transfers.
 */
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { buildInventory, pricedLines } from "@/lib/inventory";
import { serialList } from "@/lib/invoice-utils";

function num(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The warehouse used when a document names none: the first one added, or "Main warehouse". */
export function defaultWarehouse(records: BookkeepingRecord[]) {
  return records.filter((record) => record.kind === "warehouses" && record.data.name?.trim()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.data.name.trim() || "Main warehouse";
}

/** Quantity on hand of each item in each warehouse. */
export function stockByWarehouse(records: BookkeepingRecord[], asOf = "9999-12-31"): Map<string, Map<string, number>> {
  const fallback = defaultWarehouse(records);
  const byId = new Map(records.map((record) => [record.id, record]));
  const result = new Map<string, Map<string, number>>();
  const add = (itemId: string, warehouse: string, quantity: number) => {
    const places = result.get(itemId) ?? new Map<string, number>();
    places.set(warehouse, Math.round(((places.get(warehouse) ?? 0) + quantity) * 1000) / 1000);
    result.set(itemId, places);
  };
  for (const [itemId, summary] of buildInventory(records, asOf)) {
    for (const event of summary.events) {
      const source = byId.get(event.sourceId.split("#")[0]);
      const warehouse = source?.data.warehouse?.trim() || fallback;
      add(itemId, warehouse, event.quantity);
    }
  }
  for (const transfer of records) {
    if (transfer.kind !== "stock-transfers" || (transfer.data.date || "") > asOf) continue;
    const quantity = num(transfer.data.quantity);
    if (!transfer.data.itemId || !(quantity > 0)) continue;
    add(transfer.data.itemId, transfer.data.fromWarehouse || fallback, -quantity);
    add(transfer.data.itemId, transfer.data.toWarehouse || fallback, quantity);
  }
  return result;
}

export interface LotEntry {
  itemId: string;
  itemName: string;
  /** The lot number or serial number. */
  number: string;
  tracking: "Lot" | "Serial number";
  quantityIn: number;
  quantityOut: number;
  onHand: number;
  warehouse: string;
  firstIn: string;
  lastMove: string;
  /** The documents that moved it, newest last, e.g. "Bill B-12". */
  history: Array<{ date: string; label: string; quantity: number; source: { kind: string; id: string } }>;
}

const docLabels: Record<string, [string, string]> = {
  invoices: ["Invoice", "invoiceNumber"], "credit-notes": ["Credit note", "creditNumber"], bills: ["Bill", "billNumber"],
  expenses: ["Expense", "referenceNumber"], "supplier-credits": ["Supplier credit", "creditNumber"], "purchase-orders": ["Purchase order", "poNumber"],
};
const docDates: Record<string, string> = { invoices: "issueDate", "credit-notes": "date", bills: "billDate", expenses: "expenseDate", "supplier-credits": "date", "purchase-orders": "date" };
/** Stock in (+1) or out (−1) for each kind of document. */
const docSign: Record<string, number> = { invoices: -1, "credit-notes": 1, bills: 1, expenses: 1, "supplier-credits": -1, "purchase-orders": 1 };

/** Every lot and serial number on documents, adjustments and transfers, with what is still in stock and where. */
export function lotRegister(records: BookkeepingRecord[]): LotEntry[] {
  const items = new Map(records.filter((record) => record.kind === "items" && ["Lot", "Serial number"].includes(record.data.tracking ?? "")).map((record) => [record.id, record]));
  const fallback = defaultWarehouse(records);
  const entries = new Map<string, LotEntry>();
  const move = (itemId: string, number: string, quantity: number, date: string, warehouse: string, label: string, source: { kind: string; id: string }) => {
    const item = items.get(itemId);
    if (!item || !number) return;
    const key = `${itemId}|${number.toLowerCase()}`;
    const entry = entries.get(key) ?? { itemId, itemName: item.data.name || "Item", number, tracking: item.data.tracking as LotEntry["tracking"], quantityIn: 0, quantityOut: 0, onHand: 0, warehouse, firstIn: "", lastMove: "", history: [] };
    if (quantity > 0) {
      entry.quantityIn += quantity;
      if (!entry.firstIn || date < entry.firstIn) entry.firstIn = date;
      entry.warehouse = warehouse;
    } else entry.quantityOut -= quantity;
    entry.onHand = Math.round((entry.quantityIn - entry.quantityOut) * 1000) / 1000;
    if (date >= entry.lastMove) entry.lastMove = date;
    entry.history.push({ date, label, quantity, source });
    entries.set(key, entry);
  };
  for (const record of records) {
    const data = record.data;
    if (["Draft", "Cancelled", "Void", "Pending approval"].includes(data.status ?? "")) continue;
    const sign = docSign[record.kind];
    if (sign) {
      // A purchase order's lots count once it is received; a bill from a received order doesn't count them again.
      if (record.kind === "purchase-orders" && !(data.receivedAt || data.status === "Received")) continue;
      if (record.kind !== "purchase-orders" && data.sourcePurchaseOrderId && records.some((order) => order.id === data.sourcePurchaseOrderId && (order.data.receivedAt || order.data.status === "Received"))) continue;
      const [label, numberKey] = docLabels[record.kind];
      const date = data[docDates[record.kind]] || record.createdAt.slice(0, 10);
      for (const line of pricedLines(data, data.purchaseLineItems || data.lineItems || "")) {
        const item = items.get(line.itemId);
        if (!item || !line.serials) continue;
        const numbers = item.data.tracking === "Serial number" ? serialList(line.serials) : [line.serials.trim()];
        const each = item.data.tracking === "Serial number" ? 1 : line.qty;
        for (const number of numbers) move(line.itemId, number, sign * each, date, data.warehouse?.trim() || fallback, `${label} ${data[numberKey] || ""}`.trim(), { kind: record.kind, id: record.id });
      }
    }
    if (record.kind === "inventory-movements" && data.serials && items.has(data.itemId ?? "")) {
      const item = items.get(data.itemId)!;
      const change = num(data.change);
      const numbers = item.data.tracking === "Serial number" ? serialList(data.serials) : [data.serials.trim()];
      for (const number of numbers) move(data.itemId, number, item.data.tracking === "Serial number" ? Math.sign(change) : change, data.date || record.createdAt.slice(0, 10), data.warehouse?.trim() || fallback, `${data.movementType || "Adjustment"} ${data.reference || ""}`.trim(), { kind: record.kind, id: record.id });
    }
  }
  // Transfers only change where a lot or serial is kept.
  for (const transfer of records.filter((record) => record.kind === "stock-transfers" && record.data.serials).sort((a, b) => (a.data.date ?? "").localeCompare(b.data.date ?? ""))) {
    for (const number of serialList(transfer.data.serials)) {
      const entry = entries.get(`${transfer.data.itemId}|${number.toLowerCase()}`);
      if (!entry) continue;
      entry.warehouse = transfer.data.toWarehouse || entry.warehouse;
      entry.history.push({ date: transfer.data.date || "", label: `Transfer to ${transfer.data.toWarehouse}`, quantity: 0, source: { kind: "stock-transfers", id: transfer.id } });
    }
  }
  return [...entries.values()].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.number.localeCompare(b.number));
}
