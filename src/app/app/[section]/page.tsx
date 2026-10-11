import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAllBookkeepingRecords, listBookkeepingRecordGroups } from "@/app/actions";
import ChartOfAccountsWorkspace from "@/components/bookkeeping/ChartOfAccountsWorkspace";
import InventoryWorkspace from "@/components/bookkeeping/InventoryWorkspace";
import BudgetPlannerWorkspace from "@/components/bookkeeping/BudgetPlannerWorkspace";
import BillsWorkspace from "@/components/bookkeeping/BillsWorkspace";
import ExpensesWorkspace from "@/components/bookkeeping/ExpensesWorkspace";
import VendorsWorkspace from "@/components/bookkeeping/VendorsWorkspace";
import ModuleWorkspace from "@/components/bookkeeping/ModuleWorkspace";
import PayrollWorkspace from "@/components/bookkeeping/PayrollWorkspace";
import ReportsWorkspace from "@/components/bookkeeping/ReportsWorkspace";
import { moduleBySlug } from "@/lib/bookkeeping-config";
import type { RecordKind } from "@/lib/bookkeeping-types";

interface SectionPageProps {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string; budgetHead?: string }>;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const module = moduleBySlug(section);
  return { title: module?.plural ?? (section === "reports" ? "Reports" : section === "payroll" ? "Payroll" : section === "inventory" ? "Inventory" : "Workspace") };
}

export default async function SectionPage({ params, searchParams }: SectionPageProps) {
  const { section } = await params;
  const { startDate = "", endDate = "", budgetHead = "" } = await searchParams;
  if (section === "inventory") {
    const groups = await listBookkeepingRecordGroups(["items", "inventory-movements", "settings"]);
    return (
      <InventoryWorkspace
        products={groups.items ?? []}
        movements={groups["inventory-movements"] ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
      />
    );
  }

  if (section === "payroll") {
    const groups = await listBookkeepingRecordGroups(["payroll", "accounts"]);
    return <PayrollWorkspace records={groups.payroll ?? []} accounts={groups.accounts ?? []} asOfDate={new Date().toISOString().slice(0, 10)} dateRange={{ startDate, endDate }} />;
  }

  if (section === "reports") {
    const records = await listAllBookkeepingRecords();
    return <ReportsWorkspace records={records} asOfDate={new Date().toISOString().slice(0, 10)} />;
  }

  if (section === "budgets") {
    const groups = await listBookkeepingRecordGroups(["budgets", "invoices", "bills", "expenses", "payroll", "settings", "accounts"]);
    const records = [...(groups.invoices ?? []), ...(groups.bills ?? []), ...(groups.expenses ?? []), ...(groups.payroll ?? [])];
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

  if (section === "expenses") {
    const groups = await listBookkeepingRecordGroups(["expenses", "bills", "vendors", "accounts", "settings"]);
    return (
      <ExpensesWorkspace
        expenses={groups.expenses ?? []}
        bills={groups.bills ?? []}
        vendors={groups.vendors ?? []}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        asOfDate={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  if (section === "bills") {
    const groups = await listBookkeepingRecordGroups(["bills", "vendors", "accounts", "settings"]);
    return (
      <BillsWorkspace
        records={groups.bills ?? []}
        vendors={groups.vendors ?? []}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        asOfDate={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  if (section === "vendors") {
    const groups = await listBookkeepingRecordGroups(["vendors", "bills", "accounts", "settings"]);
    return (
      <VendorsWorkspace
        records={groups.vendors ?? []}
        bills={groups.bills ?? []}
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
  if (["invoices", "bills", "journals", "supplier-credits", "purchase-orders"].includes(module.kind)) kinds.add("accounts");
  if (module.fields.some((field) => field.key === "lineItems")) kinds.add("items");
  const groups = await listBookkeepingRecordGroups([...kinds]);
  const records = groups[module.kind] ?? [];
  const customers = groups.customers ?? [];
  const vendors = groups.vendors ?? [];
  const accounts = groups.accounts ?? [];
  const items = groups.items ?? [];
  const settings = groups.settings ?? [];
  const sourceFilter = budgetHead ? { startDate, endDate, budgetHead } : undefined;
  return <ModuleWorkspace module={module} records={records} customers={customers} vendors={vendors} accounts={accounts} items={items} defaultCurrency={settings[0]?.data.currency || "USD"} sourceFilter={sourceFilter} />;
}
