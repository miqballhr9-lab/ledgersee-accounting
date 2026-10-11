"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { deleteBookkeepingRecord, generateRecurringInvoice, saveBookkeepingRecord } from "@/app/actions";
import { ActionError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import {
  automationTemplate,
  isAutomationAction,
  nextExecutionDate,
  parseAutomationItems,
  type AutomationAction,
  type AutomationItem,
  type AutomationMode,
  type AutomationTrigger,
} from "@/lib/automation";

type StoredRow = typeof bookkeepingRecord.$inferSelect;

function toRecord(row: StoredRow): BookkeepingRecord {
  return { id: row.id, kind: row.kind as BookkeepingRecord["kind"], data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function rowsOfKind(userId: string, kind: string) {
  return db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind)))
    .orderBy(desc(bookkeepingRecord.createdAt));
}

async function currentMode(userId: string): Promise<AutomationMode> {
  const [settings] = await rowsOfKind(userId, "automation-settings");
  return settings?.data.mode === "Automation" ? "Automation" : "Manual";
}

export interface AutomationState {
  mode: AutomationMode;
  rules: BookkeepingRecord[];
  log: BookkeepingRecord[];
}

export async function getAutomationState(): Promise<AutomationState> {
  const me = await requireUser();
  const [mode, rules, log] = await Promise.all([currentMode(me.id), rowsOfKind(me.id, "automation-rules"), rowsOfKind(me.id, "automation-log")]);
  return { mode, rules: rules.map(toRecord), log: log.slice(0, 100).map(toRecord) };
}

export async function setAutomationMode(mode: AutomationMode): Promise<void> {
  const me = await requireUser();
  if (mode !== "Manual" && mode !== "Automation") throw new ActionError("Choose Manual or Automation mode.");
  const [settings] = await rowsOfKind(me.id, "automation-settings");
  if (settings) {
    await db.update(bookkeepingRecord).set({ data: { ...settings.data, mode }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, settings.id), eq(bookkeepingRecord.userId, me.id)));
  } else {
    await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "automation-settings", data: { mode } });
  }
  revalidatePath("/app", "layout");
}

export interface AutomationRuleInput {
  name: string;
  action: AutomationAction;
  trigger: AutomationTrigger;
  dayOfMonth: string;
  requireApproval: boolean;
  active: boolean;
}

function ruleData(input: AutomationRuleInput, previous?: Record<string, string>) {
  if (!isAutomationAction(input.action)) throw new ActionError("Choose what this rule should do.");
  const template = automationTemplate(input.action);
  const trigger: AutomationTrigger = input.trigger === "daily" ? "daily" : "monthly";
  const day = String(Math.min(28, Math.max(1, Number(input.dayOfMonth) || 1)));
  const name = (typeof input.name === "string" ? input.name.trim() : "").slice(0, 100) || template?.name || "Automation rule";
  const timingChanged = !previous || previous.trigger !== trigger || previous.dayOfMonth !== day;
  return {
    ...previous,
    name,
    action: input.action,
    model: template?.model ?? "",
    trigger,
    dayOfMonth: day,
    requireApproval: input.requireApproval ? "true" : "false",
    active: input.active ? "true" : "false",
    nextRun: timingChanged || !previous?.nextRun ? nextExecutionDate(trigger, day, today()) : previous.nextRun,
  };
}

export async function saveAutomationRule(input: AutomationRuleInput, id?: string): Promise<void> {
  const me = await requireUser();
  if (id) {
    const [existing] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-rules"))).limit(1);
    if (!existing) throw new ActionError("We couldn’t find that rule. Refresh and try again.");
    await db.update(bookkeepingRecord).set({ data: ruleData(input, existing.data), updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id)));
  } else {
    await db.insert(bookkeepingRecord).values({ userId: me.id, kind: "automation-rules", data: ruleData(input) });
  }
  revalidatePath("/app/automation");
}

export async function deleteAutomationRule(id: string): Promise<void> {
  const me = await requireUser();
  await db.delete(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-rules")));
  revalidatePath("/app/automation");
}

/** Adds the recommended rules (one per action) that the business doesn't have yet. */
export async function addRecommendedRules(): Promise<void> {
  const me = await requireUser();
  const existing = await rowsOfKind(me.id, "automation-rules");
  for (const template of [{ action: "monthlyPayroll" as const }, { action: "recurringInvoices" as const }]) {
    if (existing.some((row) => row.data.action === template.action)) continue;
    const details = automationTemplate(template.action)!;
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "automation-rules",
      data: ruleData({ name: details.name, action: details.action, trigger: details.trigger, dayOfMonth: details.dayOfMonth, requireApproval: true, active: true }),
    });
  }
  revalidatePath("/app/automation");
}

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const payrollAmountFields = ["baseSalary", "increment", "incentive", "overtimeAllowance", "gymAllowance", "medicalAllowance", "otherAllowance", "advanceDeduction", "loanDeduction", "fineDeduction", "adjustment"];

/** Adds this month's salary for each active employee (and anyone paid last month) who has none yet. */
async function runMonthlyPayroll(userId: string) {
  const month = today().slice(0, 7);
  const lastMonth = previousMonth(month);
  const [payroll, employees] = await Promise.all([rowsOfKind(userId, "payroll"), rowsOfKind(userId, "employees")]);
  const thisMonth = payroll.filter((row) => row.data.month === month);
  const lastMonthEntries = payroll.filter((row) => row.data.month === lastMonth);
  const hasEntry = (employeeId: string, name: string) => thisMonth.some((row) => row.data.employeeId === employeeId && row.data.employeeName?.trim() === name.trim());

  const sources: Record<string, string>[] = [];
  for (const employee of employees.filter((row) => row.data.name?.trim() && row.data.status !== "Inactive")) {
    const previous = lastMonthEntries.find((row) => row.data.employeeId === employee.data.employeeId && row.data.employeeName?.trim() === employee.data.name?.trim());
    sources.push(previous ? { ...previous.data } : {
      employeeId: employee.data.employeeId || "",
      employeeName: employee.data.name || "",
      employeeEmail: employee.data.email || "",
      cnic: employee.data.cnic || "",
      designation: employee.data.designation || "",
      joiningDate: employee.data.joiningDate || "",
      paymentAccountId: employee.data.paymentAccountId || "",
      baseSalary: employee.data.baseSalary || "0",
      workingDays: "26",
    });
  }
  for (const entry of lastMonthEntries) {
    if (!sources.some((source) => source.employeeId === entry.data.employeeId && source.employeeName?.trim() === entry.data.employeeName?.trim())) sources.push({ ...entry.data });
  }

  const items: AutomationItem[] = [];
  const errors: string[] = [];
  for (const source of sources) {
    if (hasEntry(source.employeeId || "", source.employeeName || "")) continue;
    const workingDays = source.workingDays || "26";
    const payload: Record<string, string> = {
      reference: `SAL-${month}`,
      employeeId: source.employeeId || "",
      employeeName: source.employeeName || "",
      employeeEmail: source.employeeEmail || "",
      cnic: source.cnic || "",
      designation: source.designation || "",
      joiningDate: source.joiningDate || "",
      paymentAccountId: source.paymentAccountId || "",
      month,
      workingDays,
      workedDays: workingDays,
      taxDeduction: "",
      description: "Created by automation",
    };
    for (const field of payrollAmountFields) payload[field] = source[field] || "0";
    try {
      const saved = await saveBookkeepingRecord("payroll", payload);
      items.push({ kind: "payroll", id: saved.id, label: `${payload.employeeName} · salary ${month}`, status: "Pending approval" });
    } catch (error) {
      errors.push(`${payload.employeeName || "Employee"}: ${error instanceof Error ? error.message : "couldn’t be created"}`);
    }
  }
  const summary = items.length
    ? `Created ${items.length} salary ${items.length === 1 ? "entry" : "entries"} for ${month}.`
    : errors.length ? `Couldn’t create ${errors.length} salary ${errors.length === 1 ? "entry" : "entries"} for ${month}.` : `Nothing to create; everyone already has a salary for ${month}.`;
  return { items, errors, summary };
}

/** Creates a draft invoice for every active recurring schedule that is due. */
async function runRecurringInvoices(userId: string) {
  const schedules = await rowsOfKind(userId, "recurring-invoices");
  const due = schedules.filter((row) => row.data.status !== "Paused" && row.data.nextDate && row.data.nextDate <= today());
  const items: AutomationItem[] = [];
  const errors: string[] = [];
  for (const schedule of due) {
    try {
      await generateRecurringInvoice(schedule.id);
      const [invoice] = await db
        .select()
        .from(bookkeepingRecord)
        .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "invoices")))
        .orderBy(desc(bookkeepingRecord.createdAt))
        .limit(1);
      if (invoice) items.push({ kind: "invoices", id: invoice.id, label: `${invoice.data.invoiceNumber || "Invoice"} · ${invoice.data.customer || schedule.data.name || "Customer"}`, status: "Pending approval" });
    } catch (error) {
      errors.push(`${schedule.data.name || "Schedule"}: ${error instanceof Error ? error.message : "couldn’t be generated"}`);
    }
  }
  const summary = items.length
    ? `Generated ${items.length} draft ${items.length === 1 ? "invoice" : "invoices"}.`
    : errors.length ? `Couldn’t generate ${errors.length} due ${errors.length === 1 ? "invoice" : "invoices"}.` : "No recurring invoices were due.";
  return { items, errors, summary };
}

async function executeRule(userId: string, rule: StoredRow, trigger: "Scheduled" | "Run now") {
  const action = rule.data.action;
  const result = action === "monthlyPayroll"
    ? await runMonthlyPayroll(userId)
    : action === "recurringInvoices"
      ? await runRecurringInvoices(userId)
      : { items: [], errors: [`Unknown action ${action}.`], summary: "Nothing ran." };
  const needsApproval = rule.data.requireApproval !== "false";
  const items = result.items.map((item) => ({ ...item, status: needsApproval ? "Pending approval" : "Done" }));
  await db.insert(bookkeepingRecord).values({
    userId,
    kind: "automation-log",
    data: {
      ruleId: rule.id,
      ruleName: rule.data.name || "Automation rule",
      model: rule.data.model || "",
      trigger,
      ranAt: new Date().toISOString(),
      summary: result.summary,
      errors: result.errors.join(" "),
      items: JSON.stringify(items),
    },
  });
  await db
    .update(bookkeepingRecord)
    .set({ data: { ...rule.data, lastRun: new Date().toISOString(), lastResult: result.errors.length ? `${result.summary} ${result.errors.length} failed.` : result.summary } })
    .where(and(eq(bookkeepingRecord.id, rule.id), eq(bookkeepingRecord.userId, userId)));
}

/** "Run now": runs one rule immediately, in either mode. */
export async function runAutomationRule(id: string): Promise<void> {
  const me = await requireUser();
  const [rule] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-rules"))).limit(1);
  if (!rule) throw new ActionError("We couldn’t find that rule. Refresh and try again.");
  await executeRule(me.id, rule, "Run now");
  revalidatePath("/app", "layout");
}

/**
 * Runs every active rule whose next execution date has arrived. Does nothing in
 * Manual mode. Each rule is claimed by moving its next date forward first, so a
 * second open tab can't run it twice.
 */
export async function runDueAutomations(): Promise<void> {
  const me = await requireUser();
  if ((await currentMode(me.id)) !== "Automation") return;
  const rules = await rowsOfKind(me.id, "automation-rules");
  const now = today();
  for (const rule of rules) {
    if (rule.data.active !== "true" || !rule.data.nextRun || rule.data.nextRun > now) continue;
    const trigger: AutomationTrigger = rule.data.trigger === "daily" ? "daily" : "monthly";
    const nextRun = nextExecutionDate(trigger, rule.data.dayOfMonth || "1", now, true);
    const claimed = await db
      .update(bookkeepingRecord)
      .set({ data: { ...rule.data, nextRun }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, rule.id), eq(bookkeepingRecord.userId, me.id), sql`${bookkeepingRecord.data}->>'nextRun' = ${rule.data.nextRun}`))
      .returning();
    if (!claimed[0]) continue;
    try {
      await executeRule(me.id, claimed[0], "Scheduled");
    } catch {
      // A failing rule must never stop the app from loading; the next run tries again.
    }
  }
}

async function updateLogItem(logId: string, recordId: string, status: AutomationItem["status"]) {
  const me = await requireUser();
  const [log] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, logId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-log"))).limit(1);
  if (!log) throw new ActionError("We couldn’t find that automation run. Refresh and try again.");
  const items = parseAutomationItems(log.data.items);
  const item = items.find((entry) => entry.id === recordId);
  if (!item) throw new ActionError("That item is no longer in this run.");
  if (status === "Rejected") await deleteBookkeepingRecord(item.kind, item.id);
  item.status = status;
  await db.update(bookkeepingRecord).set({ data: { ...log.data, items: JSON.stringify(items) }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, logId), eq(bookkeepingRecord.userId, me.id)));
  revalidatePath("/app", "layout");
}

/** Keeps what the automation created. */
export async function approveAutomationItem(logId: string, recordId: string): Promise<void> {
  await updateLogItem(logId, recordId, "Approved");
}

/** Deletes what the automation created. */
export async function rejectAutomationItem(logId: string, recordId: string): Promise<void> {
  await updateLogItem(logId, recordId, "Rejected");
}
