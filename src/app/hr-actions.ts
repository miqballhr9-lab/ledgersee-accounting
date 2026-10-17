"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { saveCrmRecord } from "@/app/crm-actions";
import { ActionError } from "@/lib/action-error";
import { assertCanWrite, requireUser } from "@/lib/auth";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { applyHrRules, leaveUsed, timeOffAllowance } from "@/lib/hr-rules";
import { odooHrData } from "@/lib/hr-status";
import { canAccess } from "@/lib/permissions";
import { revalidatePath } from "@/lib/revalidate";
import { runWithRole } from "@/lib/role-override";

type StoredRow = typeof bookkeepingRecord.$inferSelect;

function toRecord(row: StoredRow): BookkeepingRecord {
  return { id: row.id, kind: row.kind as RecordKind, data: odooHrData(row.kind, row.data), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function rows(userId: string, kinds: string[]) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, kinds)));
}

export interface AttendanceRow {
  employeeId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  notes?: string;
}

/** Saves a day's attendance for many employees at once, updating anyone already marked that day. */
export async function markAttendance(date: string, entries: AttendanceRow[]): Promise<BookkeepingRecord[]> {
  const me = await requireUser();
  assertCanWrite(me, "hr-attendance");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("Choose the date.");
  if (entries.length > 1000) throw new ActionError("Mark up to 1,000 employees at a time.");
  const all = await rows(me.id, ["employees", "hr-attendance", "hr-holidays", "settings"]);
  const byKind = (kind: string) => all.filter((row) => row.kind === kind);
  const saved: BookkeepingRecord[] = [];
  for (const entry of entries) {
    if (!entry.status) continue;
    const employee = byKind("employees").find((row) => row.id === entry.employeeId);
    if (!employee) continue;
    const existing = byKind("hr-attendance").find((row) => row.data.employeeId === employee.id && row.data.date === date);
    const data: Record<string, string> = {
      ...(existing?.data ?? {}),
      employee: employee.data.name ?? "",
      employeeId: employee.id,
      date,
      status: entry.status,
      checkIn: ["Absent", "On leave", "Holiday"].includes(entry.status) ? "" : entry.checkIn.trim(),
      checkOut: ["Absent", "On leave", "Holiday"].includes(entry.status) ? "" : entry.checkOut.trim(),
      ...(entry.notes !== undefined ? { notes: entry.notes.trim().slice(0, 500) } : {}),
    };
    applyHrRules("hr-attendance", data, existing?.data, { byKind, actor: me.name }, existing?.id);
    const [row] = existing
      ? await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, existing.id)).returning()
      : await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "hr-attendance", data }).returning();
    saved.push(toRecord(row));
  }
  revalidatePath("/app", "layout");
  return saved;
}

/* ───────────── Employee self-service ───────────── */

/** The employee record of the signed-in person, matched by email. */
async function myEmployee(write = false) {
  const me = await requireUser();
  if (write && !canAccess(me.role, "self", "write")) throw new ActionError("Your role can view this page but not send requests.");
  const employees = await rows(me.id, ["employees"]);
  const email = me.email.trim().toLowerCase();
  const employee = employees.find((row) => row.data.email?.trim().toLowerCase() === email && row.data.status !== "Inactive");
  return { me, employee };
}

export interface MyPortal {
  employee: BookkeepingRecord | null;
  business: string;
  payslips: BookkeepingRecord[];
  leaves: BookkeepingRecord[];
  leaveTypes: { id: string; name: string; allowance: number; used: number; paid: boolean }[];
  attendance: BookkeepingRecord[];
  loans: BookkeepingRecord[];
  claims: BookkeepingRecord[];
  documents: BookkeepingRecord[];
  holidays: BookkeepingRecord[];
}

export async function getMyPortal(): Promise<MyPortal> {
  const { me, employee } = await myEmployee();
  const empty: MyPortal = { employee: null, business: me.workspaceName, payslips: [], leaves: [], leaveTypes: [], attendance: [], loans: [], claims: [], documents: [], holidays: [] };
  if (!employee) return empty;
  const all = await rows(me.id, ["payroll", "hr-leaves", "hr-leave-types", "hr-allocations", "hr-attendance", "hr-loans", "hr-claims", "hr-documents", "hr-holidays"]);
  const mine = (kind: string) => all.filter((row) => row.kind === kind && (row.data.employeeId === employee.id || (kind === "payroll" && (row.data.employeeEmail?.toLowerCase() === me.email.toLowerCase() || row.data.employeeName === employee.data.name))));
  const year = new Date().toISOString().slice(0, 4);
  const leaves = mine("hr-leaves");
  return {
    employee: toRecord(employee),
    business: me.workspaceName,
    payslips: mine("payroll").sort((a, b) => (b.data.month ?? "").localeCompare(a.data.month ?? "")).map(toRecord),
    leaves: leaves.sort((a, b) => (b.data.fromDate ?? "").localeCompare(a.data.fromDate ?? "")).map(toRecord),
    leaveTypes: all.filter((row) => row.kind === "hr-leave-types").map((type) => ({
      id: type.id,
      name: type.data.leaveName ?? "Leave",
      allowance: timeOffAllowance({ byKind: (kind) => all.filter((row) => row.kind === kind), actor: "" }, { employeeId: employee.id, leaveTypeId: type.id }, year) ?? 0,
      used: leaveUsed(leaves, { employeeId: employee.id, leaveTypeId: type.id }, year),
      paid: type.data.paid !== "false",
    })),
    attendance: mine("hr-attendance").sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? "")).slice(0, 60).map(toRecord),
    loans: mine("hr-loans").map(toRecord),
    claims: mine("hr-claims").sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? "")).map(toRecord),
    documents: mine("hr-documents").map(toRecord),
    holidays: all.filter((row) => row.kind === "hr-holidays" && (row.data.date ?? "") >= new Date().toISOString().slice(0, 10)).sort((a, b) => (a.data.date ?? "").localeCompare(b.data.date ?? "")).slice(0, 10).map(toRecord),
  };
}

/** Today's date and the time now in the business's time zone (Settings), Pakistan time by default. */
async function nowTime(userId: string) {
  const [settings] = await rows(userId, ["settings"]);
  const timeZone = settings?.data.timeZone || "Asia/Karachi";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  }
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

/** Checks an employee in or out for today, in the business's time zone. */
async function checkEmployee(me: Awaited<ReturnType<typeof requireUser>>, employee: StoredRow, direction: "in" | "out", self: boolean) {
  const { date, time } = await nowTime(me.id);
  const all = await rows(me.id, ["hr-attendance", "hr-holidays", "settings"]);
  const byKind = (kind: string) => all.filter((row) => row.kind === kind);
  const existing = byKind("hr-attendance").find((row) => row.data.employeeId === employee.id && row.data.date === date);
  const who = self ? "You" : employee.data.name || "This employee";
  if (direction === "in" && existing?.data.checkIn && !existing.data.checkOut) throw new ActionError(`${who} already checked in at ${existing.data.checkIn}.`);
  if (direction === "in" && existing?.data.checkOut) throw new ActionError(`${who} already checked out today at ${existing.data.checkOut}.`);
  if (direction === "out" && !existing?.data.checkIn) throw new ActionError("Check in first.");
  const data: Record<string, string> = {
    ...(existing?.data ?? { employee: employee.data.name ?? "", employeeId: employee.id, date, status: "Present" }),
    ...(direction === "in" ? { checkIn: time } : { checkOut: time }),
  };
  applyHrRules("hr-attendance", data, existing?.data, { byKind, actor: me.name }, existing?.id);
  if (existing) await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, existing.id));
  else await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "hr-attendance", data });
  revalidatePath("/app", "layout");
  return time;
}

/** Check in or out for today. */
export async function selfCheck(direction: "in" | "out"): Promise<string> {
  const { me, employee } = await myEmployee(true);
  if (!employee) throw new ActionError("Your email isn’t linked to an employee yet. Ask HR to add it to your employee profile.");
  return checkEmployee(me, employee, direction, true);
}

/** Kiosk mode in Attendances: HR checks any employee in or out. Returns the time recorded. */
export async function kioskCheck(employeeId: string, direction: "in" | "out"): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, "hr-attendance");
  if (direction !== "in" && direction !== "out") throw new ActionError("Choose check in or check out.");
  const [employee] = (await rows(me.id, ["employees"])).filter((row) => row.id === employeeId && row.data.status !== "Inactive");
  if (!employee) throw new ActionError("We couldn’t find that employee. Refresh and try again.");
  return checkEmployee(me, employee, direction, false);
}

/** An employee asks for leave, a loan or an expense back; HR approves it from the HR pages. */
export async function selfRequest(kind: "hr-leaves" | "hr-loans" | "hr-claims", input: Record<string, string>): Promise<void> {
  if (!["hr-leaves", "hr-loans", "hr-claims"].includes(kind)) throw new ActionError("That request isn’t available.");
  const { employee } = await myEmployee(true);
  if (!employee) throw new ActionError("Your email isn’t linked to an employee yet. Ask HR to add it to your employee profile.");
  const allowed: Record<string, string[]> = {
    "hr-leaves": ["leaveTypeId", "fromDate", "toDate", "halfDay", "reason"],
    "hr-loans": ["loanType", "amount", "installments", "reason"],
    "hr-claims": ["date", "category", "description", "amount", "receipt", "receiptName", "notes"],
  };
  const values: Record<string, string> = Object.fromEntries((allowed[kind] ?? []).map((key) => [key, String(input[key] ?? "")]));
  values.employeeId = employee.id;
  values.employee = employee.data.name ?? "";
  // Time off follows its type's approval; the rest wait for HR.
  if (kind !== "hr-leaves") values.status = kind === "hr-loans" ? "To Approve" : "Submitted";
  if (kind === "hr-loans") values.requestDate = new Date().toISOString().slice(0, 10);
  await saveAsEmployee(kind, values);
}

/** Saves through the shared rules with HR rights, for the employee's own request only. */
async function saveAsEmployee(kind: string, values: Record<string, string>) {
  await runWithRole("HR manager", () => saveCrmRecord(kind, values));
}
