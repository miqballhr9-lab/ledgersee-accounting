import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { accountOf, type Ledger, type LedgerAccount, type Posting } from "@/lib/ledger";

/** Report builders in the QuickBooks Online layout, all computed from the ledger. */

export type ColumnsBy = "total" | "months" | "quarters" | "years" | "customers" | "suppliers";
export type Compare = "none" | "pp" | "py";

export interface ReportOptions {
  from: string;
  to: string;
  columnsBy: ColumnsBy;
  compare: Compare;
  showChange: boolean;
  showPctChange: boolean;
  /** Show every account, not only those with activity. */
  allRows: boolean;
  /** Adds a "% of income" column after each amount column. */
  pctOfIncome?: boolean;
  /** Only postings for this customer or supplier name. */
  nameFilter?: string;
}

export interface ZoomSpec {
  accounts: string[];
  from: string;
  to: string;
  name?: string;
  nameField?: "customer" | "supplier" | "name";
}

export interface ReportColumn {
  key: string;
  label: string;
  kind: "amount" | "change" | "pct" | "text";
}

export interface ReportLine {
  id: string;
  parentId?: string;
  label: string;
  kind: "section" | "account" | "total" | "grand" | "text";
  depth: number;
  values: (number | string | null)[];
  zooms?: (ZoomSpec | null)[];
  /** For detail rows: the record the row opens. */
  source?: { kind: string; id: string };
}

export interface ReportResult {
  columns: ReportColumn[];
  lines: ReportLine[];
  /** Shown under the title, e.g. the period or "As of 31 December 2026". */
  period: string;
  empty?: string;
}

interface Period {
  label: string;
  from: string;
  to: string;
  name?: string;
  nameField?: "customer" | "supplier";
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parse(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

function endOfMonth(y: number, m: number) {
  return iso(y, m + 1, 0);
}

export function addDays(date: string, days: number) {
  const { y, m, d } = parse(date);
  return iso(y, m, d + days);
}

function shiftYears(date: string, years: number) {
  const { y, m, d } = parse(date);
  const last = Number(endOfMonth(y + years, m).slice(8));
  return iso(y + years, m, Math.min(d, last));
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function formatLongDate(date: string) {
  if (!date) return "";
  const { y, m, d } = parse(date);
  return `${d} ${monthNames[m - 1]} ${y}`;
}

export function periodLabel(from: string, to: string) {
  if (!from) return `As of ${formatLongDate(to)}`;
  const a = parse(from);
  const b = parse(to);
  const wholeMonths = a.d === 1 && to === endOfMonth(b.y, b.m);
  if (wholeMonths) {
    if (a.y === b.y && a.m === b.m) return `${monthNames[a.m - 1]} ${a.y}`;
    if (a.y === b.y) return `${monthNames[a.m - 1]} – ${monthNames[b.m - 1]} ${b.y}`;
    return `${monthNames[a.m - 1]} ${a.y} – ${monthNames[b.m - 1]} ${b.y}`;
  }
  return `${formatLongDate(from)} – ${formatLongDate(to)}`;
}

export type PeriodPreset =
  | "today" | "this-week" | "this-month" | "this-quarter" | "this-year" | "this-year-to-date"
  | "last-month" | "last-quarter" | "last-year" | "last-year-to-date" | "all" | "custom";

export const periodPresets: { value: PeriodPreset; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "this-week", label: "This week" },
  { value: "this-month", label: "This month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "this-year", label: "This year" },
  { value: "this-year-to-date", label: "This year to date" },
  { value: "last-month", label: "Last month" },
  { value: "last-quarter", label: "Last quarter" },
  { value: "last-year", label: "Last year" },
  { value: "last-year-to-date", label: "Last year to date" },
  { value: "custom", label: "Custom" },
];

/** Dates for a period preset; years start at the business's fiscal year month (0 = January). */
export function presetRange(preset: PeriodPreset, today: string, fiscalStartMonth = 0, earliest = ""): { from: string; to: string } {
  const { y, m } = parse(today);
  const fyStartYear = m - 1 >= fiscalStartMonth ? y : y - 1;
  const fyStart = iso(fyStartYear, fiscalStartMonth + 1, 1);
  const fyEnd = addDays(iso(fyStartYear + 1, fiscalStartMonth + 1, 1), -1);
  const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  switch (preset) {
    case "today": return { from: today, to: today };
    case "this-week": {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const start = addDays(today, -((weekday + 6) % 7));
      return { from: start, to: addDays(start, 6) };
    }
    case "this-month": return { from: iso(y, m, 1), to: endOfMonth(y, m) };
    case "this-quarter": return { from: iso(y, quarterStartMonth, 1), to: endOfMonth(y, quarterStartMonth + 2) };
    case "this-year": return { from: fyStart, to: fyEnd };
    case "this-year-to-date": return { from: fyStart, to: today };
    case "last-month": return { from: iso(y, m - 1, 1), to: endOfMonth(y, m - 1) };
    case "last-quarter": return { from: iso(y, quarterStartMonth - 3, 1), to: endOfMonth(y, quarterStartMonth - 1) };
    case "last-year": return { from: shiftYears(fyStart, -1), to: shiftYears(fyEnd, -1) };
    case "last-year-to-date": return { from: shiftYears(fyStart, -1), to: shiftYears(today, -1) };
    case "all": return { from: earliest || iso(y - 10, 1, 1), to: today };
    default: return { from: fyStart, to: today };
  }
}

function splitPeriods(from: string, to: string, by: ColumnsBy, ledger: Ledger, nameFilter = ""): Period[] {
  if (by === "customers" || by === "suppliers") {
    const field = by === "customers" ? "customer" : "supplier";
    const names = new Set<string>();
    for (const posting of ledger.postings) {
      if (posting.date < from || posting.date > to) continue;
      const category = accountOf(ledger, posting.account).category;
      if (category !== "Income" && category !== "Expense") continue;
      names.add(posting[field] || "");
    }
    const sorted = [...names].filter((name) => !nameFilter || name === nameFilter).sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1));
    return sorted.map((name) => ({ label: name || "Not specified", from, to, name, nameField: field }));
  }
  if (by === "total") return [{ label: "Total", from, to }];
  const periods: Period[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    guard += 1;
    const { y, m } = parse(cursor);
    let end: string;
    let label: string;
    if (by === "months") {
      end = endOfMonth(y, m);
      label = `${monthNames[m - 1].slice(0, 3)} ${y}`;
    } else if (by === "quarters") {
      const qEndMonth = Math.floor((m - 1) / 3) * 3 + 3;
      end = endOfMonth(y, qEndMonth);
      label = `Q${qEndMonth / 3} ${y}`;
    } else {
      end = endOfMonth(y, 12);
      label = String(y);
    }
    if (end > to) end = to;
    periods.push({ label, from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return periods;
}

function shiftPeriod(period: Period, compare: Compare): Period {
  if (compare === "py") {
    return { ...period, from: shiftYears(period.from, -1), to: shiftYears(period.to, -1), label: `${periodLabel(shiftYears(period.from, -1), shiftYears(period.to, -1))} (PY)` };
  }
  const length = daysBetween(period.from, period.to) + 1;
  const to = addDays(period.from, -1);
  const from = addDays(to, -(length - 1));
  return { ...period, from, to, label: `${periodLabel(from, to)} (PP)` };
}

function matchesName(posting: Posting, period: Period, nameFilter?: string) {
  if (nameFilter && posting.name !== nameFilter && posting.customer !== nameFilter && posting.supplier !== nameFilter) return false;
  if (period.nameField === undefined) return true;
  return (posting[period.nameField] || "") === (period.name ?? "");
}

/** Sum of postings per account for one column. Balance-sheet columns are cumulative ("as of"). */
function totalsFor(ledger: Ledger, period: Period, asOf: boolean, nameFilter?: string) {
  const totals = new Map<string, number>();
  for (const posting of ledger.postings) {
    if (posting.date > period.to) break;
    if (!asOf && posting.date < period.from) continue;
    if (!matchesName(posting, period, nameFilter)) continue;
    totals.set(posting.account, (totals.get(posting.account) ?? 0) + posting.amount);
  }
  return totals;
}

interface Slot {
  period: Period;
  totals: Map<string, number>;
  /** For P&L-type figures inside a balance sheet (retained earnings, profit for the year). */
  pnlBefore?: Map<string, number>;
  pnlYear?: Map<string, number>;
  fyStart?: string;
}

function buildColumns(periods: Period[], options: ReportOptions) {
  const columns: ReportColumn[] = [];
  /** For each output column: which slot (or derived value) it shows. */
  const plan: Array<{ type: "amount"; slot: number } | { type: "change" | "pct"; cur: number; prev: number } | { type: "pctIncome"; slot: number }> = [];
  const slots: Period[] = [];
  for (const period of periods) {
    const cur = slots.push(period) - 1;
    columns.push({ key: `c${cur}`, label: periods.length === 1 && options.columnsBy === "total" ? "Total" : period.label, kind: "amount" });
    plan.push({ type: "amount", slot: cur });
    if (options.pctOfIncome) {
      columns.push({ key: `p${cur}`, label: "% of income", kind: "pct" });
      plan.push({ type: "pctIncome", slot: cur });
    }
    if (options.compare !== "none") {
      const shifted = shiftPeriod(period, options.compare);
      const prev = slots.push(shifted) - 1;
      columns.push({ key: `c${prev}`, label: shifted.label, kind: "amount" });
      plan.push({ type: "amount", slot: prev });
      if (options.showChange) {
        columns.push({ key: `d${cur}`, label: "Change", kind: "change" });
        plan.push({ type: "change", cur, prev });
      }
      if (options.showPctChange) {
        columns.push({ key: `q${cur}`, label: "% Change", kind: "pct" });
        plan.push({ type: "pct", cur, prev });
      }
    }
  }
  if (periods.length > 1) {
    const from = periods[0].from;
    const to = periods[periods.length - 1].to;
    const total = slots.push({ label: "Total", from, to }) - 1;
    columns.push({ key: `c${total}`, label: "Total", kind: "amount" });
    plan.push({ type: "amount", slot: total });
  }
  return { columns, plan, slots };
}

/** Builds lines from per-slot values, applying the column plan (amounts, change, % change, % of income). */
function materialize(
  plan: ReturnType<typeof buildColumns>["plan"],
  slotValues: number[],
  incomeBySlot: number[],
  slotZooms: (ZoomSpec | null)[],
) {
  const values: (number | null)[] = [];
  const zooms: (ZoomSpec | null)[] = [];
  for (const step of plan) {
    if (step.type === "amount") {
      values.push(slotValues[step.slot]);
      zooms.push(slotZooms[step.slot]);
    } else if (step.type === "pctIncome") {
      const income = incomeBySlot[step.slot];
      values.push(income ? (slotValues[step.slot] / income) * 100 : null);
      zooms.push(null);
    } else if (step.type === "change") {
      values.push(slotValues[step.cur] - slotValues[step.prev]);
      zooms.push(null);
    } else {
      const prev = slotValues[step.prev];
      values.push(prev ? ((slotValues[step.cur] - prev) / Math.abs(prev)) * 100 : null);
      zooms.push(null);
    }
  }
  return { values, zooms };
}

const pnlSections = [
  { id: "income", label: "Income", types: ["Income"], sign: -1 },
  { id: "cos", label: "Cost of Sales", types: ["Cost of sales"], sign: 1 },
  { id: "expenses", label: "Expenses", types: ["Expenses"], sign: 1 },
  { id: "other-income", label: "Other Income", types: ["Other income"], sign: -1 },
  { id: "other-expenses", label: "Other Expenses", types: ["Other expense"], sign: 1 },
] as const;

function pnlSectionOf(account: LedgerAccount) {
  if (account.category === "Income") return account.accountType === "Other income" ? "other-income" : "income";
  if (account.category === "Expense") {
    if (account.accountType === "Cost of sales") return "cos";
    if (account.accountType === "Other expense") return "other-expenses";
    return "expenses";
  }
  return null;
}

function sortAccounts(accounts: LedgerAccount[]) {
  return [...accounts].sort((a, b) => (a.code && b.code ? a.code.localeCompare(b.code, undefined, { numeric: true }) : 0) || a.name.localeCompare(b.name));
}

export function profitAndLoss(ledger: Ledger, options: ReportOptions): ReportResult {
  const periods = splitPeriods(options.from, options.to, options.columnsBy, ledger, options.nameFilter);
  const { columns, plan, slots } = buildColumns(periods, options);
  const data: Slot[] = slots.map((period) => ({ period, totals: totalsFor(ledger, period, false, options.nameFilter) }));
  const zoomFor = (accounts: string[]) => data.map(({ period }) => ({ accounts, from: period.from, to: period.to, name: period.name, nameField: period.nameField }) as ZoomSpec);

  const bySection = new Map<string, LedgerAccount[]>();
  for (const account of ledger.accounts.values()) {
    const section = pnlSectionOf(account);
    if (!section) continue;
    const active = data.some((slot) => Math.abs(slot.totals.get(account.name) ?? 0) > 0.004);
    if (!active && !options.allRows) continue;
    bySection.set(section, [...(bySection.get(section) ?? []), account]);
  }

  const sectionTotal = (id: string) => data.map((slot) => {
    const section = pnlSections.find((item) => item.id === id)!;
    return (bySection.get(id) ?? []).reduce((sum, account) => sum + (slot.totals.get(account.name) ?? 0) * section.sign, 0);
  });
  const income = sectionTotal("income");
  const lines: ReportLine[] = [];
  const add = (line: Omit<ReportLine, "values" | "zooms">, slotValues: number[], accounts: string[] | null) => {
    const { values, zooms } = materialize(plan, slotValues, income, accounts ? zoomFor(accounts) : data.map(() => null));
    lines.push({ ...line, values, zooms });
  };
  const accountsIn = (...ids: string[]) => ids.flatMap((id) => (bySection.get(id) ?? []).map((account) => account.name));

  const addSection = (id: string) => {
    const section = pnlSections.find((item) => item.id === id)!;
    const accounts = sortAccounts(bySection.get(id) ?? []);
    if (!accounts.length && !options.allRows && (id === "other-income" || id === "other-expenses" || id === "cos")) return false;
    lines.push({ id, label: section.label, kind: "section", depth: 0, values: columns.map(() => null) });
    for (const account of accounts) {
      add({ id: `${id}:${account.name}`, parentId: id, label: account.name, kind: "account", depth: 1 }, data.map((slot) => (slot.totals.get(account.name) ?? 0) * section.sign), [account.name]);
    }
    add({ id: `${id}:total`, parentId: id, label: `Total ${section.label}`, kind: "total", depth: 0 }, sectionTotal(id), accountsIn(id));
    return true;
  };

  addSection("income");
  const hasCos = addSection("cos");
  const gross = income.map((value, index) => value - sectionTotal("cos")[index]);
  if (hasCos) add({ id: "gross", label: "Gross Profit", kind: "grand", depth: 0 }, gross, accountsIn("income", "cos"));
  addSection("expenses");
  const operating = gross.map((value, index) => value - sectionTotal("expenses")[index]);
  add({ id: "noi", label: "Net Operating Income", kind: "grand", depth: 0 }, operating, accountsIn("income", "cos", "expenses"));
  const hasOtherIncome = addSection("other-income");
  const hasOtherExpenses = addSection("other-expenses");
  const otherNet = sectionTotal("other-income").map((value, index) => value - sectionTotal("other-expenses")[index]);
  if (hasOtherIncome || hasOtherExpenses) add({ id: "noti", label: "Net Other Income", kind: "grand", depth: 0 }, otherNet, accountsIn("other-income", "other-expenses"));
  add({ id: "net", label: "Net Income", kind: "grand", depth: 0 }, operating.map((value, index) => value + otherNet[index]), accountsIn("income", "cos", "expenses", "other-income", "other-expenses"));

  return { columns, lines, period: periodLabel(options.from, options.to) };
}

/** Net income (credit positive) of the postings in the map. */
function netIncomeOf(ledger: Ledger, totals: Map<string, number>) {
  let net = 0;
  for (const [name, amount] of totals) {
    const category = accountOf(ledger, name).category;
    if (category === "Income" || category === "Expense") net -= amount;
  }
  return net;
}

export function fiscalYearStart(ledger: Ledger, date: string) {
  const { y, m } = parse(date);
  const startYear = m - 1 >= ledger.fiscalYearStartMonth ? y : y - 1;
  return iso(startYear, ledger.fiscalYearStartMonth + 1, 1);
}

const bsGroups = [
  { id: "bank", parent: "current-assets", label: "Bank Accounts", match: (a: LedgerAccount) => a.category === "Asset" && a.accountType === "Cash and cash equivalents" },
  { id: "ar", parent: "current-assets", label: "Accounts Receivable", match: (a: LedgerAccount) => a.category === "Asset" && a.accountType === "Accounts receivable (A/R)" },
  { id: "oca", parent: "current-assets", label: "Other Current Assets", match: (a: LedgerAccount) => a.category === "Asset" && !["Cash and cash equivalents", "Accounts receivable (A/R)", "Fixed assets", "Non-current assets"].includes(a.accountType) },
  { id: "fixed", parent: "assets", label: "Fixed Assets", match: (a: LedgerAccount) => a.category === "Asset" && a.accountType === "Fixed assets" },
  { id: "other-assets", parent: "assets", label: "Other Assets", match: (a: LedgerAccount) => a.category === "Asset" && a.accountType === "Non-current assets" },
  { id: "ap", parent: "current-liabilities", label: "Accounts Payable", match: (a: LedgerAccount) => a.category === "Liability" && a.accountType === "Accounts payable (A/P)" },
  { id: "cards", parent: "current-liabilities", label: "Credit Cards", match: (a: LedgerAccount) => a.category === "Liability" && a.accountType === "Credit card" },
  { id: "ocl", parent: "current-liabilities", label: "Other Current Liabilities", match: (a: LedgerAccount) => a.category === "Liability" && !["Accounts payable (A/P)", "Credit card", "Non-current liabilities"].includes(a.accountType) },
  { id: "ltl", parent: "liabilities", label: "Long-Term Liabilities", match: (a: LedgerAccount) => a.category === "Liability" && a.accountType === "Non-current liabilities" },
] as const;

function asOfPeriods(options: ReportOptions, ledger: Ledger) {
  if (options.columnsBy === "total" || options.columnsBy === "customers" || options.columnsBy === "suppliers") {
    return [{ label: "Total", from: "", to: options.to }];
  }
  return splitPeriods(options.from, options.to, options.columnsBy, ledger).map((period) => ({ ...period, label: period.label, from: "" }));
}

export function balanceSheet(ledger: Ledger, options: ReportOptions): ReportResult {
  const periods = asOfPeriods(options, ledger);
  const columns: ReportColumn[] = [];
  const plan: ReturnType<typeof buildColumns>["plan"] = [];
  const slots: Period[] = [];
  for (const period of periods) {
    const cur = slots.push(period) - 1;
    columns.push({ key: `c${cur}`, label: periods.length === 1 ? `As of ${formatLongDate(period.to)}` : period.label, kind: "amount" });
    plan.push({ type: "amount", slot: cur });
    if (options.compare !== "none") {
      const to = options.compare === "py" ? shiftYears(period.to, -1) : addDays(options.from || period.to, -1);
      const prev = slots.push({ label: `As of ${formatLongDate(to)} (${options.compare === "py" ? "PY" : "PP"})`, from: "", to }) - 1;
      columns.push({ key: `c${prev}`, label: slots[prev].label, kind: "amount" });
      plan.push({ type: "amount", slot: prev });
      if (options.showChange) { columns.push({ key: `d${cur}`, label: "Change", kind: "change" }); plan.push({ type: "change", cur, prev }); }
      if (options.showPctChange) { columns.push({ key: `q${cur}`, label: "% Change", kind: "pct" }); plan.push({ type: "pct", cur, prev }); }
    }
  }

  const data: Slot[] = slots.map((period) => {
    const fyStart = fiscalYearStart(ledger, period.to);
    const before = totalsFor(ledger, { ...period, to: addDays(fyStart, -1) }, true);
    const year = totalsFor(ledger, { ...period, from: fyStart }, false);
    return { period, totals: totalsFor(ledger, period, true), pnlBefore: before, pnlYear: year, fyStart };
  });
  const zero = data.map(() => 0);
  const lines: ReportLine[] = [];
  const add = (line: Omit<ReportLine, "values" | "zooms">, slotValues: number[], zooms: (ZoomSpec | null)[]) => {
    const result = materialize(plan, slotValues, zero, zooms);
    lines.push({ ...line, ...result });
  };
  const asOfZoom = (accounts: string[]) => data.map(({ period }) => ({ accounts, from: "", to: period.to }) as ZoomSpec);
  const active = (account: LedgerAccount) => options.allRows || data.some((slot) => Math.abs(slot.totals.get(account.name) ?? 0) > 0.004);
  const pnlAccounts = [...ledger.accounts.values()].filter((account) => account.category === "Income" || account.category === "Expense").map((account) => account.name);

  const groupLines = (id: string, sign: number, depth: number) => {
    const group = bsGroups.find((item) => item.id === id)!;
    const accounts = sortAccounts([...ledger.accounts.values()].filter((account) => group.match(account) && active(account)));
    const values = data.map((slot) => accounts.reduce((sum, account) => sum + (slot.totals.get(account.name) ?? 0) * sign, 0));
    if (!accounts.length) return { values, names: [] as string[] };
    const parent = group.parent;
    lines.push({ id, parentId: parent, label: group.label, kind: "section", depth, values: columns.map(() => null) });
    for (const account of accounts) add({ id: `${id}:${account.name}`, parentId: id, label: account.name, kind: "account", depth: depth + 1 }, data.map((slot) => (slot.totals.get(account.name) ?? 0) * sign), asOfZoom([account.name]));
    const names = accounts.map((account) => account.name);
    add({ id: `${id}:total`, parentId: id, label: `Total ${group.label}`, kind: "total", depth }, values, asOfZoom(names));
    return { values, names };
  };
  const sum = (...parts: number[][]) => data.map((_, index) => parts.reduce((total, part) => total + part[index], 0));

  lines.push({ id: "assets", label: "Assets", kind: "section", depth: 0, values: columns.map(() => null) });
  lines.push({ id: "current-assets", parentId: "assets", label: "Current Assets", kind: "section", depth: 1, values: columns.map(() => null) });
  const bank = groupLines("bank", 1, 2);
  const ar = groupLines("ar", 1, 2);
  const oca = groupLines("oca", 1, 2);
  const currentAssets = sum(bank.values, ar.values, oca.values);
  add({ id: "current-assets:total", parentId: "current-assets", label: "Total Current Assets", kind: "total", depth: 1 }, currentAssets, asOfZoom([...bank.names, ...ar.names, ...oca.names]));
  const fixed = groupLines("fixed", 1, 1);
  const other = groupLines("other-assets", 1, 1);
  const totalAssets = sum(currentAssets, fixed.values, other.values);
  add({ id: "assets:total", parentId: "assets", label: "Total Assets", kind: "grand", depth: 0 }, totalAssets, asOfZoom([...bank.names, ...ar.names, ...oca.names, ...fixed.names, ...other.names]));

  lines.push({ id: "le", label: "Liabilities and Equity", kind: "section", depth: 0, values: columns.map(() => null) });
  lines.push({ id: "liabilities", parentId: "le", label: "Liabilities", kind: "section", depth: 1, values: columns.map(() => null) });
  lines.push({ id: "current-liabilities", parentId: "liabilities", label: "Current Liabilities", kind: "section", depth: 2, values: columns.map(() => null) });
  const ap = groupLines("ap", -1, 3);
  const cards = groupLines("cards", -1, 3);
  const ocl = groupLines("ocl", -1, 3);
  const currentLiabilities = sum(ap.values, cards.values, ocl.values);
  add({ id: "current-liabilities:total", parentId: "current-liabilities", label: "Total Current Liabilities", kind: "total", depth: 2 }, currentLiabilities, asOfZoom([...ap.names, ...cards.names, ...ocl.names]));
  const ltl = groupLines("ltl", -1, 2);
  const totalLiabilities = sum(currentLiabilities, ltl.values);
  add({ id: "liabilities:total", parentId: "liabilities", label: "Total Liabilities", kind: "total", depth: 1 }, totalLiabilities, asOfZoom([...ap.names, ...cards.names, ...ocl.names, ...ltl.names]));

  lines.push({ id: "equity", parentId: "le", label: "Equity", kind: "section", depth: 1, values: columns.map(() => null) });
  const equityAccounts = sortAccounts([...ledger.accounts.values()].filter((account) => account.category === "Equity" && account.name !== ledger.retainedEarnings && active(account)));
  for (const account of equityAccounts) add({ id: `equity:${account.name}`, parentId: "equity", label: account.name, kind: "account", depth: 2 }, data.map((slot) => -(slot.totals.get(account.name) ?? 0)), asOfZoom([account.name]));
  const retained = data.map((slot) => -(slot.totals.get(ledger.retainedEarnings) ?? 0) + netIncomeOf(ledger, slot.pnlBefore!));
  add({ id: "equity:retained", parentId: "equity", label: "Retained Earnings", kind: "account", depth: 2 }, retained, data.map((slot) => ({ accounts: [ledger.retainedEarnings, ...pnlAccounts], from: "", to: addDays(slot.fyStart!, -1) })));
  const profit = data.map((slot) => netIncomeOf(ledger, slot.pnlYear!));
  add({ id: "equity:profit", parentId: "equity", label: "Profit for the year", kind: "account", depth: 2 }, profit, data.map((slot) => ({ accounts: pnlAccounts, from: slot.fyStart!, to: slot.period.to })));
  const equity = sum(data.map((slot) => equityAccounts.reduce((total, account) => total - (slot.totals.get(account.name) ?? 0), 0)), retained, profit);
  add({ id: "equity:total", parentId: "equity", label: "Total Equity", kind: "total", depth: 1 }, equity, data.map(() => null));
  add({ id: "le:total", parentId: "le", label: "Total Liabilities and Equity", kind: "grand", depth: 0 }, sum(totalLiabilities, equity), data.map(() => null));

  return { columns, lines, period: `As of ${formatLongDate(options.to)}` };
}

export function cashFlows(ledger: Ledger, options: ReportOptions): ReportResult {
  const periods = splitPeriods(options.from, options.to, options.columnsBy === "customers" || options.columnsBy === "suppliers" ? "total" : options.columnsBy, ledger);
  const { columns, plan, slots } = buildColumns(periods, { ...options, pctOfIncome: false });
  const data = slots.map((period) => ({ period, totals: totalsFor(ledger, period, false), opening: totalsFor(ledger, { ...period, to: addDays(period.from, -1) }, true) }));
  const zero = data.map(() => 0);
  const lines: ReportLine[] = [];
  const add = (line: Omit<ReportLine, "values" | "zooms">, values: number[], accounts: string[] | null, asOf = false) => {
    const zooms = data.map(({ period }) => (accounts ? { accounts, from: asOf ? "" : period.from, to: asOf ? addDays(period.from, -1) : period.to } : null));
    lines.push({ ...line, ...materialize(plan, values, zero, zooms) });
  };
  const all = [...ledger.accounts.values()];
  const isCash = (account: LedgerAccount) => account.category === "Asset" && account.accountType === "Cash and cash equivalents";
  const operatingAccounts = all.filter((a) => (a.category === "Asset" && !isCash(a) && !["Fixed assets", "Non-current assets"].includes(a.accountType)) || (a.category === "Liability" && a.accountType !== "Non-current liabilities"));
  const investingAccounts = all.filter((a) => a.category === "Asset" && ["Fixed assets", "Non-current assets"].includes(a.accountType));
  const financingAccounts = all.filter((a) => (a.category === "Liability" && a.accountType === "Non-current liabilities") || a.category === "Equity");
  const pnlAccounts = all.filter((a) => a.category === "Income" || a.category === "Expense").map((a) => a.name);
  const effect = (account: LedgerAccount) => data.map((slot) => -(slot.totals.get(account.name) ?? 0));
  const activeIn = (accounts: LedgerAccount[]) => sortAccounts(accounts.filter((account) => options.allRows || effect(account).some((value) => Math.abs(value) > 0.004)));
  const sumOf = (accounts: LedgerAccount[]) => data.map((_, index) => accounts.reduce((total, account) => total + effect(account)[index], 0));

  const netIncome = data.map((slot) => netIncomeOf(ledger, slot.totals));
  lines.push({ id: "op", label: "Operating Activities", kind: "section", depth: 0, values: columns.map(() => null) });
  add({ id: "op:ni", parentId: "op", label: "Net Income", kind: "account", depth: 1 }, netIncome, pnlAccounts);
  const operating = activeIn(operatingAccounts);
  if (operating.length) {
    lines.push({ id: "adj", parentId: "op", label: "Adjustments to reconcile Net Income to Net Cash provided by operations:", kind: "section", depth: 1, values: columns.map(() => null) });
    for (const account of operating) add({ id: `adj:${account.name}`, parentId: "adj", label: account.name, kind: "account", depth: 2 }, effect(account), [account.name]);
    add({ id: "adj:total", parentId: "adj", label: "Total Adjustments to reconcile Net Income to Net Cash provided by operations:", kind: "total", depth: 1 }, sumOf(operating), operating.map((a) => a.name));
  }
  const operatingTotal = netIncome.map((value, index) => value + sumOf(operating)[index]);
  add({ id: "op:total", parentId: "op", label: "Net cash provided by operating activities", kind: "total", depth: 0 }, operatingTotal, null);

  const section = (id: string, label: string, accounts: LedgerAccount[]) => {
    const active = activeIn(accounts);
    if (!active.length) return zero;
    lines.push({ id, label, kind: "section", depth: 0, values: columns.map(() => null) });
    for (const account of active) add({ id: `${id}:${account.name}`, parentId: id, label: account.name, kind: "account", depth: 1 }, effect(account), [account.name]);
    const total = sumOf(active);
    add({ id: `${id}:total`, parentId: id, label: `Net cash provided by ${label.toLowerCase()}`, kind: "total", depth: 0 }, total, active.map((a) => a.name));
    return total;
  };
  const investing = section("inv", "Investing Activities", investingAccounts);
  const financing = section("fin", "Financing Activities", financingAccounts);
  const increase = data.map((_, index) => operatingTotal[index] + investing[index] + financing[index]);
  add({ id: "net", label: "Net cash increase for period", kind: "grand", depth: 0 }, increase, null);
  const cashNames = all.filter(isCash).map((a) => a.name);
  const opening = data.map((slot) => cashNames.reduce((total, name) => total + (slot.opening.get(name) ?? 0), 0));
  add({ id: "begin", label: "Cash at beginning of period", kind: "account", depth: 0 }, opening, cashNames, true);
  add({ id: "end", label: "Cash at end of period", kind: "grand", depth: 0 }, opening.map((value, index) => value + increase[index]), null);
  return { columns, lines, period: periodLabel(options.from, options.to) };
}

/** Normal-balance sign: income, liabilities and equity show credits as positive. */
function displaySign(ledger: Ledger, account: string) {
  const category = accountOf(ledger, account).category;
  return category === "Asset" || category === "Expense" ? 1 : -1;
}

const detailColumns: ReportColumn[] = [
  { key: "date", label: "Date", kind: "text" },
  { key: "type", label: "Transaction type", kind: "text" },
  { key: "no", label: "No.", kind: "text" },
  { key: "name", label: "Name", kind: "text" },
  { key: "memo", label: "Memo/Description", kind: "text" },
  { key: "split", label: "Split", kind: "text" },
  { key: "amount", label: "Amount", kind: "amount" },
  { key: "balance", label: "Balance", kind: "amount" },
];

/**
 * Transaction lists grouped by account (P&L Detail, Balance Sheet Detail, and
 * the QuickZoom transaction report behind any amount).
 */
export function transactionDetail(ledger: Ledger, zoom: ZoomSpec, withBeginning: boolean): ReportResult {
  const wanted = new Set(zoom.accounts);
  const byTxn = new Map<string, Posting[]>();
  for (const posting of ledger.postings) byTxn.set(posting.txnId, [...(byTxn.get(posting.txnId) ?? []), posting]);
  const field = zoom.nameField;
  const matches = (posting: Posting) => !zoom.name && zoom.name !== "" ? true : field ? (posting[field] || "") === zoom.name : posting.name === zoom.name;

  const ordered = sortAccounts(zoom.accounts.map((name) => accountOf(ledger, name)));
  const order = ["Asset", "Liability", "Equity", "Income", "Expense"];
  ordered.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  const lines: ReportLine[] = [];
  for (const account of ordered) {
    if (!wanted.has(account.name)) continue;
    const sign = displaySign(ledger, account.name);
    let balance = 0;
    const rows: ReportLine[] = [];
    if (withBeginning && zoom.from) {
      balance = ledger.postings.filter((posting) => posting.account === account.name && posting.date < zoom.from && (zoom.name === undefined || matches(posting))).reduce((sum, posting) => sum + posting.amount * sign, 0);
      if (Math.abs(balance) > 0.004) rows.push({ id: `${account.name}:begin`, parentId: account.name, label: "Beginning Balance", kind: "account", depth: 1, values: ["", "", "", "", "", "", null, balance] });
    }
    let total = 0;
    for (const posting of ledger.postings) {
      if (posting.account !== account.name) continue;
      if (posting.date > zoom.to || (zoom.from && posting.date < zoom.from)) continue;
      if (zoom.name !== undefined && !matches(posting)) continue;
      const amount = posting.amount * sign;
      balance += amount;
      total += amount;
      const others = (byTxn.get(posting.txnId) ?? []).filter((other) => other.account !== posting.account);
      const split = [...new Set(others.map((other) => other.account))];
      rows.push({
        id: `${account.name}:${posting.txnId}:${rows.length}`,
        parentId: account.name,
        label: "",
        kind: "account",
        depth: 1,
        values: [posting.date, posting.type, posting.number, posting.name, posting.memo, split.length > 1 ? "-Split-" : split[0] ?? "", amount, balance],
        source: { kind: posting.sourceKind, id: posting.sourceId },
      });
    }
    if (!rows.length) continue;
    lines.push({ id: account.name, label: account.name, kind: "section", depth: 0, values: detailColumns.map(() => null) });
    lines.push(...rows);
    lines.push({ id: `${account.name}:total`, parentId: account.name, label: `Total for ${account.name}`, kind: "total", depth: 0, values: ["", "", "", "", "", "", total, null] });
  }
  return { columns: detailColumns, lines, period: zoom.from ? periodLabel(zoom.from, zoom.to) : `As of ${formatLongDate(zoom.to)}`, empty: "No transactions match this report." };
}

export function pnlAccountNames(ledger: Ledger) {
  return [...ledger.accounts.values()].filter((account) => account.category === "Income" || account.category === "Expense").map((account) => account.name);
}

export function balanceSheetAccountNames(ledger: Ledger) {
  return [...ledger.accounts.values()].filter((account) => account.category === "Asset" || account.category === "Liability" || account.category === "Equity").map((account) => account.name);
}

export function trialBalance(ledger: Ledger, options: ReportOptions): ReportResult {
  const totals = totalsFor(ledger, { label: "", from: "", to: options.to }, true);
  const columns: ReportColumn[] = [{ key: "debit", label: "Debit", kind: "amount" }, { key: "credit", label: "Credit", kind: "amount" }];
  const lines: ReportLine[] = [];
  let debit = 0;
  let credit = 0;
  const order = ["Asset", "Liability", "Equity", "Income", "Expense"];
  const accounts = sortAccounts([...ledger.accounts.values()]).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  for (const account of accounts) {
    const balance = totals.get(account.name) ?? 0;
    if (Math.abs(balance) < 0.005 && !options.allRows) continue;
    const zoom: ZoomSpec = { accounts: [account.name], from: "", to: options.to };
    lines.push({ id: account.name, label: account.name, kind: "account", depth: 0, values: [balance > 0 ? balance : null, balance < 0 ? -balance : null], zooms: [zoom, zoom] });
    if (balance > 0) debit += balance; else credit -= balance;
  }
  lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [debit, credit] });
  return { columns, lines, period: `As of ${formatLongDate(options.to)}` };
}

/** Sales by Customer Summary: income by customer, in the chosen columns. */
export function salesByCustomer(ledger: Ledger, options: ReportOptions): ReportResult {
  const columnsBy = options.columnsBy === "customers" || options.columnsBy === "suppliers" ? "total" : options.columnsBy;
  const periods = splitPeriods(options.from, options.to, columnsBy, ledger);
  const { columns, plan, slots } = buildColumns(periods, { ...options, pctOfIncome: false });
  const incomeAccounts = [...ledger.accounts.values()].filter((account) => account.category === "Income").map((account) => account.name);
  const incomeSet = new Set(incomeAccounts);
  const customers = new Set<string>();
  const sums = slots.map((period) => {
    const map = new Map<string, number>();
    for (const posting of ledger.postings) {
      if (posting.date < period.from || posting.date > period.to || !incomeSet.has(posting.account)) continue;
      customers.add(posting.customer);
      map.set(posting.customer, (map.get(posting.customer) ?? 0) - posting.amount);
    }
    return map;
  });
  const zero = slots.map(() => 0);
  const lines: ReportLine[] = [];
  for (const customer of [...customers].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1))) {
    const values = sums.map((map) => map.get(customer) ?? 0);
    const zooms = slots.map((period) => ({ accounts: incomeAccounts, from: period.from, to: period.to, name: customer, nameField: "customer" as const }));
    lines.push({ id: customer || "none", label: customer || "Not specified", kind: "account", depth: 0, ...materialize(plan, values, zero, zooms) });
  }
  const totals = sums.map((map) => [...map.values()].reduce((sum, value) => sum + value, 0));
  lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, ...materialize(plan, totals, zero, slots.map((period) => ({ accounts: incomeAccounts, from: period.from, to: period.to })) ) });
  return { columns, lines, period: periodLabel(options.from, options.to), empty: "No sales in this period." };
}

const ageingBuckets = ["Current", "1 - 30", "31 - 60", "61 - 90", "91 and over"];

/** A/R or A/P ageing by customer or supplier, as of the report date. */
export function ageingSummary(records: BookkeepingRecord[], ledger: Ledger, side: "receivable" | "payable", options: ReportOptions): ReportResult {
  const asOf = options.to;
  const kind = side === "receivable" ? "invoices" : "bills";
  const paidUpTo = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== "payments") continue;
    const target = side === "receivable" ? record.data.invoiceId : record.data.billId;
    if (!target || (record.data.paymentDate || "") > asOf) continue;
    paidUpTo.set(target, (paidUpTo.get(target) ?? 0) + (Number(record.data.amount) || 0));
  }
  const parties = new Map<string, number[]>();
  for (const record of records) {
    if (record.kind !== kind || ["Draft", "Cancelled", "Void"].includes(record.data.status ?? "")) continue;
    const date = (side === "receivable" ? record.data.issueDate : record.data.billDate) || record.createdAt.slice(0, 10);
    if (date > asOf) continue;
    const rate = record.data.currency && record.data.exchangeRate && Number(record.data.exchangeRate) > 0 ? Number(record.data.exchangeRate) : 1;
    const recorded = paidUpTo.get(record.id);
    const paid = recorded ?? (Number(record.data.paidAmount) || 0);
    const open = ((Number(record.data.amount) || 0) - paid - (Number(record.data.creditApplied) || 0)) * rate;
    if (open < 0.005) continue;
    const due = record.data.dueDate || date;
    const late = daysBetween(due, asOf);
    const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    const party = (side === "receivable" ? record.data.customer : record.data.vendor) || "Not specified";
    const row = parties.get(party) ?? [0, 0, 0, 0, 0];
    row[bucket] += open;
    parties.set(party, row);
  }
  const account = side === "receivable" ? ledger.ar : ledger.ap;
  const columns: ReportColumn[] = [...ageingBuckets, "Total"].map((label, index) => ({ key: `b${index}`, label, kind: "amount" }));
  const lines: ReportLine[] = [];
  const totals = [0, 0, 0, 0, 0];
  for (const [party, row] of [...parties.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    row.forEach((value, index) => { totals[index] += value; });
    const zoom: ZoomSpec = { accounts: [account], from: "", to: asOf, name: party === "Not specified" ? "" : party, nameField: "name" };
    lines.push({ id: party, label: party, kind: "account", depth: 0, values: [...row, row.reduce((a, b) => a + b, 0)], zooms: [...row.map(() => zoom), zoom] });
  }
  lines.push({ id: "total", label: "TOTAL", kind: "grand", depth: 0, values: [...totals, totals.reduce((a, b) => a + b, 0)] });
  return { columns, lines, period: `As of ${formatLongDate(asOf)}`, empty: side === "receivable" ? "No customer owes you money on this date." : "You owe no supplier money on this date." };
}

/** Tax collected on sales, tax paid on purchases, and what is left to pay. */
export function taxSummary(ledger: Ledger, options: ReportOptions): ReportResult {
  let collected = 0;
  let paid = 0;
  for (const posting of ledger.postings) {
    if (posting.account !== ledger.salesTax || posting.date < options.from || posting.date > options.to) continue;
    if (posting.amount < 0) collected -= posting.amount; else paid += posting.amount;
  }
  const zoom: ZoomSpec = { accounts: [ledger.salesTax], from: options.from, to: options.to };
  return {
    columns: [{ key: "amount", label: "Amount", kind: "amount" }],
    lines: [
      { id: "collected", label: "Tax collected on sales", kind: "account", depth: 0, values: [collected], zooms: [zoom] },
      { id: "paid", label: "Tax paid on purchases", kind: "account", depth: 0, values: [paid], zooms: [zoom] },
      { id: "net", label: "Net tax payable", kind: "grand", depth: 0, values: [collected - paid], zooms: [zoom] },
    ],
    period: periodLabel(options.from, options.to),
  };
}

export function earliestDate(ledger: Ledger) {
  return ledger.postings[0]?.date ?? "";
}
