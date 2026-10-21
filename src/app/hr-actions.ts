"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { saveCrmRecord } from "@/app/crm-actions";
import { ActionError } from "@/lib/action-error";
import { assertCanWrite, assertNotViewing, requireUser } from "@/lib/auth";
import type { BookkeepingRecord, RecordKind } from "@/lib/bookkeeping-types";
import { applyHrRules, attendanceSessions, leaveUsed, timeOffAllowance } from "@/lib/hr-rules";
import { odooHrData } from "@/lib/hr-status";
import { canAccess } from "@/lib/permissions";
import { upcomingCelebrations, type Celebration } from "@/lib/celebrations";
import { revalidatePath } from "@/lib/revalidate";
import { runWithRole } from "@/lib/role-override";

type StoredRow = typeof bookkeepingRecord.$inferSelect;
type CheckLocation = { lat: number; lng: number; accuracy?: number };

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
  if (write) assertNotViewing(me);
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
  /** Each time off type's days for the year (null when unlimited), days taken and days waiting for approval. */
  leaveTypes: { id: string; name: string; allowance: number | null; used: number; pending: number; paid: boolean }[];
  attendance: BookkeepingRecord[];
  loans: BookkeepingRecord[];
  claims: BookkeepingRecord[];
  documents: BookkeepingRecord[];
  holidays: BookkeepingRecord[];
  /** Today and the business's time zone, which check ins use. */
  today: string;
  timeZone: string;
  /** Where today's attendance stands: checked in now (and since when), and hours so far. */
  attendanceNow: { date: string; open: boolean; since: string; sessions: Array<{ in: string; out: string }>; hours: string };
  /** Colleagues' (and your own) birthdays and work anniversaries in the next 30 days. */
  celebrations: Celebration[];
}

export async function getMyPortal(): Promise<MyPortal> {
  const { me, employee } = await myEmployee();
  const { date: todayDate } = await nowTime(me.id);
  const [settings] = await rows(me.id, ["settings"]);
  const timeZone = settings?.data.timeZone || "Asia/Karachi";
  const empty: MyPortal = { employee: null, business: me.workspaceName, payslips: [], leaves: [], leaveTypes: [], attendance: [], loans: [], claims: [], documents: [], holidays: [], today: todayDate, timeZone, attendanceNow: { date: todayDate, open: false, since: "", sessions: [], hours: "" }, celebrations: [] };
  if (!employee) return empty;
  const all = await rows(me.id, ["payroll", "hr-leaves", "hr-leave-types", "hr-allocations", "hr-attendance", "hr-loans", "hr-claims", "hr-documents", "hr-holidays", "employees"]);
  const mine = (kind: string) => all.filter((row) => row.kind === kind && (row.data.employeeId === employee.id || (kind === "payroll" && !row.data.employeeId && (row.data.employeeEmail?.toLowerCase() === me.email.toLowerCase() || row.data.employeeName === employee.data.name))));
  const year = todayDate.slice(0, 4);
  const leaves = mine("hr-leaves");
  // Today's attendance, or last night's check in that hasn't been closed yet.
  const attendanceRows = mine("hr-attendance");
  const sessionsOf = (row: StoredRow | undefined) => {
    const list = attendanceSessions(row?.data.sessions);
    if (!list.length && row?.data.checkIn) list.push({ in: row.data.checkIn, out: row.data.checkOut ?? "" });
    return list;
  };
  const yesterday = new Date(`${todayDate}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const todayRow = attendanceRows.find((row) => row.data.date === todayDate);
  const lastNight = attendanceRows.find((row) => row.data.date === yesterday.toISOString().slice(0, 10));
  const current = !sessionsOf(todayRow).some((session) => !session.out) && sessionsOf(lastNight).some((session) => !session.out) ? lastNight : todayRow;
  const currentSessions = sessionsOf(current);
  const openNow = currentSessions.length > 0 && !currentSessions[currentSessions.length - 1].out;
  return {
    today: todayDate,
    timeZone,
    attendanceNow: { date: current?.data.date ?? todayDate, open: openNow, since: openNow ? currentSessions[currentSessions.length - 1].in : "", sessions: currentSessions, hours: current?.data.hoursWorked ?? "" },
    celebrations: upcomingCelebrations(all.filter((row) => row.kind === "employees").map((row) => ({ id: row.id, data: row.data })), todayDate),
    employee: toRecord(employee),
    business: me.workspaceName,
    payslips: mine("payroll").sort((a, b) => (b.data.month ?? "").localeCompare(a.data.month ?? "")).map(toRecord),
    leaves: leaves.sort((a, b) => (b.data.fromDate ?? "").localeCompare(a.data.fromDate ?? "")).map(toRecord),
    leaveTypes: all.filter((row) => row.kind === "hr-leave-types").map((type) => ({
      id: type.id,
      name: type.data.leaveName ?? "Leave",
      allowance: timeOffAllowance({ byKind: (kind) => all.filter((row) => row.kind === kind), actor: "" }, { employeeId: employee.id, leaveTypeId: type.id }, year),
      used: leaveUsed(leaves, { employeeId: employee.id, leaveTypeId: type.id }, year),
      pending: leaves.filter((leave) => leave.data.leaveTypeId === type.id && ["To Approve", "Second Approval"].includes(leave.data.status ?? "") && (leave.data.fromDate ?? "").startsWith(year)).reduce((sum, leave) => sum + (Number(leave.data.days) || 0), 0),
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
async function checkEmployee(me: Awaited<ReturnType<typeof requireUser>>, employee: StoredRow, direction: "in" | "out", self: boolean, location?: CheckLocation) {
  const { date, time } = await nowTime(me.id);
  const all = await rows(me.id, ["hr-attendance", "hr-holidays", "settings"]);
  const byKind = (kind: string) => all.filter((row) => row.kind === kind);
  const who = self ? "You" : employee.data.name || "This employee";
  const openSession = (row: StoredRow | undefined) => {
    const list = attendanceSessions(row?.data.sessions);
    if (!list.length && row?.data.checkIn) list.push({ in: row.data.checkIn, out: row.data.checkOut ?? "" });
    return list.length > 0 && !list[list.length - 1].out;
  };
  let existing = byKind("hr-attendance").find((row) => row.data.employeeId === employee.id && row.data.date === date);
  // A night shift: checking out after midnight closes yesterday's open check in.
  if (direction === "out" && !openSession(existing)) {
    const yesterday = new Date(`${date}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const previous = byKind("hr-attendance").find((row) => row.data.employeeId === employee.id && row.data.date === yesterday.toISOString().slice(0, 10));
    if (previous && openSession(previous)) existing = previous;
  }
  // Each check in starts a session and each check out closes it, so people can step out and come back.
  const sessions = attendanceSessions(existing?.data.sessions);
  if (!sessions.length && existing?.data.checkIn) sessions.push({ in: existing.data.checkIn, out: existing.data.checkOut ?? "" });
  const open = sessions.length > 0 && !sessions[sessions.length - 1].out;
  if (direction === "in" && open) throw new ActionError(`${who} already checked in at ${sessions[sessions.length - 1].in}.`);
  if (direction === "out" && !open) throw new ActionError("Check in first.");
  if (direction === "in") sessions.push({ in: time, out: "" });
  else sessions[sessions.length - 1].out = time;
  const data: Record<string, string> = {
    ...(existing?.data ?? { employee: employee.data.name ?? "", employeeId: employee.id, date, status: "Present" }),
    checkIn: sessions[0].in,
    checkOut: sessions[sessions.length - 1].out,
    sessions: JSON.stringify(sessions),
    // Where the phone was when checking in or out from the app, so HR can see it.
    ...(location ? { [direction === "in" ? "checkInLocation" : "checkOutLocation"]: `${location.lat.toFixed(5)},${location.lng.toFixed(5)}${location.accuracy ? ` (±${Math.round(location.accuracy)} m)` : ""}` } : {}),
    ...(self ? { [direction === "in" ? "checkInSource" : "checkOutSource"]: "Employee app" } : {}),
  };
  applyHrRules("hr-attendance", data, existing?.data, { byKind, actor: me.name }, existing?.id);
  if (existing) await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, existing.id));
  else await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "hr-attendance", data });
  revalidatePath("/app", "layout");
  return time;
}

/** Check in or out for today, with where the phone was when the employee allowed location. */
export async function selfCheck(direction: "in" | "out", location?: CheckLocation): Promise<string> {
  const { me, employee } = await myEmployee(true);
  if (!employee) throw new ActionError("Your email isn’t linked to an employee yet. Ask HR to add it to your employee profile.");
  if (direction !== "in" && direction !== "out") throw new ActionError("Choose check in or check out.");
  const place = location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180
    ? { lat: Number(location.lat), lng: Number(location.lng), accuracy: Number.isFinite(location.accuracy) ? Number(location.accuracy) : undefined }
    : undefined;
  return checkEmployee(me, employee, direction, true, place);
}

/** Kiosk mode in Attendances: HR checks any employee in or out. Returns the time recorded. */
export async function kioskCheck(employeeId: string, direction: "in" | "out", pin = ""): Promise<string> {
  const me = await requireUser();
  assertCanWrite(me, "hr-attendance");
  if (direction !== "in" && direction !== "out") throw new ActionError("Choose check in or check out.");
  const [employee] = (await rows(me.id, ["employees"])).filter((row) => row.id === employeeId && row.data.status !== "Inactive");
  if (!employee) throw new ActionError("We couldn’t find that employee. Refresh and try again.");
  // An employee with a kiosk PIN must enter it, so nobody checks in for someone else.
  if (employee.data.kioskPin && String(pin).trim() !== employee.data.kioskPin) throw new ActionError("That PIN isn’t right. Try again.");
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

/** Time off types most businesses use; days are a starting point to change in Time off types. */
const standardLeaveTypes = [
  { leaveName: "Annual leave", daysPerYear: "14", paid: "true", description: "Paid holiday earned each year." },
  { leaveName: "Casual leave", daysPerYear: "10", paid: "true", description: "Short notice personal leave." },
  { leaveName: "Sick leave", daysPerYear: "8", paid: "true", description: "When unwell; HR may ask for a medical certificate." },
  { leaveName: "Maternity leave", daysPerYear: "90", paid: "true", description: "Before and after childbirth. Check the law where you operate (e.g. 12–16 weeks in Pakistan)." },
  { leaveName: "Paternity leave", daysPerYear: "30", paid: "true", description: "For a new father. Check the law where you operate." },
  { leaveName: "Unpaid leave", daysPerYear: "0", paid: "false", requiresAllocation: "No limit", description: "Deducted from salary in payroll." },
];

/** Adds the standard time off types the business doesn't have yet, by name. */
export async function addStandardLeaveTypes(): Promise<number> {
  const me = await requireUser();
  assertCanWrite(me, "hr-leave-types");
  const existing = new Set((await rows(me.id, ["hr-leave-types"])).map((row) => (row.data.leaveName ?? "").trim().toLowerCase()));
  const missing = standardLeaveTypes.filter((type) => !existing.has(type.leaveName.toLowerCase()));
  if (missing.length) {
    await db.insert(bookkeepingRecord).values(missing.map((type) => ({
      userId: me.id,
      kind: "hr-leave-types",
      data: { approval: "By time off officer", requiresAllocation: "Yes", ...type },
    })));
  }
  revalidatePath("/app", "layout");
  return missing.length;
}
