import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import PosWorkspace from "@/components/bookkeeping/PosWorkspace";
import { buildInventory, inventoryKinds } from "@/lib/inventory";
import { requireFeature } from "@/lib/plan-gate";
import { defaultWarehouse, lotRegister, stockByWarehouse } from "@/lib/warehouses";

export const metadata: Metadata = { title: "Point of sale" };

export default async function PosPage() {
  await requireFeature("pos");
  const groups = await listBookkeepingRecordGroups(["customers", "crm-price-books", "accounts", "settings", "taxes", "warehouses", "stock-transfers", ...inventoryKinds]);
  const all = Object.values(groups).flat();
  const stock = buildInventory(all);
  const items = (groups.items ?? []).map((item) => (stock.has(item.id) ? { ...item, data: { ...item.data, qtyOnHand: String(stock.get(item.id)!.onHand) } } : item));
  const settings = groups.settings?.[0]?.data ?? {};
  // With warehouses, the till sells from one of them: its stock, and the serial numbers held there.
  const named = (groups.warehouses ?? []).filter((warehouse) => warehouse.data.name?.trim());
  const first = defaultWarehouse(all);
  const warehouses = named.length ? [first, ...named.map((warehouse) => warehouse.data.name.trim()).filter((name) => name !== first)] : [];
  const stockAt = Object.fromEntries([...stockByWarehouse(all)].map(([itemId, places]) => [itemId, Object.fromEntries(places)]));
  const serials = lotRegister(all).filter((lot) => lot.tracking === "Serial number" && lot.onHand > 0).map((lot) => ({ itemId: lot.itemId, number: lot.number, warehouse: lot.warehouse }));
  return (
    <PosWorkspace
      items={items}
      customers={groups.customers ?? []}
      priceBooks={groups["crm-price-books"] ?? []}
      accounts={groups.accounts ?? []}
      taxes={groups.taxes ?? []}
      receipts={(groups.invoices ?? []).filter((invoice) => invoice.data.docType === "Sales receipt")}
      returns={(groups["credit-notes"] ?? []).filter((credit) => credit.data.sourceReceiptId)}
      warehouses={warehouses}
      stockAt={stockAt}
      serials={serials}
      settings={settings}
      currency={settings.currency || "USD"}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
