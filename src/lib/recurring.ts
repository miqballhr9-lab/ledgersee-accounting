/**
 * Recurring transactions: a saved invoice, bill, expense or journal that repeats on a schedule.
 * A template keeps the transaction's own fields plus its schedule in rt* fields.
 */

export const recurringKinds = ["invoices", "bills", "expenses", "journals"] as const;
export type RecurringKind = (typeof recurringKinds)[number];

export const recurringKindLabels: Record<RecurringKind, string> = {
  invoices: "Invoice",
  bills: "Bill",
  expenses: "Expense",
  journals: "Journal entry",
};

export type RecurringType = "Scheduled" | "Reminder" | "Unscheduled";
export type RecurringInterval = "Daily" | "Weekly" | "Monthly" | "Yearly";

/** Schedule fields, kept apart from the transaction's own fields. */
export const scheduleKeys = ["rtName", "rtKind", "rtType", "rtInterval", "rtEvery", "rtStart", "rtEndType", "rtEndDate", "rtOccurrences", "rtNext", "rtLast", "rtCount", "rtStatus"] as const;

/** The next date after `date`, `every` intervals on. Month ends stay at month end, as 31 Jan → 28 Feb. */
export function advanceDate(date: string, interval: string, every: number) {
  const [year, month, day] = date.split("-").map(Number);
  const step = Math.max(1, every || 1);
  if (interval === "Daily" || interval === "Weekly") {
    const next = new Date(Date.UTC(year, month - 1, day + step * (interval === "Weekly" ? 7 : 1)));
    return next.toISOString().slice(0, 10);
  }
  const months = interval === "Yearly" ? 12 * step : step;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** "Every 2 months", "Every week". */
export function intervalLabel(interval: string, every: string) {
  const count = Math.max(1, Number(every) || 1);
  const unit = { Daily: "day", Weekly: "week", Monthly: "month", Yearly: "year" }[interval] ?? "";
  if (!unit) return "—";
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

/** The transaction fields of a template, without its schedule. */
export function templatePayload(data: Record<string, string>) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !(scheduleKeys as readonly string[]).includes(key)));
}
