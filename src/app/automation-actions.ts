"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath, withoutRevalidation } from "@/lib/revalidate";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { deleteBookkeepingRecord, generateRecurringInvoice, saveBookkeepingRecord } from "@/app/actions";
import { runDueRecurringTransactions } from "@/app/recurring-actions";
import { ActionError } from "@/lib/action-error";
import { assertAdmin, requireUser } from "@/lib/auth";
import { sendEmailOrThrow } from "@/lib/email";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { adjustedWorkedDays, payrollAdjustments } from "@/lib/payroll-adjustments";
import { weekendDays } from "@/lib/weekend";
import { runCaseEscalation, runLeadFollowUp, runOverdueTasks, runStaleDeals, runWonDealInvoices } from "@/lib/crm-automation";
import {
  automationTemplate,
  automationTemplates,
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
  assertAdmin(me);
  const [mode, rules, log] = await Promise.all([currentMode(me.id), rowsOfKind(me.id, "automation-rules"), rowsOfKind(me.id, "automation-log")]);
  return { mode, rules: rules.map(toRecord), log: log.slice(0, 100).map(toRecord) };
}

export async function setAutomationMode(mode: AutomationMode): Promise<void> {
  const me = await requireUser();
  assertAdmin(me);
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
  /** Condition values for actions that take them ("days", "minAmount"). */
  conditions?: Record<string, string>;
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
    ...Object.fromEntries((template?.conditions ?? []).map((condition) => {
      const supplied = Number(input.conditions?.[condition.key] ?? previous?.[condition.key] ?? condition.defaultValue);
      return [condition.key, String(Number.isFinite(supplied) && supplied >= 0 ? Math.min(supplied, 1_000_000_000) : Number(condition.defaultValue))];
    })),
  };
}

export async function saveAutomationRule(input: AutomationRuleInput, id?: string): Promise<void> {
  const me = await requireUser();
  assertAdmin(me);
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
  assertAdmin(me);
  await db.delete(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-rules")));
  revalidatePath("/app/automation");
}

/** Adds the recommended rules (one per action) that the business doesn't have yet. */
export async function addRecommendedRules(): Promise<void> {
  const me = await requireUser();
  assertAdmin(me);
  const existing = await rowsOfKind(me.id, "automation-rules");
  for (const template of automationTemplates) {
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

const payrollAmountFields = ["baseSalary", "increment", "incentive", "overtimeAllowance", "gymAllowance", "medicalAllowance", "otherAllowance", "advanceDeduction", "loanDeduction", "fineDeduction", "socialDeduction", "adjustment"];

/** Adds this month's salary for each active employee (and anyone paid last month) who has none yet. */
async function runMonthlyPayroll(userId: string) {
  const month = today().slice(0, 7);
  const lastMonth = previousMonth(month);
  const [payroll, employees, leaves, loans, attendance] = await Promise.all([rowsOfKind(userId, "payroll"), rowsOfKind(userId, "employees"), rowsOfKind(userId, "hr-leaves"), rowsOfKind(userId, "hr-loans"), rowsOfKind(userId, "hr-attendance")]);
  const thisMonth = payroll.filter((row) => row.data.month === month);
  const weekend = weekendDays((await rowsOfKind(userId, "settings"))[0]?.data.weekendDays);
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
    // HR: unpaid time off and absences come off the worked days, and running attachments set this month's installment.
    const employee = employees.find((row) => row.data.employeeId === payload.employeeId && row.data.name?.trim() === payload.employeeName.trim());
    const hr = payrollAdjustments(month, { id: employee?.id, name: payload.employeeName }, leaves, loans, attendance, weekend);
    payload.workedDays = adjustedWorkedDays(workingDays, hr);
    if (hr.hasLoans) payload.loanDeduction = hr.loanDeduction.toFixed(2);
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
  // Scheduled recurring transactions (invoices, bills, expenses and journals) come due on the same run.
  const recurring = await runDueRecurringTransactions();
  for (const entry of recurring.created) items.push({ kind: entry.kind, id: entry.id, label: entry.label, status: "Pending approval" });
  errors.push(...recurring.errors);
  const summary = items.length
    ? `Generated ${items.length} recurring ${items.length === 1 ? "transaction" : "transactions"}.`
    : errors.length ? `Couldn’t generate ${errors.length} due ${errors.length === 1 ? "transaction" : "transactions"}.` : "No recurring transactions were due.";
  return { items, errors, summary };
}

/** Categorises bank transactions no rule has handled yet when an enabled bank rule fits their description. */
async function runBankRules(userId: string) {
  const [transactions, rules] = await Promise.all([rowsOfKind(userId, "transactions"), rowsOfKind(userId, "bank-rules")]);
  const enabled = rules.filter((rule) => rule.data.enabled !== "false" && rule.data.contains?.trim());
  const items: AutomationItem[] = [];
  for (const transaction of transactions) {
    if (transaction.data.matched === "true" || transaction.data.ruleApplied || transaction.data.reconciled === "true") continue;
    const description = (transaction.data.description || "").toLowerCase();
    const rule = enabled.find((candidate) => description.includes(candidate.data.contains.trim().toLowerCase()));
    if (!rule) continue;
    const restore = { category: transaction.data.category || "", account: transaction.data.account || "", matched: transaction.data.matched || "false", ruleApplied: transaction.data.ruleApplied || "" };
    await db
      .update(bookkeepingRecord)
      .set({ data: { ...transaction.data, category: transaction.data.category || rule.data.category || "", account: transaction.data.account || rule.data.account || "", ruleApplied: rule.data.name || "Bank rule" }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, transaction.id), eq(bookkeepingRecord.userId, userId)));
    items.push({ kind: "transactions", id: transaction.id, label: `${transaction.data.description || "Transaction"} · ${transaction.data.amount || ""} → ${rule.data.category || rule.data.name || "rule"}`, status: "Pending approval", onReject: "restore", restore });
  }
  const summary = items.length ? `Categorised ${items.length} bank ${items.length === 1 ? "transaction" : "transactions"} with bank rules.` : "No new transaction fit a bank rule.";
  return { items, errors: [] as string[], summary };
}

function invoiceBalance(data: Record<string, string>) {
  return Math.max(0, (Number(data.amount) || 0) - (Number(data.paidAmount) || 0) - (Number(data.creditApplied) || 0));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function customerEmailFor(userId: string, invoice: Record<string, string>) {
  const customers = await rowsOfKind(userId, "customers");
  const name = invoice.customer?.trim().toLowerCase();
  const customer = customers.find((row) => row.id === invoice.customerId || row.id === invoice.customer) ?? customers.find((row) => row.data.name?.trim().toLowerCase() === name);
  return { email: customer?.data.email?.trim() || "", name: customer?.data.name || invoice.customer || "there" };
}

/** Sends one overdue reminder and notes when, so the same invoice isn't chased again within a week. */
async function sendOverdueReminder(userId: string, invoiceId: string) {
  const [invoice] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, invoiceId), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "invoices"))).limit(1);
  if (!invoice) throw new ActionError("That invoice no longer exists.");
  const balance = invoiceBalance(invoice.data);
  if (!balance || invoice.data.status === "Paid") throw new ActionError("That invoice has been paid; no reminder sent.");
  const { email, name } = await customerEmailFor(userId, invoice.data);
  if (!email) throw new ActionError("Add an email address to this customer to send reminders.");
  const [settings] = await rowsOfKind(userId, "settings");
  const company = settings?.data.companyName || "Our company";
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  const amount = `${invoice.data.currency || ""} ${balance.toFixed(2)}`.trim();
  await sendEmailOrThrow({
    to: email,
    subject: `Payment reminder: invoice ${invoice.data.invoiceNumber || ""} from ${company}`,
    html: `<p>Hello ${escape(name)},</p><p>This is a friendly reminder that invoice ${escape(invoice.data.invoiceNumber || "")} was due on ${escape(invoice.data.dueDate || "")} and ${escape(amount)} is still outstanding.</p><p>If you have already paid, please ignore this message. Thank you.</p><p>${escape(company)}</p>`,
    fromName: company,
  });
  await db.update(bookkeepingRecord).set({ data: { ...invoice.data, reminderSentAt: today() }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, invoice.id), eq(bookkeepingRecord.userId, userId)));
}

/** Finds unpaid invoices overdue by the rule's days and above its minimum balance; sends or queues a reminder. */
async function runOverdueReminders(userId: string, rule: StoredRow, sendNow: boolean) {
  const days = Math.max(0, Number(rule.data.days) || 0);
  const minAmount = Math.max(0, Number(rule.data.minAmount) || 0);
  const now = today();
  const invoices = await rowsOfKind(userId, "invoices");
  const due = invoices.filter((row) => {
    if (["Draft", "Paid", "Cancelled"].includes(row.data.status ?? "")) return false;
    if (!row.data.dueDate || addDays(row.data.dueDate, days) > now) return false;
    if (row.data.reminderSentAt && addDays(row.data.reminderSentAt, 7) > now) return false;
    const balance = invoiceBalance(row.data);
    return balance > 0 && balance >= minAmount;
  });
  const items: AutomationItem[] = [];
  const errors: string[] = [];
  for (const invoice of due) {
    const label = `Reminder for ${invoice.data.invoiceNumber || "invoice"} · ${invoice.data.customer || "customer"} · due ${invoice.data.dueDate}`;
    if (sendNow) {
      try {
        await sendOverdueReminder(userId, invoice.id);
        items.push({ kind: "invoices", id: invoice.id, label, status: "Done", onApprove: "sendReminder", onReject: "skip" });
      } catch (error) {
        errors.push(`${invoice.data.invoiceNumber || "Invoice"}: ${error instanceof Error ? error.message : "reminder not sent"}`);
      }
    } else {
      // Queued: hold off re-queuing this invoice for a week while it waits for approval.
      await db.update(bookkeepingRecord).set({ data: { ...invoice.data, reminderSentAt: now }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, invoice.id), eq(bookkeepingRecord.userId, userId)));
      items.push({ kind: "invoices", id: invoice.id, label, status: "Pending approval", onApprove: "sendReminder", onReject: "skip" });
    }
  }
  const summary = items.length
    ? sendNow ? `Sent ${items.length} overdue ${items.length === 1 ? "reminder" : "reminders"}.` : `Queued ${items.length} overdue ${items.length === 1 ? "reminder" : "reminders"} for approval.`
    : errors.length ? `Couldn’t send ${errors.length} ${errors.length === 1 ? "reminder" : "reminders"}.` : `No unpaid invoice is ${days} or more days overdue.`;
  return { items, errors, summary };
}

/** The rule's "days" condition, falling back to its template's default. */
function ruleDays(rule: StoredRow) {
  const fallback = automationTemplate(rule.data.action)?.conditions?.find((condition) => condition.key === "days")?.defaultValue ?? "0";
  const days = Number(rule.data.days ?? fallback);
  return Number.isFinite(days) && days >= 0 ? days : Number(fallback);
}

async function executeRule(userId: string, rule: StoredRow, trigger: "Scheduled" | "Run now") {
  const action = rule.data.action;
  const needsApproval = rule.data.requireApproval !== "false";
  const result = action === "monthlyPayroll"
    ? await runMonthlyPayroll(userId)
    : action === "recurringInvoices"
      ? await runRecurringInvoices(userId)
      : action === "bankRules"
        ? await runBankRules(userId)
        : action === "overdueReminders"
          ? await runOverdueReminders(userId, rule, !needsApproval)
          : action === "crmLeadFollowUp"
            ? await runLeadFollowUp(userId, ruleDays(rule))
            : action === "crmStaleDeals"
              ? await runStaleDeals(userId, ruleDays(rule))
              : action === "crmWonDealInvoices"
                ? await runWonDealInvoices(userId)
                : action === "crmOverdueTasks"
                  ? await runOverdueTasks(userId, ruleDays(rule))
                  : action === "crmCaseEscalation"
                    ? await runCaseEscalation(userId, ruleDays(rule))
                    : { items: [], errors: [`Unknown action ${action}.`], summary: "Nothing ran." };
  const items = result.items.map((item) => ({ ...item, status: item.status === "Done" ? "Done" : needsApproval ? "Pending approval" : "Done" }));
  // What the rule created stays out of the books until someone approves it.
  for (const item of items) {
    if (item.status !== "Pending approval" || item.onReject || item.onApprove) continue;
    await db.update(bookkeepingRecord)
      .set({ data: sql`${bookkeepingRecord.data} || '{"awaitingApproval":"true"}'::jsonb` })
      .where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, userId)));
  }
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
  assertAdmin(me);
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
  // Rules act for the whole business, so only its Admins set them off; the daily job covers the rest.
  if (me.role !== "Admin") return;
  if ((await currentMode(me.id)) !== "Automation") return;
  await withoutRevalidation(() => runDueRules(me.id));
}

async function runDueRules(userId: string) {
  const rules = await rowsOfKind(userId, "automation-rules");
  const now = today();
  for (const rule of rules) {
    if (rule.data.active !== "true" || !rule.data.nextRun || rule.data.nextRun > now) continue;
    const trigger: AutomationTrigger = rule.data.trigger === "daily" ? "daily" : "monthly";
    const nextRun = nextExecutionDate(trigger, rule.data.dayOfMonth || "1", now, true);
    const claimed = await db
      .update(bookkeepingRecord)
      .set({ data: { ...rule.data, nextRun }, updatedAt: new Date() })
      .where(and(eq(bookkeepingRecord.id, rule.id), eq(bookkeepingRecord.userId, userId), sql`${bookkeepingRecord.data}->>'nextRun' = ${rule.data.nextRun}`))
      .returning();
    if (!claimed[0]) continue;
    try {
      await executeRule(userId, claimed[0], "Scheduled");
    } catch {
      // A failing rule must never stop the app from loading; the next run tries again.
    }
  }
}

async function updateLogItem(logId: string, recordId: string, status: AutomationItem["status"]) {
  const me = await requireUser();
  assertAdmin(me);
  const [log] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, logId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "automation-log"))).limit(1);
  if (!log) throw new ActionError("We couldn’t find that automation run. Refresh and try again.");
  const items = parseAutomationItems(log.data.items);
  const item = items.find((entry) => entry.id === recordId);
  if (!item) throw new ActionError("That item is no longer in this run.");
  if (item.status !== "Pending approval") throw new ActionError("This item has already been handled.");
  if (status === "Approved" && item.onApprove === "sendReminder") await sendOverdueReminder(me.id, item.id);
  if (status === "Approved") {
    await db.update(bookkeepingRecord)
      .set({ data: sql`${bookkeepingRecord.data} - 'awaitingApproval'` })
      .where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id)));
  }
  if (status === "Rejected") {
    if (item.onReject === "restore" && item.restore) {
      const [record] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id))).limit(1);
      if (record) await db.update(bookkeepingRecord).set({ data: { ...record.data, ...item.restore }, updatedAt: new Date() }).where(and(eq(bookkeepingRecord.id, item.id), eq(bookkeepingRecord.userId, me.id)));
    } else if (item.onReject !== "skip") {
      await deleteBookkeepingRecord(item.kind, item.id);
    }
  }
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
