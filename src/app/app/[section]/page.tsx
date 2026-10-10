import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAllBookkeepingRecords, listBookkeepingRecordGroups } from "@/app/actions";
import ChartOfAccountsWorkspace from "@/components/bookkeeping/ChartOfAccountsWorkspace";
import BudgetPlannerWorkspace from "@/components/bookkeeping/BudgetPlannerWorkspace";
import ModuleWorkspace from "@/components/bookkeeping/ModuleWorkspace";
import PayrollWorkspace from "@/components/bookkeeping/PayrollWorkspace";
import ReportsWorkspace from "@/components/bookkeeping/ReportsWorkspace";
import { moduleBySlug } from "@/lib/bookkeeping-config";
import type { RecordKind } from "@/lib/bookkeeping-types";

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const module = moduleBySlug(section);
  return { title: module?.plural ?? (section === "reports" ? "Reports" : section === "payroll" ? "Payroll" : "Workspace") };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  if (section === "payroll") {
    const groups = await listBookkeepingRecordGroups(["payroll", "accounts"]);
    return <PayrollWorkspace records={groups.payroll ?? []} accounts={groups.accounts ?? []} asOfDate={new Date().toISOString().slice(0, 10)} />;
  }

  if (section === "reports") {
    const records = await listAllBookkeepingRecords();
    return <ReportsWorkspace records={records} asOfDate={new Date().toISOString().slice(0, 10)} />;
  }

  if (section === "budgets") {
    const groups = await listBookkeepingRecordGroups(["budgets", "invoices", "bills", "expenses", "settings", "accounts"]);
    const records = [...(groups.invoices ?? []), ...(groups.bills ?? []), ...(groups.expenses ?? [])];
    return (
      <BudgetPlannerWorkspace
        budgets={groups.budgets ?? []}
        financialRecords={records}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        asOfDate={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  const module = moduleBySlug(section);
  if (!module) notFound();
  if (module.kind === "accounts") {
    const groups = await listBookkeepingRecordGroups(["accounts", "settings"]);
    const accounts = groups.accounts ?? [];
    const settings = groups.settings ?? [];
    return <ChartOfAccountsWorkspace accounts={accounts} currency={settings[0]?.data.currency || "USD"} />;
  }

  const kinds = new Set<RecordKind>([module.kind, "settings"]);
  if (module.fields.some((field) => field.key === "customer")) kinds.add("customers");
  if (module.fields.some((field) => field.key === "vendor")) kinds.add("vendors");
  if (["invoices", "bills", "journals"].includes(module.kind)) kinds.add("accounts");
  if (module.fields.some((field) => field.key === "lineItems")) kinds.add("items");
  const groups = await listBookkeepingRecordGroups([...kinds]);
  const records = groups[module.kind] ?? [];
  const customers = groups.customers ?? [];
  const vendors = groups.vendors ?? [];
  const accounts = groups.accounts ?? [];
  const items = groups.items ?? [];
  const settings = groups.settings ?? [];
  return <ModuleWorkspace module={module} records={records} customers={customers} vendors={vendors} accounts={accounts} items={items} defaultCurrency={settings[0]?.data.currency || "USD"} />;
}
