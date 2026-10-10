"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { calculatePayroll, type PayrollValues, serializePayroll } from "@/lib/payroll-utils";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

function field(form: Record<string, unknown>, key: keyof PayrollValues, maxLength: number): string {
  const value = form[key];
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error("Check the payroll details and try again.");
  return value.trim().slice(0, maxLength);
}

function payrollInput(input: unknown): PayrollValues {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Check the payroll details and try again.");
  const form = input as Record<string, unknown>;
  const values: PayrollValues = {
    employeeId: field(form, "employeeId", 50),
    employeeName: field(form, "employeeName", 120),
    cnic: field(form, "cnic", 20),
    designation: field(form, "designation", 120),
    month: field(form, "month", 7),
    baseSalary: field(form, "baseSalary", 24),
    increment: field(form, "increment", 24),
    workingDays: field(form, "workingDays", 3),
    workedDays: field(form, "workedDays", 3),
    incentive: field(form, "incentive", 24),
    overtimeAllowance: field(form, "overtimeAllowance", 24),
    gymAllowance: field(form, "gymAllowance", 24),
    medicalAllowance: field(form, "medicalAllowance", 24),
    otherAllowance: field(form, "otherAllowance", 24),
    taxDeduction: field(form, "taxDeduction", 24),
    advanceDeduction: field(form, "advanceDeduction", 24),
    loanDeduction: field(form, "loanDeduction", 24),
    fineDeduction: field(form, "fineDeduction", 24),
    adjustment: field(form, "adjustment", 24),
    description: field(form, "description", 1000),
  };

  if (!values.employeeId || !values.employeeName || !values.cnic || !values.designation) {
    throw new Error("Enter the employee ID, name, CNIC, and designation.");
  }
  if (!values.baseSalary) throw new Error("Enter the employee’s base salary.");
  if (!/^\d{5}-?\d{7}-?\d$/.test(values.cnic)) throw new Error("Enter a valid 13-digit CNIC.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)) throw new Error("Choose a valid payroll month.");

  const numericFields: (keyof PayrollValues)[] = [
    "baseSalary", "increment", "workingDays", "workedDays", "incentive", "overtimeAllowance", "gymAllowance",
    "medicalAllowance", "otherAllowance", "taxDeduction", "advanceDeduction", "loanDeduction", "fineDeduction", "adjustment",
  ];
  for (const key of numericFields) {
    const value = values[key].trim();
    if (!value) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) throw new Error("Enter valid salary amounts and working days.");
    if (key !== "adjustment" && number < 0) throw new Error("Salary, allowances, days, tax, and deductions can’t be negative.");
  }

  const workingDays = Number(values.workingDays);
  const workedDays = Number(values.workedDays);
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) throw new Error("Total working days must be from 1 to 31.");
  if (!Number.isInteger(workedDays) || workedDays < 0 || workedDays > workingDays) throw new Error("Worked days can’t exceed total working days.");
  if (calculatePayroll(values).payableSalary < 0) throw new Error("Deductions exceed the gross salary. Adjust the deductions or adjustment.");

  return values;
}

function asRecord(row: typeof bookkeepingRecord.$inferSelect): BookkeepingRecord {
  return {
    id: row.id,
    kind: "payroll",
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function savePayrollRecord(input: unknown, id?: string): Promise<BookkeepingRecord> {
  const me = await requireUser();
  const values = payrollInput(input);
  const data = serializePayroll(values);
  const rows = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
    .orderBy(desc(bookkeepingRecord.updatedAt));

  if (id) {
    const existing = rows.find((row) => row.id === id);
    if (!existing) throw new Error("We couldn’t find that payroll entry. Refresh and try again.");
  }

  const duplicate = rows.find((row) =>
    row.id !== id &&
    row.data.month === values.month &&
    row.data.employeeId?.toLowerCase() === values.employeeId.toLowerCase(),
  );
  if (duplicate) throw new Error("That employee already has a payroll entry for this month.");

  if (id) {
    const [updated] = await db
      .update(bookkeepingRecord)
      .set({ data, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "payroll")))
      .returning();
    if (!updated) throw new Error("We couldn’t save that payroll entry. Refresh and try again.");
    revalidatePath("/app/payroll");
    return asRecord(updated);
  }

  const [created] = await db
    .insert(bookkeepingRecord)
    .values({ userId: me.id, kind: "payroll", data })
    .returning();
  revalidatePath("/app/payroll");
  return asRecord(created);
}
