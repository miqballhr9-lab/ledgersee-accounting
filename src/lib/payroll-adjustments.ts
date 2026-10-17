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
