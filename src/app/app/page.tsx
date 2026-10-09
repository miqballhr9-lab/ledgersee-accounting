import { listBookkeepingRecordGroups } from "@/app/actions";
import Dashboard from "@/components/bookkeeping/Dashboard";

export default async function DashboardPage() {
  const groups = await listBookkeepingRecordGroups(["invoices", "bills", "expenses", "settings"]);
  const records = [
    ...(groups.invoices ?? []),
    ...(groups.bills ?? []),
    ...(groups.expenses ?? []),
    ...(groups.settings ?? []),
  ];
  return <Dashboard records={records} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
