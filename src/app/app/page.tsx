import { listAllBookkeepingRecords } from "@/app/actions";
import Dashboard from "@/components/bookkeeping/Dashboard";

export default async function DashboardPage() {
  const records = await listAllBookkeepingRecords();
  return <Dashboard records={records} asOfDate={new Date().toISOString().slice(0, 10)} />;
}
