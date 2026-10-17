import type { Metadata } from "next";

import { getTaxSetup } from "@/app/tax-actions";
import TaxSetupWorkspace from "@/components/tax/TaxSetupWorkspace";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "Tax setup" };

export default async function TaxSetupPage() {
  await requireFeature("accounting");
  const state = await getTaxSetup();
  return <TaxSetupWorkspace state={state} />;
}
