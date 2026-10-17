import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import RecurringWorkspace from "@/components/bookkeeping/RecurringWorkspace";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "Recurring transactions" };

export default async function RecurringPage() {
  await requireFeature("accounting");
  const groups = await listBookkeepingRecordGroups(["recurring-transactions", "settings"]);
  return <RecurringWorkspace templates={groups["recurring-transactions"] ?? []} currency={groups.settings?.[0]?.data.currency || "USD"} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
