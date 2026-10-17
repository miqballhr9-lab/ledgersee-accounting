import type { Metadata } from "next";

import HrHome from "@/components/hr/HrHome";
import { loadHrData } from "@/lib/hr-data";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "HRM" };

export default async function HrHomePage() {
  await requireFeature("hr");
  const { store, currency } = await loadHrData();
  return <HrHome store={store} currency={currency} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
