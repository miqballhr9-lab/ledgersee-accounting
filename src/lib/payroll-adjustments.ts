/**
 * What HR changes in a month's salary: unpaid time off and absences come off the
 * worked days, and running salary attachments set the loan deduction. Used by the
 * payroll sheet and by the monthly payroll automation, so both agree.
 */

type Row = { data: Record<string, string> };

function money(value: string | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function dates(from: string, to: string) {
  const list: string[] = [];
  const day = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (day <= end && list.length < 400) {
    list.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return list;
}

const running = (status: string | undefined) => status === "Running" || status === "Approved";

export function payrollAdjustments(month: string, employee: { id?: string; name?: string }, leaves: Row[], loans: Row[], attendance: Row[] = [], weekend: number[] = [0]) {
  const matches = (data: Record<string, string>) => Boolean((employee.id && data.employeeId === employee.id) || (data.employee && data.employee === employee.name));
  const unpaidDates = new Set<string>();
  let unpaidDays = 0;
  for (const row of leaves) {
    if (row.data.status !== "Approved" || row.data.paid !== "false" || !matches(row.data) || !row.data.fromDate) continue;
    for (const date of dates(row.data.fromDate, row.data.toDate || row.data.fromDate)) {
      if (!date.startsWith(month) || weekend.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
      unpaidDates.add(date);
      unpaidDays += row.data.halfDay === "true" ? 0.5 : 1;
    }
  }
  // Days marked absent on the attendance sheet, not already counted as unpaid time off.
  const absentDays = new Set(attendance
    .filter((row) => row.data.status === "Absent" && (row.data.date ?? "").startsWith(month) && matches(row.data) && !unpaidDates.has(row.data.date))
    .map((row) => row.data.date)).size;
  const loanDeduction = loans
    .filter((row) => running(row.data.status) && matches(row.data) && (!row.data.startMonth || row.data.startMonth <= month))
    .reduce((sum, row) => sum + Math.min(money(row.data.monthlyInstallment), money(row.data.balance)), 0);
  const hasLoans = loans.some((row) => matches(row.data));
  const overtimeHours = attendance.filter((row) => (row.data.date ?? "").startsWith(month) && matches(row.data)).reduce((sum, row) => sum + money(row.data.overtimeHours), 0);
  return { unpaidDays, absentDays, loanDeduction: Math.round(loanDeduction * 100) / 100, hasLoans, overtimeHours: Math.round(overtimeHours * 100) / 100 };
}

/** Worked days after unpaid time off and absences, never below zero. */
export function adjustedWorkedDays(workingDays: string, adjustments: { unpaidDays: number; absentDays: number }) {
  const off = adjustments.unpaidDays + adjustments.absentDays;
  return off > 0 ? String(Math.max(0, Math.ceil(Number(workingDays || 0) - off))) : workingDays;
}

/** The sheet columns a salary rule can fill, by the names people use for them. */
const ruleColumns: Record<string, string> = {
  incentive: "incentive", bonus: "incentive", gym: "gymAllowance", "gym allowance": "gymAllowance", medical: "medicalAllowance", "medical allowance": "medicalAllowance",
  other: "otherAllowance", "other allowance": "otherAllowance", "house rent": "otherAllowance", conveyance: "otherAllowance",
  fine: "fineDeduction", "eobi / pf": "socialDeduction", eobi: "socialDeduction", pf: "socialDeduction", "provident fund": "socialDeduction", "social security": "socialDeduction",
  "other adjustment": "adjustment", adjustment: "adjustment",
};

export interface SalaryRule {
  column: string;
  /** A percentage of the base salary, or a fixed amount. */
  percent: number | null;
  amount: number;
  /** Only for this department, when set. */
  department: string;
}

/**
 * Salary rules from Settings, one per line, like Odoo's salary structure:
 * "Medical = 10% of basic", "Gym = 2000", "EOBI / PF = 1% of basic for Sales".
 * Lines that can't be read are skipped.
 */
export function parseSalaryRules(text: string | undefined): SalaryRule[] {
  return (text ?? "").split("\n").flatMap((line): SalaryRule[] => {
    const match = /^\s*([^=]+?)\s*=\s*([\d.]+)\s*(%\s*(?:of\s*basic)?)?\s*(?:for\s+(.+?))?\s*$/i.exec(line);
    if (!match) return [];
    const column = ruleColumns[match[1].trim().toLowerCase()];
    const value = Number(match[2]);
    if (!column || !Number.isFinite(value) || value < 0) return [];
    return [{ column, percent: match[3] ? value : null, amount: match[3] ? 0 : value, department: match[4]?.trim() ?? "" }];
  });
}

/** The amounts the rules give one employee, by sheet column. Later lines for the same column add up. */
export function salaryRuleAmounts(rules: SalaryRule[], baseSalary: number, department: string | undefined): Record<string, string> {
  const totals: Record<string, number> = {};
  for (const rule of rules) {
    if (rule.department && rule.department.toLowerCase() !== (department ?? "").trim().toLowerCase()) continue;
    const value = rule.percent !== null ? (baseSalary * rule.percent) / 100 : rule.amount;
    totals[rule.column] = (totals[rule.column] ?? 0) + value;
  }
  return Object.fromEntries(Object.entries(totals).filter(([, value]) => value > 0).map(([column, value]) => [column, (Math.round(value * 100) / 100).toFixed(2)]));
}
