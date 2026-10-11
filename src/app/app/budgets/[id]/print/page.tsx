import { redirect } from "next/navigation";

interface BudgetPrintPageProps {
  params: Promise<{ id: string }>;
}

/** Older single-budget print links now open the shared budget print preview. */
export default async function BudgetPrintPage({ params }: BudgetPrintPageProps) {
  const { id } = await params;
  redirect(`/app/budgets/print?ids=${encodeURIComponent(id)}`);
}
