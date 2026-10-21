import type { Metadata } from "next";

import CrmWorkqueue from "@/components/crm/CrmWorkqueue";
import { loadCrmData } from "@/lib/crm-data";
import { businessToday } from "@/lib/hr-data";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "Workqueue · CRM" };

export default async function CrmWorkqueuePage() {
  await requireFeature("crm");
  const { store, currency, me, owners, timeZone, dealApprovers } = await loadCrmData();
  return <CrmWorkqueue initialStore={store} currency={currency} me={me} owners={owners} today={businessToday(timeZone)} dealApprovers={dealApprovers} />;
}
