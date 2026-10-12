import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";

/**
 * The working-out behind HR records: leave days and balances, attendance hours,
 * loan installments, appraisal scores and final settlements, plus what happens
 * after some saves (a hired candidate becomes an employee; a settled employee
 * becomes inactive). Called from the shared CRM/HR save action.
 */

type StoredRow = typeof bookkeepingRecord.$inferSelect;
export interface HrContext {
  byKind: (kind: string) => StoredRow[];
  actor: string;
}

function money(value: string | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function fixed(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function minutes(time: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time?.trim() ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  return hours < 24 && mins < 60 ? hours * 60 + mins : null;
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

/** Working days in a leave: Sundays and holidays don't count. */
export function leaveDays(from: string, to: string, halfDay: boolean, holidays: string[]) {
  const counted = dates(from, to).filter((date) => new Date(`${date}T12:00:00Z`).getUTCDay() !== 0 && !holidays.includes(date)).length;
  return halfDay && from === to ? Math.min(counted, 0.5) : counted;
}

function sameEmployee(a: Record<string, string>, b: Record<string, string>) {
  return (a.employeeId && a.employeeId === b.employeeId) || (!a.employeeId && a.employee && a.employee === b.employee);
}

/** Days of a leave type an employee has already been approved for in a year. */
export function leaveUsed(leaves: StoredRow[], data: Record<string, string>, year: string, exceptId?: string) {
  return leaves
    .filter((row) => row.id !== exceptId && row.data.status === "Approved" && sameEmployee(row.data, data) && row.data.leaveTypeId === data.leaveTypeId && (row.data.fromDate ?? "").startsWith(year))
    .reduce((sum, row) => sum + money(row.data.days), 0);
}

/** Fills in and checks the calculated parts of an HR record before it is saved. */
export function applyHrRules(kind: string, data: Record<string, string>, existing: Record<string, string> | undefined, context: HrContext, id?: string) {
  if (kind === "hr-attendance") {
    const start = minutes(data.checkIn);
    const end = minutes(data.checkOut);
    if (data.checkIn && start === null) throw new ActionError("Enter check in as a time, e.g. 09:00.");
    if (data.checkOut && end === null) throw new ActionError("Enter check out as a time, e.g. 17:30.");
    data.hoursWorked = start !== null && end !== null && end > start ? String(Math.round(((end - start) / 60) * 100) / 100) : "";
    if (!data.status) data.status = "Present";
    const duplicate = context.byKind("hr-attendance").some((row) => row.id !== id && row.data.date === data.date && sameEmployee(row.data, data));
    if (duplicate) throw new ActionError(`${data.employee} already has attendance for ${data.date}.`);
  }

  if (kind === "hr-leaves") {
    if (data.toDate < data.fromDate) throw new ActionError("The leave can’t end before it starts.");
    const holidays = context.byKind("hr-holidays").map((row) => row.data.date).filter(Boolean);
    const days = leaveDays(data.fromDate, data.toDate, data.halfDay === "true", holidays);
    if (!days) throw new ActionError("Those dates are all Sundays or holidays, so no leave is needed.");
    data.days = String(days);
    if (!data.status) data.status = "Pending";
    const overlapping = context.byKind("hr-leaves").find((row) => row.id !== id && ["Pending", "Approved"].includes(row.data.status ?? "") && sameEmployee(row.data, data) && row.data.fromDate <= data.toDate && row.data.toDate >= data.fromDate);
    if (overlapping && data.status !== "Rejected" && data.status !== "Cancelled") throw new ActionError(`${data.employee} already has leave from ${overlapping.data.fromDate} to ${overlapping.data.toDate}.`);
    if (data.status === "Approved" && existing?.status !== "Approved") {
      const type = context.byKind("hr-leave-types").find((row) => row.id === data.leaveTypeId);
      const allowance = money(type?.data.daysPerYear);
      const used = leaveUsed(context.byKind("hr-leaves"), data, data.fromDate.slice(0, 4), id);
      if (type && allowance > 0 && used + days > allowance) {
        throw new ActionError(`${data.employee} has ${Math.max(0, allowance - used)} of ${allowance} ${type.data.leaveName} days left this year, so ${days} can’t be approved.`);
      }
      data.approvedBy = context.actor;
      data.approvedOn = new Date().toISOString().slice(0, 10);
      data.paid = type?.data.paid === "false" ? "false" : "true";
    }
    if (data.status !== "Approved") data.approvedBy = data.status === "Rejected" ? `Rejected by ${context.actor}` : "";
  }

  if (kind === "hr-loans") {
    const amount = money(data.amount);
    const installments = Math.max(1, Math.round(money(data.installments)));
    if (amount <= 0) throw new ActionError("Enter the loan amount.");
    data.installments = String(installments);
    data.monthlyInstallment = fixed(amount / installments);
    const repaid = Math.min(amount, money(data.repaidAmount));
    data.repaidAmount = fixed(repaid);
    data.balance = fixed(amount - repaid);
    if (!data.status) data.status = "Requested";
    if (data.status === "Approved" && amount - repaid <= 0) data.status = "Repaid";
    if (!data.startMonth && data.status === "Approved") {
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + 1);
      data.startMonth = next.toISOString().slice(0, 7);
    }
    if (data.startMonth && !/^\d{4}-\d{2}$/.test(data.startMonth)) throw new ActionError("Enter the first deduction month as YYYY-MM.");
  }

  if (kind === "hr-claims" && !data.status) data.status = "Submitted";

  if (kind === "hr-appraisals") {
    const ratings = ["qualityRating", "productivityRating", "teamworkRating", "punctualityRating"].map((key) => money(data[key])).filter((value) => value > 0);
    data.overallRating = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : "";
    if (!data.status) data.status = "Draft";
  }

  if (kind === "hr-settlements") {
    const employee = context.byKind("employees").find((row) => row.id === data.employeeId);
    if (!data.monthlySalary && employee?.data.baseSalary) data.monthlySalary = fixed(money(employee.data.baseSalary));
    if (!data.joiningDate && employee?.data.joiningDate) data.joiningDate = employee.data.joiningDate;
    if (!existing && !data.loanRecovery) {
      const open = context.byKind("hr-loans").filter((row) => row.data.status === "Approved" && sameEmployee(row.data, data));
      data.loanRecovery = fixed(open.reduce((sum, row) => sum + money(row.data.balance), 0));
    }
    if (!data.gratuityDaysPerYear) data.gratuityDaysPerYear = "30";
    const daily = money(data.monthlySalary) / 30;
    let years = 0;
    if (data.joiningDate && data.lastWorkingDay && data.lastWorkingDay > data.joiningDate) {
      const months = (new Date(data.lastWorkingDay).getTime() - new Date(data.joiningDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
      // A part year of six months or more counts as a full year, as is usual for gratuity.
      years = Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
    }
    const gratuity = daily * money(data.gratuityDaysPerYear) * years;
    const gross = daily * money(data.pendingSalaryDays) + daily * money(data.leaveEncashmentDays) + gratuity + money(data.bonus);
    data.serviceYears = String(years);
    data.gratuity = fixed(gratuity);
    data.grossPayable = fixed(gross);
    data.netPayable = fixed(gross - money(data.loanRecovery) - money(data.otherDeductions));
    if (!data.status) data.status = "Draft";
  }
}

async function nextEmployeeId(userId: string) {
  const employees = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "employees")));
  const highest = employees.reduce((max, row) => Math.max(max, Number((row.data.employeeId ?? "").replace(/\D/g, "")) || 0), 0);
  return `EMP-${String(highest + 1).padStart(3, "0")}`;
}

const onboardingChecklist = [
  "Collect CNIC copy and educational certificates",
  "Sign employment contract and offer letter",
  "Collect bank account details for salary",
  "Set up email, system access and tools",
  "Introduce to the team and assign a buddy",
  "Explain company policies and leave rules",
  "First-week check-in with the manager",
];

/** What some saves set off elsewhere. Returns a note for the toast, if any. */
export async function afterHrSave(userId: string, kind: string, before: Record<string, string> | undefined, after: StoredRow): Promise<string | undefined> {
  const data = after.data;
  if (kind === "hr-candidates" && data.stage === "Hired" && before?.stage !== "Hired" && !data.hiredEmployeeId) {
    const employeeId = await nextEmployeeId(userId);
    const today = new Date().toISOString().slice(0, 10);
    const [employee] = await db.insert(bookkeepingRecord).values({
      userId,
      kind: "employees",
      data: {
        employeeId,
        name: data.candidateName,
        email: data.email ?? "",
        mobile: data.phone ?? "",
        designation: data.job ?? "",
        joiningDate: today,
        baseSalary: data.expectedSalary || "0",
        status: "Active",
        cnic: "",
        notes: "Hired from recruitment.",
      },
    }).returning();
    for (const [index, task] of onboardingChecklist.entries()) {
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + (index < 3 ? 0 : 7));
      await db.insert(bookkeepingRecord).values({
        userId,
        kind: "hr-onboarding",
        data: { employee: data.candidateName, employeeId: employee.id, task, dueDate: due.toISOString().slice(0, 10), status: "Not Started" },
      });
    }
    await db.update(bookkeepingRecord).set({ data: { ...data, hiredEmployeeId: employee.id } }).where(eq(bookkeepingRecord.id, after.id));
    return `${data.candidateName} added to Employees as ${employeeId}, with an onboarding checklist.`;
  }
  if (kind === "hr-settlements" && data.status === "Approved" && before?.status !== "Approved" && data.employeeId) {
    const [employee] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, data.employeeId), eq(bookkeepingRecord.userId, userId))).limit(1);
    if (employee) {
      await db.update(bookkeepingRecord).set({ data: { ...employee.data, status: "Inactive", leavingDate: data.lastWorkingDay ?? "" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, employee.id));
      return `${employee.data.name} is now marked inactive.`;
    }
  }
  return undefined;
}

/** For payroll: approved unpaid leave days and loan installments due for an employee in a month. */
export function payrollAdjustments(month: string, employee: { id?: string; employeeId?: string; name?: string }, leaves: StoredRow[], loans: StoredRow[]) {
  const matches = (data: Record<string, string>) => (employee.id && data.employeeId === employee.id) || (data.employee && data.employee === employee.name);
  const unpaidDays = leaves
    .filter((row) => row.data.status === "Approved" && row.data.paid === "false" && matches(row.data) && (row.data.fromDate ?? "").slice(0, 7) <= month && (row.data.toDate ?? "").slice(0, 7) >= month)
    .reduce((sum, row) => sum + dates(row.data.fromDate, row.data.toDate).filter((date) => date.startsWith(month) && new Date(`${date}T12:00:00Z`).getUTCDay() !== 0).length * (row.data.halfDay === "true" ? 0.5 : 1), 0);
  const loanDeduction = loans
    .filter((row) => row.data.status === "Approved" && matches(row.data) && (!row.data.startMonth || row.data.startMonth <= month))
    .reduce((sum, row) => sum + Math.min(money(row.data.monthlyInstallment), money(row.data.balance)), 0);
  return { unpaidDays, loanDeduction: Math.round(loanDeduction * 100) / 100 };
}

/**
 * When a salary with a loan deduction is paid, the deduction pays down the
 * employee's approved loans, oldest first; undoing the payment puts it back.
 */
export async function applyLoanRepayment(userId: string, payroll: Record<string, string>, direction: 1 | -1) {
  let remaining = money(payroll.loanDeduction);
  if (remaining <= 0) return;
  const loans = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-loans"))))
    .filter((row) => (row.data.employee === payroll.employeeName) && (direction === 1 ? row.data.status === "Approved" : ["Approved", "Repaid"].includes(row.data.status ?? "")))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (direction === -1) loans.reverse();
  for (const loan of loans) {
    if (remaining <= 0) break;
    const amount = money(loan.data.amount);
    const repaid = money(loan.data.repaidAmount);
    const change = direction === 1 ? Math.min(remaining, amount - repaid) : Math.min(remaining, repaid);
    if (change <= 0) continue;
    remaining -= change;
    const nextRepaid = repaid + change * direction;
    await db.update(bookkeepingRecord).set({
      data: { ...loan.data, repaidAmount: fixed(nextRepaid), balance: fixed(amount - nextRepaid), status: amount - nextRepaid <= 0.004 ? "Repaid" : "Approved" },
      updatedAt: new Date(),
    }).where(eq(bookkeepingRecord.id, loan.id));
  }
}
