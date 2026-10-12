import type { Metadata } from "next";

import HrHome from "@/components/hr/HrHome";
import { loadHrData } from "@/lib/hr-data";

export const metadata: Metadata = { title: "HR" };

export default async function HrHomePage() {
  const { store, currency } = await loadHrData();
  return <HrHome store={store} currency={currency} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
