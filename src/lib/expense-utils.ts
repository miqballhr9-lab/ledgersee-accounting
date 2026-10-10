import { parseInvoiceLines } from "@/lib/invoice-utils";

export interface ExpenseLineSummary {
  category: string;
  description: string;
  amount: number;
}

export function expenseLinesFromData(data: Record<string, string>): ExpenseLineSummary[] {
  const parsedLines = parseInvoiceLines(data.lineItems ?? "");
  const lines = parsedLines.flatMap((line) => {
    const amount = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
    return line.name.trim() && Number.isFinite(amount)
      ? [{ category: line.name.trim(), description: line.description.trim(), amount }]
      : [];
  });

  if (lines.length) return lines;

  const amount = Number(data.amount) || 0;
  return data.category?.trim() || data.description?.trim() || amount
    ? [{ category: data.category?.trim() ?? "", description: data.description?.trim() ?? "", amount }]
    : [];
}

export function expenseCategoryLabel(data: Record<string, string>): string {
  const categories = [...new Set(expenseLinesFromData(data).map((line) => line.category).filter(Boolean))];
  if (categories.length > 1) return "Multiple categories";
  return categories[0] ?? data.category ?? "";
}
