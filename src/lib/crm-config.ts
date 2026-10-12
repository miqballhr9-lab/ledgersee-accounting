/**
 * The CRM module, modelled on Zoho CRM as it works alongside Zoho Books.
 *
 * Accounts are the customers you already invoice, so a deal won in the CRM
 * becomes a quote or an invoice without retyping anything. Every other CRM
 * module (leads, contacts, deals, activities, campaigns, cases, solutions) is
 * its own record kind, described here once and shared by the screens and the
 * server actions.
 */
import type { RecordKind } from "@/lib/bookkeeping-types";

export type CrmFieldType =
  | "text" | "email" | "phone" | "url" | "number" | "currency" | "percent" | "date" | "datetime"
  | "select" | "textarea" | "checkbox" | "owner"
  /** Lookups store the record's id in `<key>Id` and its display name in `<key>`. */
  | "account" | "contact" | "deal" | "campaign"
  /** "Related to": a lead, contact, account, deal, campaign or case, stored as relatedType / relatedId / related. */
  | "related";

export interface CrmField {
  key: string;
  label: string;
  type?: CrmFieldType;
  section: string;
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  /** Spans both columns of the form. */
  wide?: boolean;
  /** Calculated from other fields; shown but not edited. */
  readOnly?: boolean;
}

export type CrmModuleKey = "leads" | "contacts" | "deals" | "tasks" | "meetings" | "calls" | "campaigns" | "cases" | "solutions";

export interface CrmModule {
  key: CrmModuleKey;
  kind: RecordKind;
  label: string;
  plural: string;
  description: string;
  /** Field that heads a record (its name in lists, lookups and the timeline). */
  titleKey: string;
  /** The select that colours the badge and groups the Kanban board. */
  statusKey?: string;
  /** Columns shown in the list until someone customises them. */
  columns: readonly string[];
  fields: readonly CrmField[];
  /** Auto-numbered field, e.g. CS-0001 for cases. */
  numbering?: { key: string; prefix: string };
  /** The list can switch to a Kanban board grouped by this select. */
  kanbanKey?: string;
  /** Amount summed in each Kanban column. */
  kanbanAmountKey?: string;
}

export const leadSources = [
  "Advertisement", "Cold Call", "Employee Referral", "External Referral", "Online Store", "Partner", "Public Relations",
  "Sales Email Alias", "Seminar Partner", "Internal Seminar", "Trade Show", "Web Download", "Web Research", "Chat",
  "Facebook", "LinkedIn", "WhatsApp", "X (Twitter)",
] as const;

export const industries = [
  "ASP (Application Service Provider)", "Data/Telecom OEM", "ERP (Enterprise Resource Planning)", "Government/Military",
  "Large Enterprise", "Management ISV", "MSP (Management Service Provider)", "Network Equipment Enterprise",
  "Non-management ISV", "Optical Networking", "Service Provider", "Small/Medium Enterprise", "Storage Equipment",
  "Storage Service Provider", "Systems Integrator", "Wireless Industry", "Retail", "Manufacturing", "Education",
  "Healthcare", "Real Estate", "Construction", "Textile", "Agriculture", "Transport & Logistics", "Hospitality", "Other",
] as const;

export const salutations = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."] as const;

export const leadStatuses = [
  "Not Contacted", "Attempted to Contact", "Contact in Future", "Contacted", "Pre-Qualified", "Not Qualified", "Junk Lead", "Lost Lead", "Converted",
] as const;

/** Deal stages and the probability Zoho CRM gives each one by default. */
export const dealStages = [
  { stage: "Qualification", probability: 10, forecast: "Pipeline" },
  { stage: "Needs Analysis", probability: 20, forecast: "Pipeline" },
  { stage: "Value Proposition", probability: 40, forecast: "Pipeline" },
  { stage: "Identify Decision Makers", probability: 60, forecast: "Pipeline" },
  { stage: "Proposal/Price Quote", probability: 75, forecast: "Pipeline" },
  { stage: "Negotiation/Review", probability: 90, forecast: "Pipeline" },
  { stage: "Closed Won", probability: 100, forecast: "Closed" },
  { stage: "Closed Lost", probability: 0, forecast: "Omitted" },
  { stage: "Closed Lost to Competition", probability: 0, forecast: "Omitted" },
] as const;

export function stageProbability(stage: string) {
  return dealStages.find((item) => item.stage === stage)?.probability;
}

export function isClosedStage(stage: string | undefined) {
  return Boolean(stage?.startsWith("Closed"));
}

export const taskStatuses = ["Not Started", "Deferred", "In Progress", "Completed", "Waiting for input"] as const;
export const priorities = ["Highest", "High", "Normal", "Low", "Lowest"] as const;
export const relatedTypes = ["Lead", "Contact", "Account", "Deal", "Campaign", "Case"] as const;
export type RelatedType = (typeof relatedTypes)[number];

const address = (prefix: string, section: string): CrmField[] => [
  { key: `${prefix}Street`, label: "Street", section, wide: true },
  { key: `${prefix}City`, label: "City", section },
  { key: `${prefix}State`, label: "State / province", section },
  { key: `${prefix}Zip`, label: "Zip / postal code", section },
  { key: `${prefix}Country`, label: "Country", section },
];

export const crmModules: readonly CrmModule[] = [
  {
    key: "leads", kind: "crm-leads", label: "Lead", plural: "Leads",
    description: "People and companies who may buy from you. Qualify them, then convert the good ones into an account, a contact and a deal.",
    titleKey: "fullName", statusKey: "leadStatus", kanbanKey: "leadStatus",
    columns: ["fullName", "company", "email", "phone", "leadSource", "leadStatus", "owner"],
    fields: [
      { key: "owner", label: "Lead owner", type: "owner", section: "Lead information" },
      { key: "company", label: "Company", section: "Lead information", required: true },
      { key: "salutation", label: "Salutation", type: "select", options: salutations, section: "Lead information" },
      { key: "firstName", label: "First name", section: "Lead information" },
      { key: "lastName", label: "Last name", section: "Lead information", required: true },
      { key: "title", label: "Title", section: "Lead information", placeholder: "e.g. Purchase manager" },
      { key: "email", label: "Email", type: "email", section: "Lead information" },
      { key: "secondaryEmail", label: "Secondary email", type: "email", section: "Lead information" },
      { key: "phone", label: "Phone", type: "phone", section: "Lead information" },
      { key: "mobile", label: "Mobile", type: "phone", section: "Lead information" },
      { key: "fax", label: "Fax", section: "Lead information" },
      { key: "website", label: "Website", type: "url", section: "Lead information" },
      { key: "leadSource", label: "Lead source", type: "select", options: leadSources, section: "Lead information" },
      { key: "leadStatus", label: "Lead status", type: "select", options: leadStatuses.filter((status) => status !== "Converted"), section: "Lead information" },
      { key: "industry", label: "Industry", type: "select", options: industries, section: "Lead information" },
      { key: "employees", label: "No. of employees", type: "number", section: "Lead information" },
      { key: "annualRevenue", label: "Annual revenue", type: "currency", section: "Lead information" },
      { key: "rating", label: "Rating", type: "select", options: ["Acquired", "Active", "Market Failed", "Project Cancelled", "Shut Down"], section: "Lead information" },
      { key: "campaign", label: "Campaign source", type: "campaign", section: "Lead information" },
      { key: "emailOptOut", label: "Email opt out", type: "checkbox", section: "Lead information" },
      { key: "skypeId", label: "Skype ID", section: "Lead information" },
      { key: "twitter", label: "X (Twitter)", section: "Lead information", placeholder: "@handle" },
      ...address("address", "Address information"),
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "contacts", kind: "crm-contacts", label: "Contact", plural: "Contacts",
    description: "The people you deal with at each account, with every call, meeting and deal they're part of.",
    titleKey: "fullName",
    columns: ["fullName", "account", "email", "phone", "title", "owner"],
    fields: [
      { key: "owner", label: "Contact owner", type: "owner", section: "Contact information" },
      { key: "salutation", label: "Salutation", type: "select", options: salutations, section: "Contact information" },
      { key: "firstName", label: "First name", section: "Contact information" },
      { key: "lastName", label: "Last name", section: "Contact information", required: true },
      { key: "account", label: "Account name", type: "account", section: "Contact information", help: "Accounts are your customers in Sales." },
      { key: "title", label: "Title", section: "Contact information" },
      { key: "department", label: "Department", section: "Contact information" },
      { key: "email", label: "Email", type: "email", section: "Contact information" },
      { key: "secondaryEmail", label: "Secondary email", type: "email", section: "Contact information" },
      { key: "phone", label: "Phone", type: "phone", section: "Contact information" },
      { key: "mobile", label: "Mobile", type: "phone", section: "Contact information" },
      { key: "homePhone", label: "Home phone", type: "phone", section: "Contact information" },
      { key: "otherPhone", label: "Other phone", type: "phone", section: "Contact information" },
      { key: "assistant", label: "Assistant", section: "Contact information" },
      { key: "assistantPhone", label: "Assistant phone", type: "phone", section: "Contact information" },
      { key: "reportsTo", label: "Reports to", type: "contact", section: "Contact information" },
      { key: "dateOfBirth", label: "Date of birth", type: "date", section: "Contact information" },
      { key: "leadSource", label: "Lead source", type: "select", options: leadSources, section: "Contact information" },
      { key: "campaign", label: "Campaign source", type: "campaign", section: "Contact information" },
      { key: "emailOptOut", label: "Email opt out", type: "checkbox", section: "Contact information" },
      { key: "skypeId", label: "Skype ID", section: "Contact information" },
      { key: "twitter", label: "X (Twitter)", section: "Contact information" },
      ...address("mailing", "Mailing address"),
      ...address("other", "Other address"),
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "deals", kind: "crm-deals", label: "Deal", plural: "Deals",
    description: "Every sale you're working on, stage by stage. Drag deals across the pipeline, then turn a won deal into a quote or an invoice.",
    titleKey: "dealName", statusKey: "stage", kanbanKey: "stage", kanbanAmountKey: "amount",
    columns: ["dealName", "account", "amount", "stage", "closingDate", "contact", "owner"],
    fields: [
      { key: "owner", label: "Deal owner", type: "owner", section: "Deal information" },
      { key: "dealName", label: "Deal name", section: "Deal information", required: true },
      { key: "account", label: "Account name", type: "account", section: "Deal information", required: true },
      { key: "contact", label: "Contact name", type: "contact", section: "Deal information" },
      { key: "type", label: "Type", type: "select", options: ["New Business", "Existing Business"], section: "Deal information" },
      { key: "amount", label: "Amount", type: "currency", section: "Deal information" },
      { key: "closingDate", label: "Closing date", type: "date", section: "Deal information", required: true },
      { key: "stage", label: "Stage", type: "select", options: dealStages.map((item) => item.stage), section: "Deal information", required: true },
      { key: "probability", label: "Probability (%)", type: "percent", section: "Deal information", help: "Set from the stage; you can change it." },
      { key: "expectedRevenue", label: "Expected revenue", type: "currency", section: "Deal information", readOnly: true, help: "Amount × probability." },
      { key: "nextStep", label: "Next step", section: "Deal information" },
      { key: "leadSource", label: "Lead source", type: "select", options: leadSources, section: "Deal information" },
      { key: "campaign", label: "Campaign source", type: "campaign", section: "Deal information" },
      { key: "lossReason", label: "Reason for loss", type: "select", options: ["Price", "Competitor", "No budget", "No decision", "Product fit", "Timing", "Other"], section: "Deal information" },
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "tasks", kind: "crm-tasks", label: "Task", plural: "Tasks",
    description: "To-dos for your team, each tied to the lead, contact, account or deal it's about.",
    titleKey: "subject", statusKey: "status", kanbanKey: "status",
    columns: ["subject", "dueDate", "status", "priority", "related", "owner"],
    fields: [
      { key: "owner", label: "Task owner", type: "owner", section: "Task information" },
      { key: "subject", label: "Subject", section: "Task information", required: true, wide: true },
      { key: "dueDate", label: "Due date", type: "date", section: "Task information" },
      { key: "status", label: "Status", type: "select", options: taskStatuses, section: "Task information" },
      { key: "priority", label: "Priority", type: "select", options: priorities, section: "Task information" },
      { key: "related", label: "Related to", type: "related", section: "Task information", wide: true },
      { key: "contact", label: "Contact", type: "contact", section: "Task information" },
      { key: "reminder", label: "Reminder", type: "datetime", section: "Task information" },
      { key: "repeat", label: "Repeat", type: "select", options: ["Never", "Daily", "Weekly", "Monthly", "Yearly"], section: "Task information" },
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "meetings", kind: "crm-meetings", label: "Meeting", plural: "Meetings",
    description: "Meetings with leads and customers, with who is coming and what they're about.",
    titleKey: "title",
    columns: ["title", "from", "to", "location", "related", "owner"],
    fields: [
      { key: "title", label: "Title", section: "Meeting information", required: true, wide: true },
      { key: "location", label: "Location", section: "Meeting information", placeholder: "Office, client site or a video link" },
      { key: "allDay", label: "All day", type: "checkbox", section: "Meeting information" },
      { key: "from", label: "From", type: "datetime", section: "Meeting information", required: true },
      { key: "to", label: "To", type: "datetime", section: "Meeting information" },
      { key: "owner", label: "Host", type: "owner", section: "Meeting information" },
      { key: "participants", label: "Participants", section: "Meeting information", placeholder: "Names or emails, separated by commas", wide: true },
      { key: "related", label: "Related to", type: "related", section: "Meeting information", wide: true },
      { key: "contact", label: "Contact", type: "contact", section: "Meeting information" },
      { key: "reminder", label: "Reminder", type: "select", options: ["None", "5 minutes before", "15 minutes before", "30 minutes before", "1 hour before", "1 day before"], section: "Meeting information" },
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "calls", kind: "crm-calls", label: "Call", plural: "Calls",
    description: "Log calls you made and received, and schedule the ones you still need to make.",
    titleKey: "subject", statusKey: "callStatus",
    columns: ["subject", "callType", "callStatus", "startTime", "duration", "related", "owner"],
    fields: [
      { key: "subject", label: "Subject", section: "Call information", required: true, wide: true },
      { key: "callType", label: "Call type", type: "select", options: ["Outbound", "Inbound", "Missed"], section: "Call information", required: true },
      { key: "callStatus", label: "Call status", type: "select", options: ["Scheduled", "Completed", "Cancelled", "No answer"], section: "Call information" },
      { key: "startTime", label: "Call start time", type: "datetime", section: "Call information", required: true },
      { key: "duration", label: "Duration (minutes)", type: "number", section: "Call information" },
      { key: "owner", label: "Call owner", type: "owner", section: "Call information" },
      { key: "related", label: "Related to", type: "related", section: "Call information", wide: true },
      { key: "contact", label: "Contact", type: "contact", section: "Call information" },
      { key: "callPurpose", label: "Call purpose", type: "select", options: ["Prospecting", "Administrative", "Negotiation", "Demo", "Project", "Desk"], section: "Purpose of call" },
      { key: "callAgenda", label: "Call agenda", type: "textarea", section: "Purpose of call", wide: true },
      { key: "callResult", label: "Call result", type: "select", options: ["Interested", "Not interested", "No response", "Busy", "Requested more info", "Requested call back", "Invalid number"], section: "Outcome of call" },
      { key: "description", label: "Description", type: "textarea", section: "Outcome of call", wide: true },
    ],
  },
  {
    key: "campaigns", kind: "crm-campaigns", label: "Campaign", plural: "Campaigns",
    description: "Marketing campaigns, what they cost, and the leads and deals they bring in.",
    titleKey: "campaignName", statusKey: "status",
    columns: ["campaignName", "type", "status", "startDate", "endDate", "budgetedCost", "expectedRevenue", "owner"],
    fields: [
      { key: "owner", label: "Campaign owner", type: "owner", section: "Campaign information" },
      { key: "campaignName", label: "Campaign name", section: "Campaign information", required: true },
      { key: "type", label: "Type", type: "select", options: ["Advertisement", "Banner Ads", "Conference", "Direct mail", "Email", "Partner", "Public Relations", "Referral Program", "Social media", "Telemarketing", "Trade Show", "Webinar", "Others"], section: "Campaign information" },
      { key: "status", label: "Status", type: "select", options: ["Planning", "Active", "Inactive", "Complete"], section: "Campaign information" },
      { key: "startDate", label: "Start date", type: "date", section: "Campaign information" },
      { key: "endDate", label: "End date", type: "date", section: "Campaign information" },
      { key: "expectedRevenue", label: "Expected revenue", type: "currency", section: "Campaign information" },
      { key: "budgetedCost", label: "Budgeted cost", type: "currency", section: "Campaign information" },
      { key: "actualCost", label: "Actual cost", type: "currency", section: "Campaign information" },
      { key: "expectedResponse", label: "Expected response (%)", type: "percent", section: "Campaign information" },
      { key: "numbersSent", label: "Numbers sent", type: "number", section: "Campaign information" },
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
    ],
  },
  {
    key: "cases", kind: "crm-cases", label: "Case", plural: "Cases",
    description: "Customer questions, problems and requests, tracked until they're solved.",
    titleKey: "subject", statusKey: "status", kanbanKey: "status", numbering: { key: "caseNumber", prefix: "CS-" },
    columns: ["caseNumber", "subject", "account", "status", "priority", "caseOrigin", "owner"],
    fields: [
      { key: "caseNumber", label: "Case number", section: "Case information", readOnly: true },
      { key: "owner", label: "Case owner", type: "owner", section: "Case information" },
      { key: "subject", label: "Subject", section: "Case information", required: true, wide: true },
      { key: "status", label: "Status", type: "select", options: ["New", "On Hold", "Escalated", "Closed"], section: "Case information" },
      { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"], section: "Case information" },
      { key: "caseOrigin", label: "Case origin", type: "select", options: ["Email", "Phone", "Web", "WhatsApp", "Walk-in"], section: "Case information" },
      { key: "type", label: "Type", type: "select", options: ["Question", "Problem", "Feature Request"], section: "Case information" },
      { key: "caseReason", label: "Case reason", type: "select", options: ["User did not attend any training", "Complex functionality", "Existing problem", "Instructions not understood", "New problem", "Other"], section: "Case information" },
      { key: "account", label: "Account name", type: "account", section: "Case information" },
      { key: "contact", label: "Contact name", type: "contact", section: "Case information" },
      { key: "deal", label: "Deal name", type: "deal", section: "Case information" },
      { key: "product", label: "Product name", section: "Case information" },
      { key: "email", label: "Email", type: "email", section: "Case information" },
      { key: "phone", label: "Phone", type: "phone", section: "Case information" },
      { key: "reportedBy", label: "Reported by", section: "Case information" },
      { key: "description", label: "Description", type: "textarea", section: "Description information", wide: true },
      { key: "internalComments", label: "Internal comments", type: "textarea", section: "Description information", wide: true },
      { key: "solution", label: "Solution", type: "textarea", section: "Solution information", wide: true },
    ],
  },
  {
    key: "solutions", kind: "crm-solutions", label: "Solution", plural: "Solutions",
    description: "Answers to common questions, ready to reuse when a case comes in.",
    titleKey: "solutionTitle", statusKey: "status", numbering: { key: "solutionNumber", prefix: "SOL-" },
    columns: ["solutionNumber", "solutionTitle", "product", "status", "owner"],
    fields: [
      { key: "solutionNumber", label: "Solution number", section: "Solution information", readOnly: true },
      { key: "owner", label: "Solution owner", type: "owner", section: "Solution information" },
      { key: "solutionTitle", label: "Solution title", section: "Solution information", required: true, wide: true },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Reviewed", "Published"], section: "Solution information" },
      { key: "product", label: "Product name", section: "Solution information" },
      { key: "question", label: "Question", type: "textarea", section: "Solution details", required: true, wide: true },
      { key: "answer", label: "Answer", type: "textarea", section: "Solution details", required: true, wide: true },
      { key: "comments", label: "Comments", type: "textarea", section: "Solution details", wide: true },
    ],
  },
];

export const crmKinds = crmModules.map((module) => module.kind);

export function crmModule(key: string): CrmModule | undefined {
  return crmModules.find((module) => module.key === key);
}

export function crmModuleByKind(kind: string): CrmModule | undefined {
  return crmModules.find((module) => module.kind === kind);
}

/** Pages under /app/crm. Activities shows tasks, meetings and calls together. */
export const crmPages = ["leads", "contacts", "accounts", "deals", "activities", "campaigns", "cases", "solutions"] as const;
export type CrmPage = (typeof crmPages)[number];

export function fullName(data: Record<string, string>) {
  return [data.salutation, data.firstName, data.lastName].filter((part) => part?.trim()).join(" ").trim();
}

/** The name a record goes by, whatever its module. */
export function crmTitle(module: CrmModule, data: Record<string, string>) {
  if (module.titleKey === "fullName") return fullName(data) || data.company || "Untitled";
  return data[module.titleKey]?.trim() || "Untitled";
}

export const relatedKind: Record<RelatedType, RecordKind> = {
  Lead: "crm-leads",
  Contact: "crm-contacts",
  Account: "customers",
  Deal: "crm-deals",
  Campaign: "crm-campaigns",
  Case: "crm-cases",
};

/** Where a related record opens. */
export function relatedHref(type: string, id: string) {
  const page: Record<string, string> = { Lead: "leads", Contact: "contacts", Account: "accounts", Deal: "deals", Campaign: "campaigns", Case: "cases" };
  return page[type] ? `/app/crm/${page[type]}?open=${encodeURIComponent(id)}` : "/app/crm";
}

/** Badge colour for a status or stage, so the same word always looks the same. */
export function statusTone(value: string | undefined): "good" | "bad" | "warn" | "info" | "neutral" {
  if (!value) return "neutral";
  if (["Closed Won", "Completed", "Converted", "Published", "Complete", "Closed", "Active", "Pre-Qualified", "Contacted"].includes(value)) return "good";
  if (["Closed Lost", "Closed Lost to Competition", "Junk Lead", "Lost Lead", "Not Qualified", "Cancelled", "No answer", "Escalated", "Inactive"].includes(value)) return "bad";
  if (["Negotiation/Review", "Proposal/Price Quote", "In Progress", "Waiting for input", "On Hold", "Scheduled", "Planning", "Reviewed", "Attempted to Contact", "Contact in Future"].includes(value)) return "warn";
  if (["New", "Not Started", "Not Contacted", "Qualification", "Draft"].includes(value)) return "info";
  return "neutral";
}

export interface CrmHistoryEntry {
  at: string;
  by: string;
  text: string;
}

export function parseHistory(value: string | undefined): CrmHistoryEntry[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      return typeof item.at === "string" && typeof item.text === "string"
        ? [{ at: item.at, by: typeof item.by === "string" ? item.by : "", text: item.text }]
        : [];
    });
  } catch {
    return [];
  }
}
