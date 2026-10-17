import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import SalesHub from "@/components/bookkeeping/SalesHub";
import { buildInventory, inventoryKinds } from "@/lib/inventory";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "All sales" };

export default async function SalesPage() {
  await requireFeature("accounting");
  const groups = await listBookkeepingRecordGroups(["estimates", "sales-orders", "payments", "customers", "accounts", "settings", ...inventoryKinds]);
  const stock = buildInventory(Object.values(groups).flat());
  const items = (groups.items ?? []).map((item) => (stock.has(item.id) ? { ...item, data: { ...item.data, qtyOnHand: String(stock.get(item.id)!.onHand) } } : item));
  return (
    <SalesHub
      invoices={groups.invoices ?? []}
      estimates={groups.estimates ?? []}
      salesOrders={groups["sales-orders"] ?? []}
      creditNotes={groups["credit-notes"] ?? []}
      payments={(groups.payments ?? []).filter((payment) => payment.data.invoiceId)}
      customers={groups.customers ?? []}
      items={items}
      accounts={groups.accounts ?? []}
      currency={groups.settings?.[0]?.data.currency || "USD"}
      asOfDate={new Date().toISOString().slice(0, 10)}
    />
  );
}
