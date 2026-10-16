import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { isCompletedAttachment, isHiredStage, isRunningAttachment, isToApprove, odooHrData } from "@/lib/hr-status";

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

/** Every public holiday date, a holiday with an end date counting each day. */
export function holidayDates(holidays: StoredRow[]) {
  return holidays.flatMap((row) => (row.data.date ? dates(row.data.date, row.data.endDate && row.data.endDate > row.data.date ? row.data.endDate : row.data.date) : []));
}

/**
 * Days of a time off type an employee may take in a year: their approved allocations
 * valid that year, else the type's days a year; null when the type has no limit.
 */
export function timeOffAllowance(context: HrContext, data: Record<string, string>, year: string) {
  const type = context.byKind("hr-leave-types").find((row) => row.id === data.leaveTypeId);
  if (!type) return null;
  const allocations = context.byKind("hr-allocations").filter((row) => row.data.status === "Approved" && sameEmployee(row.data, data) && row.data.leaveTypeId === data.leaveTypeId
    && (row.data.validFrom ?? "") <= `${year}-12-31` && (!row.data.validTo || row.data.validTo >= `${year}-01-01`));
  if (allocations.length) return allocations.reduce((sum, row) => sum + money(row.data.days), 0);
  if (type.data.requiresAllocation === "No limit") return null;
  return money(type.data.daysPerYear);
}

/** Fills in and checks the calculated parts of an HR record before it is saved. */
export function applyHrRules(kind: string, data: Record<string, string>, existingData: Record<string, string> | undefined, context: HrContext, id?: string) {
  // States are stored under their Odoo names; older records are moved over as they are saved.
  Object.assign(data, odooHrData(kind, data));
  const existing = existingData ? odooHrData(kind, existingData) : undefined;
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
    const holidays = holidayDates(context.byKind("hr-holidays"));
    const days = leaveDays(data.fromDate, data.toDate, data.halfDay === "true", holidays);
    if (!days) throw new ActionError("Those dates are all Sundays or public holidays, so no time off is needed.");
    data.days = String(days);
    const type = context.byKind("hr-leave-types").find((row) => row.id === data.leaveTypeId);
    // As in Odoo, a type with no validation is approved as soon as it is asked for.
    if (!data.status) data.status = !existing && type?.data.approval === "No validation" ? "Approved" : "To Approve";
    const overlapping = context.byKind("hr-leaves").find((row) => row.id !== id && (isToApprove(row.data.status) || row.data.status === "Approved") && sameEmployee(row.data, data) && row.data.fromDate <= data.toDate && row.data.toDate >= data.fromDate);
    if (overlapping && data.status !== "Refused" && data.status !== "Cancelled") throw new ActionError(`${data.employee} already has time off from ${overlapping.data.fromDate} to ${overlapping.data.toDate}.`);
    if (data.status === "Approved" && existing?.status !== "Approved") {
      const allowance = timeOffAllowance(context, data, data.fromDate.slice(0, 4));
      const used = leaveUsed(context.byKind("hr-leaves"), data, data.fromDate.slice(0, 4), id);
      if (type && allowance !== null && used + days > allowance) {
        throw new ActionError(allowance > 0
          ? `${data.employee} has ${Math.max(0, allowance - used)} of ${allowance} ${type.data.leaveName} days left this year, so ${days} can’t be approved.`
          : `${data.employee} has no ${type.data.leaveName} allocation. Add one in Allocations first.`);
      }
      data.approvedBy = context.actor;
      data.approvedOn = new Date().toISOString().slice(0, 10);
      data.paid = type?.data.paid === "false" ? "false" : "true";
    }
    if (data.status !== "Approved") data.approvedBy = data.status === "Refused" ? `Refused by ${context.actor}` : "";
  }

  if (kind === "hr-allocations") {
    const days = money(data.days);
    if (days <= 0) throw new ActionError("Enter the number of days to allocate.");
    if (data.validTo && data.validFrom && data.validTo < data.validFrom) throw new ActionError("The validity can’t end before it starts.");
    data.days = String(days);
    if (!data.status) data.status = "To Approve";
    if (data.status === "Approved" && existing?.status !== "Approved") data.approvedBy = context.actor;
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
    if (!data.status) data.status = "To Approve";
    if (isRunningAttachment(data.status) && amount - repaid <= 0) data.status = "Completed";
    if (!data.startMonth && isRunningAttachment(data.status)) {
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + 1);
      data.startMonth = next.toISOString().slice(0, 7);
    }
    if (data.startMonth && !/^\d{4}-\d{2}$/.test(data.startMonth)) throw new ActionError("Enter the first deduction month as YYYY-MM.");
  }

  if (kind === "hr-claims") {
    if (!data.status) data.status = "To Submit";
    if (!data.paidBy) data.paidBy = "Employee (to reimburse)";
    if (data.status === "Paid" && existingData?.status !== "Paid") data.paidDate = new Date().toISOString().slice(0, 10);
    if (data.status !== "Paid") data.paidDate = "";
  }

  if (kind === "hr-appraisals") {
    const ratings = ["qualityRating", "productivityRating", "teamworkRating", "punctualityRating"].map((key) => money(data[key])).filter((value) => value > 0);
    data.overallRating = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : "";
    if (!data.status) data.status = "To Confirm";
  }

  if (kind === "hr-settlements") {
    const employee = context.byKind("employees").find((row) => row.id === data.employeeId);
    if (!data.monthlySalary && employee?.data.baseSalary) data.monthlySalary = fixed(money(employee.data.baseSalary));
    if (!data.joiningDate && employee?.data.joiningDate) data.joiningDate = employee.data.joiningDate;
    if (!existing && !data.loanRecovery) {
      const open = context.byKind("hr-loans").filter((row) => isRunningAttachment(row.data.status) && sameEmployee(row.data, data));
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
    if (data.status === "Paid" && existingData?.status !== "Paid") data.paidDate = new Date().toISOString().slice(0, 10);
    if (data.status !== "Paid") data.paidDate = "";
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
  if (kind === "hr-candidates" && isHiredStage(data.stage) && !isHiredStage(before?.stage) && !data.hiredEmployeeId) {
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
        baseSalary: data.proposedSalary || data.expectedSalary || "0",
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
        data: { employee: data.candidateName, employeeId: employee.id, task, dueDate: due.toISOString().slice(0, 10), status: "To Do" },
      });
    }
    await db.update(bookkeepingRecord).set({ data: { ...data, hiredEmployeeId: employee.id } }).where(eq(bookkeepingRecord.id, after.id));
    return `${data.candidateName} added to Employees as ${employeeId}, with the onboarding plan's activities.`;
  }
  const settled = (status: string | undefined) => status === "Approved" || status === "Paid";
  if (kind === "hr-settlements" && data.status === "Paid" && before?.status !== "Paid" && data.employeeId && money(data.loanRecovery) > 0) {
    // The final pay recovered what was left on the employee's salary attachments, so they are done.
    const loans = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-loans")));
    for (const loan of loans.filter((row) => row.data.employeeId === data.employeeId && isRunningAttachment(row.data.status))) {
      await db.update(bookkeepingRecord).set({ data: { ...loan.data, repaidAmount: fixed(money(loan.data.amount)), balance: "0.00", status: "Completed" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, loan.id));
    }
  }
  if (kind === "hr-settlements" && settled(data.status) && !settled(before?.status) && data.employeeId) {
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
    .filter((row) => isRunningAttachment(row.data.status) && matches(row.data) && (!row.data.startMonth || row.data.startMonth <= month))
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
  // Payroll carries the employee code (EMP-001); attachments point at the employee record.
  const employees = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "employees")));
  const employee = employees.find((row) => payroll.employeeId && row.data.employeeId === payroll.employeeId);
  const isTheirs = (data: Record<string, string>) => (employee && data.employeeId ? data.employeeId === employee.id : data.employee === payroll.employeeName);
  const loans = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-loans"))))
    .filter((row) => isTheirs(row.data) && (direction === 1 ? isRunningAttachment(row.data.status) : isRunningAttachment(row.data.status) || isCompletedAttachment(row.data.status)))
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
      data: { ...loan.data, repaidAmount: fixed(nextRepaid), balance: fixed(amount - nextRepaid), status: amount - nextRepaid <= 0.004 ? "Completed" : "Running" },
      updatedAt: new Date(),
    }).where(eq(bookkeepingRecord.id, loan.id));
  }
}
