import type { Metadata } from "next";

import CrmHome from "@/components/crm/CrmHome";
import { loadCrmData } from "@/lib/crm-data";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmHomePage() {
  await requireFeature("crm");
  const { store, currency, me } = await loadCrmData();
  return <CrmHome store={store} currency={currency} me={me} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
