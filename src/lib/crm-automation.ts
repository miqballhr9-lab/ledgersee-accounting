import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { createDocumentFromDeal } from "@/app/crm-actions";
import type { AutomationItem } from "@/lib/automation";
import { fullName, isClosedStage, parseHistory } from "@/lib/crm-config";

/**
 * CRM rules for Automation mode, in the spirit of Zoho CRM workflow rules:
 * follow-up tasks for new leads and stale deals, invoices for won deals,
 * and escalation of overdue tasks and old cases. Each returns what it did as
 * approval items, like the accounting rules.
 */

type StoredRow = typeof bookkeepingRecord.$inferSelect;
interface RuleResult {
  items: AutomationItem[];
  errors: string[];
  summary: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function addHistory(data: Record<string, string>, text: string) {
  return JSON.stringify([{ at: stamp(), by: "Automation", text }, ...parseHistory(data.history)].slice(0, 40));
}

async function rows(userId: string, kinds: string[]) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, kinds)));
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Adds an automation task unless the record already has an open one from the same rule. */
async function addFollowUpTask(userId: string, tasks: StoredRow[], key: string, data: Record<string, string>) {
  if (tasks.some((task) => task.data.automationKey === key && task.data.status !== "Completed")) return null;
  const [task] = await db.insert(bookkeepingRecord).values({
    userId,
    kind: "crm-tasks",
    data: {
      status: "Not Started",
      priority: "High",
      dueDate: today(),
      repeat: "Never",
      automationKey: key,
      history: addHistory({}, "Task created by automation"),
      ...data,
    },
  }).returning();
  tasks.push(task);
  return task;
}

export async function runLeadFollowUp(userId: string, days: number): Promise<RuleResult> {
  const all = await rows(userId, ["crm-leads", "crm-tasks"]);
  const tasks = all.filter((row) => row.kind === "crm-tasks");
  const cutoff = daysAgo(days);
  const items: AutomationItem[] = [];
  for (const lead of all.filter((row) => row.kind === "crm-leads")) {
    if ((lead.data.leadStatus || "Not Contacted") !== "Not Contacted") continue;
    if (lead.createdAt.toISOString().slice(0, 10) > cutoff) continue;
    const name = fullName(lead.data) || lead.data.company || "lead";
    const task = await addFollowUpTask(userId, tasks, `lead:${lead.id}`, {
      subject: `Call new lead ${name}${lead.data.company && name !== lead.data.company ? ` (${lead.data.company})` : ""}`,
      owner: lead.data.owner || "",
      relatedType: "Lead",
      relatedId: lead.id,
      related: name,
      description: `Created by automation: this lead has not been contacted for ${days} or more days.${lead.data.phone || lead.data.mobile ? ` Phone: ${lead.data.phone || lead.data.mobile}.` : ""}`,
    });
    if (task) items.push({ kind: "crm-tasks", id: task.id, label: `Task: call ${name}`, status: "Pending approval" });
  }
  return { items, errors: [], summary: items.length ? `Created ${plural(items.length, "follow-up task", "follow-up tasks")} for new leads.` : "Every new lead has been contacted or already has a follow-up task." };
}

export async function runStaleDeals(userId: string, days: number): Promise<RuleResult> {
  const all = await rows(userId, ["crm-deals", "crm-tasks"]);
  const tasks = all.filter((row) => row.kind === "crm-tasks");
  const cutoff = daysAgo(days);
  const items: AutomationItem[] = [];
  for (const deal of all.filter((row) => row.kind === "crm-deals")) {
    if (isClosedStage(deal.data.stage)) continue;
    const stale = deal.updatedAt.toISOString().slice(0, 10) <= cutoff;
    const pastClosing = Boolean(deal.data.closingDate && deal.data.closingDate < today());
    if (!stale && !pastClosing) continue;
    const name = deal.data.dealName || "deal";
    const task = await addFollowUpTask(userId, tasks, `deal:${deal.id}`, {
      subject: `Follow up on deal ${name}`,
      owner: deal.data.owner || "",
      relatedType: "Deal",
      relatedId: deal.id,
      related: name,
      contactId: deal.data.contactId || "",
      contact: deal.data.contact || "",
      description: pastClosing
        ? `Created by automation: the closing date (${deal.data.closingDate}) has passed and the deal is still ${deal.data.stage}. Update the stage or the closing date.`
        : `Created by automation: nothing on this deal has changed for ${days} or more days.`,
    });
    if (task) items.push({ kind: "crm-tasks", id: task.id, label: `Task: follow up ${name}${pastClosing ? " (closing date passed)" : ""}`, status: "Pending approval" });
  }
  return { items, errors: [], summary: items.length ? `Created ${plural(items.length, "follow-up task", "follow-up tasks")} for stale deals.` : "No open deal needs a follow-up." };
}

export async function runWonDealInvoices(userId: string): Promise<RuleResult> {
  const all = await rows(userId, ["crm-deals", "estimates", "invoices"]);
  const linked = new Set(all.filter((row) => row.kind !== "crm-deals").map((row) => row.data.crmDealId).filter(Boolean));
  const items: AutomationItem[] = [];
  const errors: string[] = [];
  for (const deal of all.filter((row) => row.kind === "crm-deals")) {
    if (deal.data.stage !== "Closed Won" || deal.data.autoInvoiced === "true" || deal.data.documents || linked.has(deal.id)) continue;
    const name = deal.data.dealName || "Deal";
    try {
      const created = await createDocumentFromDeal(deal.id, "invoices");
      // Flag the deal so a rejected draft isn't made again tomorrow.
      const [current] = await db.select().from(bookkeepingRecord).where(eq(bookkeepingRecord.id, deal.id)).limit(1);
      if (current) await db.update(bookkeepingRecord).set({ data: { ...current.data, autoInvoiced: "true" } }).where(eq(bookkeepingRecord.id, deal.id));
      items.push({ kind: "invoices", id: created.id, label: `Invoice ${created.number} · ${deal.data.account || name}`, status: "Pending approval" });
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : "invoice not created"}`);
    }
  }
  const summary = items.length
    ? `Created ${plural(items.length, "draft invoice", "draft invoices")} for won deals.`
    : errors.length ? `Couldn’t invoice ${plural(errors.length, "won deal", "won deals")}.` : "Every won deal already has a quote or invoice.";
  return { items, errors, summary };
}

export async function runOverdueTasks(userId: string, days: number): Promise<RuleResult> {
  const tasks = await rows(userId, ["crm-tasks"]);
  const cutoff = daysAgo(days);
  const items: AutomationItem[] = [];
  for (const task of tasks) {
    if (task.data.status === "Completed" || !task.data.dueDate || task.data.dueDate > cutoff) continue;
    if (task.data.priority === "High" || task.data.priority === "Highest") continue;
    const restore = { priority: task.data.priority || "", history: task.data.history || "" };
    await db.update(bookkeepingRecord).set({
      data: { ...task.data, priority: "High", history: addHistory(task.data, `Priority raised from “${task.data.priority || "—"}” to “High”: overdue since ${task.data.dueDate}`) },
      updatedAt: new Date(),
    }).where(eq(bookkeepingRecord.id, task.id));
    items.push({ kind: "crm-tasks", id: task.id, label: `${task.data.subject || "Task"} · due ${task.data.dueDate} → High priority`, status: "Pending approval", onReject: "restore", restore });
  }
  return { items, errors: [], summary: items.length ? `Raised ${plural(items.length, "overdue task", "overdue tasks")} to High priority.` : "No overdue task needed raising." };
}

export async function runCaseEscalation(userId: string, days: number): Promise<RuleResult> {
  const cases = await rows(userId, ["crm-cases"]);
  const cutoff = daysAgo(days);
  const items: AutomationItem[] = [];
  for (const item of cases) {
    if (!["New", "On Hold", ""].includes(item.data.status ?? "")) continue;
    if (item.createdAt.toISOString().slice(0, 10) > cutoff) continue;
    const restore = { status: item.data.status || "", priority: item.data.priority || "", history: item.data.history || "" };
    await db.update(bookkeepingRecord).set({
      data: { ...item.data, status: "Escalated", priority: "High", history: addHistory(item.data, `Escalated by automation: open for ${days} or more days`) },
      updatedAt: new Date(),
    }).where(eq(bookkeepingRecord.id, item.id));
    items.push({ kind: "crm-cases", id: item.id, label: `${item.data.caseNumber || "Case"} · ${item.data.subject || ""} → Escalated`, status: "Pending approval", onReject: "restore", restore });
  }
  return { items, errors: [], summary: items.length ? `Escalated ${plural(items.length, "case", "cases")}.` : "No case needed escalating." };
}
