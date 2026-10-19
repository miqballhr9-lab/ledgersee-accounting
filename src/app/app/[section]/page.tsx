import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAllBookkeepingRecords, listBookkeepingRecordGroups } from "@/app/actions";
import CompanySettings from "@/components/settings/CompanySettings";
import { requireUser } from "@/lib/auth";
import ChartOfAccountsWorkspace from "@/components/bookkeeping/ChartOfAccountsWorkspace";
import { buildLedger } from "@/lib/ledger";
import InventoryWorkspace from "@/components/bookkeeping/InventoryWorkspace";
import BudgetPlannerWorkspace from "@/components/bookkeeping/BudgetPlannerWorkspace";
import BillsWorkspace from "@/components/bookkeeping/BillsWorkspace";
import ExpensesWorkspace from "@/components/bookkeeping/ExpensesWorkspace";
import VendorsWorkspace from "@/components/bookkeeping/VendorsWorkspace";
import ModuleWorkspace from "@/components/bookkeeping/ModuleWorkspace";
import PayrollWorkspace from "@/components/bookkeeping/PayrollWorkspace";
import EmployeesWorkspace from "@/components/hr/EmployeesWorkspace";
import { odooHrData } from "@/lib/hr-status";
import { moduleBySlug, withCustomFields, withWarehouses } from "@/lib/bookkeeping-config";
import { weekendDays } from "@/lib/weekend";
import { packFor } from "@/lib/tax-packs";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { buildInventory, inventoryKinds, isInventoryItem } from "@/lib/inventory";
import { stockByWarehouse } from "@/lib/warehouses";
import { requireFeature } from "@/lib/plan-gate";
import { ensurePaymentAccounts } from "@/lib/hr-data";
import { featuresForKind, type Feature } from "@/lib/plans";

/** Warehouse names, in the order they were added; the first is where stock goes when a document names none. */
const warehouseNames = (rows: BookkeepingRecord[] | undefined) => [...(rows ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((row) => row.data.name?.trim() ?? "").filter(Boolean);

/** Items with their quantity on hand, for item pickers. */
function itemsWithStock(groups: Partial<Record<string, BookkeepingRecord[]>>) {
  const stock = buildInventory(Object.values(groups).flat().filter((record): record is BookkeepingRecord => Boolean(record)));
  return (groups.items ?? []).map((item) => (stock.has(item.id) ? { ...item, data: { ...item.data, qtyOnHand: String(stock.get(item.id)!.onHand) } } : item));
}

interface SectionPageProps {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string; budgetHead?: string }>;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const module = moduleBySlug(section);
  return { title: module?.plural ?? (section === "payroll" ? "Payroll" : section === "inventory" ? "Inventory" : "Workspace") };
}

export default async function SectionPage({ params, searchParams }: SectionPageProps) {
  const { section } = await params;
  const { startDate = "", endDate = "", budgetHead = "" } = await searchParams;
  // Parts of the product outside the workspace's plan send people to Billing to add the app.
  const gated: Record<string, Feature[]> = { inventory: ["inventory"], employees: ["hr"], payroll: ["hr"], budgets: ["accounting"] };
  const sectionModule = moduleBySlug(section);
  const needed = gated[section] ?? (sectionModule ? featuresForKind(sectionModule.kind) : []);
  if (section !== "settings" && needed.length) await requireFeature(...needed);
  if (section === "settings") {
    const [groups, me] = await Promise.all([listBookkeepingRecordGroups(["settings"]), requireUser()]);
    return <CompanySettings settings={groups.settings?.[0] ?? null} workspaceName={me.workspaceName} />;
  }

  if (section === "inventory") {
    const groups = await listBookkeepingRecordGroups([...inventoryKinds, "settings", "warehouses", "stock-transfers"]);
    const summaries = buildInventory(Object.values(groups).flat());
    const byWarehouse = Object.fromEntries([...stockByWarehouse(Object.values(groups).flat())].map(([id, places]) => [id, Object.fromEntries(places)]));
    const products = [...summaries.values()].map(({ item, onHand }) => ({ ...item, data: { ...item.data, stock: String(onHand) } }));
    const stock = Object.fromEntries([...summaries].map(([id, summary]) => [id, { onHand: summary.onHand, value: summary.value, averageCost: summary.averageCost }]));
    const activity = [...summaries.values()]
      .flatMap((summary) => summary.events.map((event) => ({ ...event, itemName: summary.item.data.name || "Item", unit: summary.item.data.unit || "" })))
      .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order)
      .slice(0, 500);
    return <InventoryWorkspace products={products} stock={stock} activity={activity} currency={groups.settings?.[0]?.data.currency || "USD"} warehouses={warehouseNames(groups.warehouses)} byWarehouse={byWarehouse} />;
  }

  if (section === "payroll") {
    await ensurePaymentAccounts(await requireUser());
    const groups = await listBookkeepingRecordGroups(["payroll", "employees", "accounts", "settings", "hr-leaves", "hr-loans", "hr-attendance", "hr-contracts", "hr-claims", "expenses"]);
    const settingsData = groups.settings?.[0]?.data;
    const pack = packFor(settingsData?.taxCountry);
    return <PayrollWorkspace records={groups.payroll ?? []} accounts={groups.accounts ?? []} employees={groups.employees ?? []} hr={{ leaves: groups["hr-leaves"] ?? [], loans: groups["hr-loans"] ?? [], attendance: groups["hr-attendance"] ?? [], contracts: groups["hr-contracts"] ?? [], claims: groups["hr-claims"] ?? [], weekend: weekendDays(settingsData?.weekendDays), salaryRules: settingsData?.salaryRules ?? "" }} asOfDate={new Date().toISOString().slice(0, 10)} dateRange={{ startDate, endDate }} currency={settingsData?.currency || pack?.currency || "PKR"} taxRule={pack?.payroll.incomeTax ?? "pakistan-slabs"} liabilityPayments={(groups.expenses ?? []).filter((expense) => expense.data.payrollLiability)} />;
  }

  if (section === "employees") {
    const relatedKinds = ["hr-leaves", "hr-attendance", "payroll", "hr-claims", "hr-appraisals", "hr-documents", "hr-loans", "hr-contracts"] as const;
    const groups = await listBookkeepingRecordGroups(["employees", "hr-departments", "accounts", ...relatedKinds]);
    const related = Object.fromEntries(relatedKinds.map((kind) => [kind, (groups[kind] ?? []).map((record) => ({ ...record, data: odooHrData(kind, record.data) }))]));
    return <EmployeesWorkspace employees={groups.employees ?? []} departments={groups["hr-departments"] ?? []} accounts={groups.accounts ?? []} related={related} asOfDate={new Date().toISOString().slice(0, 10)} />;
  }

  if (section === "budgets") {
    const [groups, allRecords] = await Promise.all([listBookkeepingRecordGroups(["budgets", "invoices", "bills", "expenses", "payroll", "settings", "accounts", "automation-settings"]), listAllBookkeepingRecords()]);
    const records = [...(groups.invoices ?? []), ...(groups.bills ?? []), ...(groups.expenses ?? []), ...(groups.payroll ?? [])];
    return (
      <BudgetPlannerWorkspace
        budgets={groups.budgets ?? []}
        financialRecords={records}
        ledgerRecords={allRecords}
        accountingMethod={groups.settings?.[0]?.data.accountingMethod}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        asOfDate={new Date().toISOString().slice(0, 10)}
        automationMode={groups["automation-settings"]?.[0]?.data.mode === "Automation"}
      />
    );
  }

  if (section === "expenses") {
    const groups = await listBookkeepingRecordGroups(["expenses", "bills", "vendors", "accounts", "settings", "warehouses", ...inventoryKinds]);
    return (
      <ExpensesWorkspace
        expenses={groups.expenses ?? []}
        bills={groups.bills ?? []}
        vendors={groups.vendors ?? []}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        asOfDate={new Date().toISOString().slice(0, 10)}
        items={itemsWithStock(groups)}
        warehouses={warehouseNames(groups.warehouses)}
      />
    );
  }

  if (section === "bills") {
    const groups = await listBookkeepingRecordGroups(["bills", "expenses", "vendors", "accounts", "settings", "warehouses", ...inventoryKinds]);
    return (
      <BillsWorkspace
        records={groups.bills ?? []}
        expenses={groups.expenses ?? []}
        vendors={groups.vendors ?? []}
        accounts={groups.accounts ?? []}
        currency={groups.settings?.[0]?.data.currency || "USD"}
        billTerms={groups.settings?.[0]?.data.billTerms || "30 days"}
        items={itemsWithStock(groups)}
        asOfDate={new Date().toISOString().slice(0, 10)}
        warehouses={warehouseNames(groups.warehouses)}
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

  const baseModule = moduleBySlug(section);
  if (!baseModule) notFound();
  let module = baseModule;
  if (module.kind === "accounts") {
    const [groups, allRecords] = await Promise.all([listBookkeepingRecordGroups(["accounts", "settings"]), listAllBookkeepingRecords()]);
    const accounts = groups.accounts ?? [];
    const settings = groups.settings ?? [];
    // Each account's balance today, from the books, as the Balance Sheet and Profit and Loss read it.
    const method = settings[0]?.data.accountingMethod === "Cash" ? "cash" : "accrual";
    const ledger = buildLedger(allRecords, method);
    const today = new Date().toISOString().slice(0, 10);
    const totals = new Map<string, number>();
    for (const posting of ledger.postings) if (posting.date <= today) totals.set(posting.account.trim().toLowerCase(), (totals.get(posting.account.trim().toLowerCase()) ?? 0) + posting.amount);
    const balances = Object.fromEntries(accounts.map((account) => {
      const name = (account.data.name?.trim() || account.data.code?.trim() || "").toLowerCase();
      const raw = totals.get(name) ?? 0;
      // Liabilities, equity and income are credit balances: shown positive when they are owed or earned.
      const credit = ["Liability", "Equity", "Income"].includes(ledger.accounts.get(name)?.category ?? "");
      return [account.id, Math.round((credit ? -raw : raw) * 100) / 100];
    }));
    return <ChartOfAccountsWorkspace accounts={accounts} currency={settings[0]?.data.currency || "USD"} balances={balances} cashBasis={method === "cash"} />;
  }

  const kinds = new Set<RecordKind>([module.kind, "settings", "warehouses"]);
  if (module.fields.some((field) => field.key === "customer") || module.kind === "journals") kinds.add("customers");
  if (module.fields.some((field) => field.key === "vendor") || module.kind === "journals") kinds.add("vendors");
  if (["invoices", "bills", "journals", "supplier-credits", "credit-notes", "purchase-orders", "employees", "items"].includes(module.kind)) kinds.add("accounts");
  if (module.fields.some((field) => field.key === "lineItems")) kinds.add("items");
  if (module.kind === "journals") {
    kinds.add("payroll");
    kinds.add("employees");
  }
  // A customer's or supplier's page lists their transactions, as QuickBooks' customer centre does.
  const partyDocuments: RecordKind[] = module.kind === "customers" ? ["invoices", "credit-notes", "estimates", "payments"] : module.kind === "vendors" ? ["bills", "expenses", "supplier-credits", "payments"] : [];
  for (const kind of partyDocuments) kinds.add(kind);
  // Quantity on hand comes from the documents that move stock.
  if (module.kind === "items" || module.kind === "stock-transfers" || kinds.has("items")) for (const kind of inventoryKinds) kinds.add(kind);
  const groups = await listBookkeepingRecordGroups([...kinds]);
  const stock = kinds.has("items") ? buildInventory(Object.values(groups).flat()) : null;
  const withStock = (list: BookkeepingRecord[]) => (stock ? list.map((item) => (stock.has(item.id) ? { ...item, data: { ...item.data, qtyOnHand: String(stock.get(item.id)!.onHand) } } : item)) : list);
  if (groups.items) groups.items = withStock(groups.items);
  const records = groups[module.kind] ?? [];
  const customers = groups.customers ?? [];
  const vendors = groups.vendors ?? [];
  const accounts = groups.accounts ?? [];
  const items = groups.items ?? [];
  const settings = groups.settings ?? [];
  module = withCustomFields(module, settings[0]?.data);
  module = withWarehouses(module, warehouseNames(groups.warehouses), module.kind === "stock-transfers" ? (groups.items ?? []).filter(isInventoryItem).map((item) => item.data.name?.trim() ?? "").filter(Boolean) : []);
  // Only employee names leave the server here; payroll amounts stay out of this page.
  const employeeNames = module.kind === "journals"
    ? [...new Set([
        ...(groups.employees ?? []).map((record) => record.data.name?.trim() ?? ""),
        ...(groups.payroll ?? []).map((record) => record.data.employeeName?.trim() ?? ""),
      ].filter(Boolean))]
    : [];
  const sourceFilter = budgetHead ? { startDate, endDate, budgetHead } : undefined;
  const related = partyDocuments.flatMap((kind) => groups[kind] ?? []);
  return <ModuleWorkspace module={module} records={records} customers={customers} vendors={vendors} accounts={accounts} items={items} defaultCurrency={settings[0]?.data.currency || "USD"} employeeNames={employeeNames} sourceFilter={sourceFilter} related={related} />;
}
