import type { Metadata } from "next";

import { listAllBookkeepingRecords, listBookkeepingRecordGroups } from "@/app/actions";
import BankReconciliationWorkspace from "@/components/bookkeeping/BankReconciliationWorkspace";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { requireFeature } from "@/lib/plan-gate";
import { reconcileItems } from "@/lib/reconciliation";

export const metadata: Metadata = { title: "Reconciliation" };

export default async function ReconciliationPage() {
  await requireFeature("accounting");
  // Banking now lists every bank, cash and card account of the chart, so each can be reconciled.
  const groups = await listBookkeepingRecordGroups(["bank-accounts", "reconciliations"]);
  const records = await listAllBookkeepingRecords();
  const accounts = (groups["bank-accounts"] ?? []).filter((account) => account.data.name?.trim());
  // Each account's activity comes from the books, so payments, POS sales and transfers are all there;
  // the opening balance is one of those lines, so a first statement starts from zero.
  const lines: BookkeepingRecord[] = accounts.flatMap((account) => reconcileItems(records, account.data.name).map((item) => ({
    id: item.id,
    kind: "transactions" as const,
    data: { account: account.data.name, date: item.date, description: item.description, type: item.type, amount: item.amount.toFixed(2), reconciled: item.cleared ? "true" : "false" },
    createdAt: item.date,
    updatedAt: item.date,
  })));

  return (
    <BankReconciliationWorkspace
      accounts={accounts.map((account) => ({ ...account, data: { ...account.data, openingBalance: "0" } }))}
      transactions={lines}
      reconciliations={groups.reconciliations ?? []}
    />
  );
}
