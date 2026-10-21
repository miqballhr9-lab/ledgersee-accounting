/**
 * Customer and supplier numbers: the next one follows the pattern of the
 * last number given (C-001 → C-002, SUP-0099 → SUP-0100), so after the first
 * one is chosen the rest number themselves.
 */
type Row = { data: Record<string, string>; createdAt: string | Date };

export const partyNumberKey = { customers: "customerNumber", vendors: "supplierNumber" } as const;
const defaultPrefix = { customers: "CUST-", vendors: "SUP-" } as const;

function split(value: string) {
  const match = /^(.*?)(\d+)$/.exec(value.trim());
  return match ? { prefix: match[1], digits: match[2] } : null;
}

export function nextPartyNumber(kind: "customers" | "vendors", rows: Row[]): string {
  const key = partyNumberKey[kind];
  const numbered = rows
    .filter((row) => split(row.data[key] ?? ""))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latest = numbered.length ? split(numbered[numbered.length - 1].data[key])! : null;
  if (!latest) return `${defaultPrefix[kind]}0001`;
  // The highest number with the latest one's prefix, plus one, as wide as it was written.
  const highest = numbered.reduce((max, row) => {
    const parts = split(row.data[key]);
    return parts && parts.prefix === latest.prefix ? Math.max(max, Number(parts.digits)) : max;
  }, 0);
  return `${latest.prefix}${String(highest + 1).padStart(latest.digits.length, "0")}`;
}
