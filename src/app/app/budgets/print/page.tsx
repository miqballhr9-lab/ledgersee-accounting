import { notFound } from "next/navigation";

import AutoPrint from "@/components/bookkeeping/AutoPrint";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";
import { BudgetPrintSheet, loadBudgetsForPrint } from "@/app/app/budgets/budget-print";
import { requireUser } from "@/lib/auth";

interface BudgetsPrintPageProps {
  searchParams: Promise<{ ids?: string; autoprint?: string }>;
}

/** Print preview for one or more budgets (?ids=a,b), each on its own page; ?autoprint=1 opens the print dialog. */
export default async function BudgetsPrintPage({ searchParams }: BudgetsPrintPageProps) {
  const me = await requireUser();
  const { ids = "", autoprint } = await searchParams;
  const requested = [...new Set(ids.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  const { budgets, sources, settings } = await loadBudgetsForPrint(me.id, requested);
  if (!budgets.length) notFound();

  return (
    <main className="min-h-dvh bg-background px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted-foreground">{budgets.length === 1 ? "1 budget" : `${budgets.length} budgets`} · each prints on its own page</p>
        <InvoicePrintButton />
      </div>
      {budgets.map((budget) => <BudgetPrintSheet key={budget.id} budget={budget} sources={sources} settings={settings} fallbackCompany={me.name} />)}
      {autoprint === "1" ? <AutoPrint /> : null}
    </main>
  );
}
