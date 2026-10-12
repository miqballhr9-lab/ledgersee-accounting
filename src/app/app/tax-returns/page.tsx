import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import TaxReturnWorkspace from "@/components/tax/TaxReturnWorkspace";

export const metadata: Metadata = { title: "Tax returns" };

export default async function TaxReturnsPage() {
  const groups = await listBookkeepingRecordGroups(["invoices", "credit-notes", "bills", "expenses", "supplier-credits", "taxes", "customers", "vendors", "settings"]);
  const documents = [...(groups.invoices ?? []), ...(groups["credit-notes"] ?? []), ...(groups.bills ?? []), ...(groups.expenses ?? []), ...(groups["supplier-credits"] ?? [])];
  return (
    <TaxReturnWorkspace
      documents={documents}
      taxes={groups.taxes ?? []}
      parties={[...(groups.customers ?? []), ...(groups.vendors ?? [])]}
      settings={groups.settings?.[0]?.data ?? {}}
      asOfDate={new Date().toISOString().slice(0, 10)}
    />
  );
}
