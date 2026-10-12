import type { Metadata } from "next";

import CrmHome from "@/components/crm/CrmHome";
import { loadCrmData } from "@/lib/crm-data";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmHomePage() {
  const { store, currency, me } = await loadCrmData();
  return <CrmHome store={store} currency={currency} me={me} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
