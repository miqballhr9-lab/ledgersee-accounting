import type { Metadata } from "next";

import { getTaxSetup } from "@/app/tax-actions";
import TaxSetupWorkspace from "@/components/tax/TaxSetupWorkspace";

export const metadata: Metadata = { title: "Tax setup" };

export default async function TaxSetupPage() {
  const state = await getTaxSetup();
  return <TaxSetupWorkspace state={state} />;
}
