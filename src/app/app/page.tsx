import { listBookkeepingRecordGroups } from "@/app/actions";
import Dashboard from "@/components/bookkeeping/Dashboard";
import type { SetupProgress } from "@/components/bookkeeping/SetupChecklist";

export default async function DashboardPage() {
  const groups = await listBookkeepingRecordGroups(["invoices", "bills", "expenses", "settings", "customers", "items", "accounts"]);
  const invoices = groups.invoices ?? [];
  const records = [
    ...invoices,
    ...(groups.bills ?? []),
    ...(groups.expenses ?? []),
    ...(groups.settings ?? []),
  ];
  const setup: SetupProgress = {
    company: Boolean(groups.settings?.length),
    accounts: Boolean(groups.accounts?.length),
    customer: Boolean(groups.customers?.length),
    item: Boolean(groups.items?.length),
    invoice: invoices.length > 0,
    payment: invoices.some((invoice) => Number(invoice.data.paidAmount) > 0 || invoice.data.status === "Paid"),
  };
  return <Dashboard records={records} setup={setup} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
