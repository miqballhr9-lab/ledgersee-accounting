import { listAllBookkeepingRecords, listBookkeepingRecordGroups } from "@/app/actions";
import { accountOf, buildLedger } from "@/lib/ledger";
import { myToday } from "@/lib/business-time";
import Dashboard from "@/components/bookkeeping/Dashboard";
import type { SetupProgress } from "@/components/bookkeeping/SetupChecklist";
import { requireAccountingHome } from "@/lib/plan-gate";

export default async function DashboardPage() {
  await requireAccountingHome();
  const [groups, allRecords, today] = await Promise.all([
    listBookkeepingRecordGroups(["invoices", "bills", "expenses", "settings", "customers", "items", "accounts"]),
    listAllBookkeepingRecords(),
    myToday(),
  ]);
  // Income and expenses come from the books, on the business's accounting basis, as the Profit and
  // Loss reads them: no tax, drafts, stock bought or opening balances; payroll and HR costs included.
  const cashBasis = groups.settings?.[0]?.data.accountingMethod === "Cash";
  const ledger = buildLedger(allRecords, cashBasis ? "cash" : "accrual");
  const year = today.slice(0, 4);
  const profit = { income: 0, expenses: 0, months: Array.from({ length: 12 }, () => ({ income: 0, expenses: 0 })), cashBasis };
  for (const posting of ledger.postings) {
    if (posting.date > today) continue;
    const category = accountOf(ledger, posting.account).category;
    if (category !== "Income" && category !== "Expense") continue;
    const value = category === "Income" ? -posting.amount : posting.amount;
    profit[category === "Income" ? "income" : "expenses"] += value;
    if (posting.date.slice(0, 4) === year) profit.months[Number(posting.date.slice(5, 7)) - 1][category === "Income" ? "income" : "expenses"] += value;
  }
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
  return <Dashboard records={records} setup={setup} asOfDate={today} profit={profit} />;
}
