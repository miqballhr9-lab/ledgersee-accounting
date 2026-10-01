import type { Metadata } from "next";

import { listBookkeepingRecords } from "@/app/actions";
import BankReconciliationWorkspace from "@/components/bookkeeping/BankReconciliationWorkspace";

export const metadata: Metadata = { title: "Reconciliation" };

export default async function ReconciliationPage() {
  const [accounts, transactions, reconciliations] = await Promise.all([
    listBookkeepingRecords("bank-accounts"),
    listBookkeepingRecords("transactions"),
    listBookkeepingRecords("reconciliations"),
  ]);

  return (
    <BankReconciliationWorkspace
      accounts={accounts}
      transactions={transactions}
      reconciliations={reconciliations}
    />
  );
}
