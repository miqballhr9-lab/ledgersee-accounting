export interface InvoiceLineData {
  itemId: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
  /** Set on lines added from a bundle: the bundle they belong to, and whether its parts print. */
  bundleId?: string;
  bundleName?: string;
  bundleShow?: string;
  /** The line's own tax rate in percent; blank uses the document's rate. */
  taxRate?: string;
  /** Lot number, or serial numbers separated by commas, for items tracked by lot or serial. */
  serials?: string;
}

/** Serial numbers on a line, one per unit. */
export function serialList(serials: string | undefined): string[] {
  return (serials ?? "").split(/[,\n]/).map((serial) => serial.trim()).filter(Boolean);
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
          ...(typeof line.taxRate === "string" && line.taxRate.trim() ? { taxRate: line.taxRate.trim() } : {}),
          ...(typeof line.serials === "string" && line.serials.trim() ? { serials: line.serials.trim() } : {}),
          ...(typeof line.bundleId === "string" && line.bundleId ? { bundleId: line.bundleId, bundleName: typeof line.bundleName === "string" ? line.bundleName : "", bundleShow: line.bundleShow === "false" ? "false" : "true" } : {}),
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

/** Tax on the lines: each line at its own rate when it has one, otherwise at the document's rate. */
export function invoiceTax(lines: Array<Pick<InvoiceLineData, "quantity" | "rate" | "taxRate">>, documentRate: string | number | undefined): number {
  const fallback = Math.max(0, Number(documentRate) || 0);
  return lines.reduce((sum, line) => {
    const amount = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
    const rate = line.taxRate?.trim() ? Math.max(0, Number(line.taxRate) || 0) : fallback;
    return sum + amount * (rate / 100);
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

/** The rate that turns a document's amounts into the company's home currency: 1 when it is already in it. */
export function homeRate(data: Record<string, string>, homeCurrency = "") {
  if (!data.currency || data.currency === homeCurrency) return 1;
  const rate = Number(data.exchangeRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** The products on a document and how many in all, for list columns ("Items", "Quantity"). */
export function lineSummary(data: Record<string, string>) {
  const lines = parseInvoiceLines(data.lineItems ?? "").filter((line) => line.name.trim());
  const quantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  return { names: lines.map((line) => line.name.trim()).join(", "), quantity: Math.round(quantity * 1000) / 1000 };
}
