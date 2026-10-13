/**
 * Automation mode, modelled on Odoo's automation rules and scheduled actions.
 *
 * In Manual mode nothing runs on its own; the app behaves exactly as before.
 * In Automation mode each active rule runs when it is due (checked whenever the
 * owner opens the app) or straight away with "Run now". What a rule creates can
 * wait in the Approvals inbox until someone approves or rejects it.
 */

export type AutomationMode = "Manual" | "Automation";
export type AutomationAction =
  | "monthlyPayroll" | "recurringInvoices" | "bankRules" | "overdueReminders"
  | "crmLeadFollowUp" | "crmStaleDeals" | "crmWonDealInvoices" | "crmOverdueTasks" | "crmCaseEscalation";
export type AutomationTrigger = "monthly" | "daily";

export interface AutomationTemplate {
  action: AutomationAction;
  name: string;
  model: string;
  description: string;
  trigger: AutomationTrigger;
  dayOfMonth: string;
  /** Conditions this action understands, shown as "Apply when…" fields on the rule. */
  conditions?: readonly { key: "days" | "minAmount"; label: string; help: string; defaultValue: string }[];
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
    name: "Generate due recurring transactions",
    model: "Recurring transactions",
    description: "Creates a draft invoice for every active recurring invoice schedule, and the invoice, bill, expense or journal for every scheduled recurring template, whose next date has arrived, then moves each schedule to its next date.",
    trigger: "daily",
    dayOfMonth: "1",
  },
  {
    action: "bankRules",
    name: "Match bank transactions with bank rules",
    model: "Bank transactions",
    description: "Finds unmatched bank transactions whose description fits an enabled bank rule, fills in the rule's category and account, and marks them matched. Rejecting a match puts the transaction back as it was.",
    trigger: "daily",
    dayOfMonth: "1",
  },
  {
    action: "overdueReminders",
    name: "Email overdue invoice reminders",
    model: "Invoices",
    description: "Emails a payment reminder to each customer whose invoice is unpaid past its due date, at most once a week per invoice. With approval on, nothing is sent until you approve it.",
    trigger: "daily",
    dayOfMonth: "1",
    conditions: [
      { key: "days", label: "Overdue by at least (days)", help: "Only invoices this many days past their due date.", defaultValue: "7" },
      { key: "minAmount", label: "Balance at least", help: "Skip small balances below this amount.", defaultValue: "0" },
    ],
  },
  {
    action: "crmLeadFollowUp",
    name: "CRM: follow up new leads",
    model: "CRM leads",
    description: "Creates a “Call the lead” task for each lead still marked Not Contacted after the set days, assigned to the lead owner and due today. A lead gets one open follow-up task at a time.",
    trigger: "daily",
    dayOfMonth: "1",
    conditions: [
      { key: "days", label: "Not contacted for at least (days)", help: "Days since the lead was created.", defaultValue: "1" },
    ],
  },
  {
    action: "crmStaleDeals",
    name: "CRM: follow up stale deals",
    model: "CRM deals",
    description: "Creates a follow-up task for each open deal that hasn't changed in the set days, or whose closing date has passed, so no deal is forgotten.",
    trigger: "daily",
    dayOfMonth: "1",
    conditions: [
      { key: "days", label: "No change for at least (days)", help: "Deals untouched this long get a follow-up task.", defaultValue: "14" },
    ],
  },
  {
    action: "crmWonDealInvoices",
    name: "CRM: invoice won deals",
    model: "CRM deals → Invoices",
    description: "Creates a draft invoice in Sales for every Closed Won deal that has no quote or invoice yet, for the deal's account and amount. Rejecting deletes the draft.",
    trigger: "daily",
    dayOfMonth: "1",
  },
  {
    action: "crmOverdueTasks",
    name: "CRM: raise overdue tasks",
    model: "CRM tasks",
    description: "Raises the priority of open tasks overdue by the set days to High, so they top everyone's list. Rejecting puts the old priority back.",
    trigger: "daily",
    dayOfMonth: "1",
    conditions: [
      { key: "days", label: "Overdue by at least (days)", help: "Days past the task's due date.", defaultValue: "1" },
    ],
  },
  {
    action: "crmCaseEscalation",
    name: "CRM: escalate old cases",
    model: "CRM cases",
    description: "Marks New or On Hold cases older than the set days as Escalated with High priority. Rejecting puts the old status and priority back.",
    trigger: "daily",
    dayOfMonth: "1",
    conditions: [
      { key: "days", label: "Open for at least (days)", help: "Days since the case was created.", defaultValue: "3" },
    ],
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
  /** What approving does: keep the record (default) or send the queued reminder email. */
  onApprove?: "keep" | "sendReminder";
  /** What rejecting does: delete the record (default), restore earlier values, or simply skip. */
  onReject?: "delete" | "restore" | "skip";
  /** Field values to put back when a "restore" item is rejected. */
  restore?: Record<string, string>;
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
      const restore = entry.restore && typeof entry.restore === "object" && !Array.isArray(entry.restore)
        ? Object.fromEntries(Object.entries(entry.restore as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
        : undefined;
      return [{
        kind: entry.kind,
        id: entry.id,
        label: typeof entry.label === "string" ? entry.label : entry.kind,
        status,
        onApprove: entry.onApprove === "sendReminder" ? "sendReminder" : "keep",
        onReject: entry.onReject === "restore" || entry.onReject === "skip" ? entry.onReject : "delete",
        restore,
      }];
    });
  } catch {
    return [];
  }
}
