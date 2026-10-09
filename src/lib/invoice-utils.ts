export interface InvoiceLineData {
  itemId: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
}

export function parseInvoiceLines(raw: string): InvoiceLineData[] {
  if (!raw.trim()) return [];

  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry): InvoiceLineData[] => {
        if (!entry || typeof entry !== "object") return [];
        const line = entry as Record<string, unknown>;
        return [{
          itemId: typeof line.itemId === "string" ? line.itemId : "",
          name: typeof line.name === "string" ? line.name : "",
          description: typeof line.description === "string" ? line.description : "",
          quantity: typeof line.quantity === "string" ? line.quantity : String(line.quantity ?? ""),
          rate: typeof line.rate === "string" ? line.rate : String(line.rate ?? ""),
        }];
      });
    } catch {
      return [];
    }
  }

  return raw
    .split("\n")
    .map((line) => line.split("|"))
    .filter((parts) => parts.some((part) => part.trim()))
    .map((parts) => ({
      itemId: "",
      name: parts[0]?.trim() ?? "",
      description: "",
      quantity: parts[1]?.trim() ?? "",
      rate: parts[2]?.trim() ?? "",
    }));
}

export function invoiceSubtotal(lines: InvoiceLineData[]): number {
  return lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const rate = Number(line.rate);
    if (!line.name.trim() || !Number.isFinite(quantity) || !Number.isFinite(rate)) return sum;
    return sum + Math.max(0, quantity) * Math.max(0, rate);
  }, 0);
}

export function dueDateForTerms(issueDate: string, terms: string): string {
  if (!issueDate) return "";
  const dueDate = new Date(`${issueDate}T12:00:00.000Z`);
  if (Number.isNaN(dueDate.getTime())) return "";
  const days = terms === "Due on receipt" ? 0 : Number.parseInt(terms, 10);
  if (!Number.isFinite(days) || days < 0) return "";
  dueDate.setUTCDate(dueDate.getUTCDate() + days);
  return dueDate.toISOString().slice(0, 10);
}

export function currencyAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
