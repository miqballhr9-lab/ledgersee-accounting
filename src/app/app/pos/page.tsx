import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import PosWorkspace from "@/components/bookkeeping/PosWorkspace";
import { buildInventory, inventoryKinds } from "@/lib/inventory";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "Point of sale" };

export default async function PosPage() {
  await requireFeature("accounting");
  const groups = await listBookkeepingRecordGroups(["customers", "accounts", "settings", "taxes", ...inventoryKinds]);
  const stock = buildInventory(Object.values(groups).flat());
  const items = (groups.items ?? []).map((item) => (stock.has(item.id) ? { ...item, data: { ...item.data, qtyOnHand: String(stock.get(item.id)!.onHand) } } : item));
  const settings = groups.settings?.[0]?.data ?? {};
  return (
    <PosWorkspace
      items={items}
      customers={groups.customers ?? []}
      accounts={groups.accounts ?? []}
      taxes={groups.taxes ?? []}
      receipts={(groups.invoices ?? []).filter((invoice) => invoice.data.docType === "Sales receipt")}
      settings={settings}
      currency={settings.currency || "USD"}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
