import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import PurchasesHub from "@/components/bookkeeping/PurchasesHub";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "All purchases" };

export default async function PurchasesPage() {
  await requireFeature("accounting");
  const groups = await listBookkeepingRecordGroups(["bills", "expenses", "purchase-orders", "supplier-credits", "payments", "vendors", "accounts", "settings"]);
  return (
    <PurchasesHub
      bills={groups.bills ?? []}
      expenses={groups.expenses ?? []}
      purchaseOrders={groups["purchase-orders"] ?? []}
      supplierCredits={groups["supplier-credits"] ?? []}
      billPayments={(groups.payments ?? []).filter((payment) => payment.data.billId)}
      vendors={groups.vendors ?? []}
      accounts={groups.accounts ?? []}
      currency={groups.settings?.[0]?.data.currency || "USD"}
      asOfDate={new Date().toISOString().slice(0, 10)}
    />
  );
}
