import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import BankDepositsWorkspace from "@/components/bookkeeping/BankDepositsWorkspace";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "Bank deposits" };

export default async function DepositsPage() {
  await requireFeature("accounting");
  const groups = await listBookkeepingRecordGroups(["deposits", "payments", "accounts", "bank-accounts", "settings"]);
  return (
    <BankDepositsWorkspace
      deposits={groups.deposits ?? []}
      payments={groups.payments ?? []}
      accounts={groups.accounts ?? []}
      bankAccounts={groups["bank-accounts"] ?? []}
      currency={groups.settings?.[0]?.data.currency || "USD"}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
