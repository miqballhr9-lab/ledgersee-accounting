/**
 * Automation mode, modelled on Odoo's automation rules and scheduled actions.
 *
 * In Manual mode nothing runs on its own; the app behaves exactly as before.
 * In Automation mode each active rule runs when it is due (checked whenever the
 * owner opens the app) or straight away with "Run now". What a rule creates can
 * wait in the Approvals inbox until someone approves or rejects it.
 */

export type AutomationMode = "Manual" | "Automation";
export type AutomationAction = "monthlyPayroll" | "recurringInvoices";
export type AutomationTrigger = "monthly" | "daily";

export interface AutomationTemplate {
  action: AutomationAction;
  name: string;
  model: string;
  description: string;
  trigger: AutomationTrigger;
  dayOfMonth: string;
}

/** The actions a rule can perform. Each one is a ready-made "Action to do", as in Odoo. */
export const automationTemplates: readonly AutomationTemplate[] = [
  {
    action: "monthlyPayroll",
    name: "Create monthly payroll",
    model: "Payroll",
    description: "Adds this month's salary for every active employee who has none yet, copying last month's figures (or the employee's base salary). Entries are created unpaid.",
    trigger: "monthly",
    dayOfMonth: "1",
  },
  {
    action: "recurringInvoices",
    name: "Generate due recurring invoices",
    model: "Recurring invoices",
    description: "Creates a draft invoice for every active recurring schedule whose next invoice date has arrived, then moves the schedule to its next date.",
    trigger: "daily",
    dayOfMonth: "1",
  },
];

export function automationTemplate(action: string) {
  return automationTemplates.find((template) => template.action === action);
}

export function isAutomationAction(value: unknown): value is AutomationAction {
  return automationTemplates.some((template) => template.action === value);
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The first date on or after `from` (or strictly after, when `after` is set) on which the trigger fires. */
export function nextExecutionDate(trigger: AutomationTrigger, dayOfMonth: string, from: string, after = false): string {
  const [year, month, day] = from.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  if (trigger === "daily") {
    if (after) start.setDate(start.getDate() + 1);
    return isoDate(start);
  }
  const wanted = Math.min(28, Math.max(1, Number(dayOfMonth) || 1));
  const candidate = new Date(start.getFullYear(), start.getMonth(), wanted);
  if (candidate < start || (after && isoDate(candidate) === isoDate(start))) candidate.setMonth(candidate.getMonth() + 1);
  return isoDate(candidate);
}

export function describeTrigger(trigger: string, dayOfMonth: string) {
  if (trigger === "daily") return "Every day";
  const day = Math.min(28, Math.max(1, Number(dayOfMonth) || 1));
  const suffix = day === 1 || day === 21 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `Every month on the ${day}${suffix}`;
}

export interface AutomationItem {
  kind: string;
  id: string;
  label: string;
  status: "Pending approval" | "Approved" | "Rejected" | "Done";
}

export function parseAutomationItems(value: string | undefined): AutomationItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.kind !== "string") return [];
      const status = entry.status === "Approved" || entry.status === "Rejected" || entry.status === "Done" ? entry.status : "Pending approval";
      return [{ kind: entry.kind, id: entry.id, label: typeof entry.label === "string" ? entry.label : entry.kind, status }];
    });
  } catch {
    return [];
  }
}
