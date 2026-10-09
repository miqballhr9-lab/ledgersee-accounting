import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import BankReconciliationWorkspace from "@/components/bookkeeping/BankReconciliationWorkspace";

export const metadata: Metadata = { title: "Reconciliation" };

export default async function ReconciliationPage() {
  const groups = await listBookkeepingRecordGroups(["bank-accounts", "transactions", "reconciliations"]);

  return (
    <BankReconciliationWorkspace
      accounts={groups["bank-accounts"] ?? []}
      transactions={groups.transactions ?? []}
      reconciliations={groups.reconciliations ?? []}
    />
  );
}
