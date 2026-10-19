import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmModuleByKind, crmTitle, statusTone, type CrmField, type CrmModule } from "@/lib/crm-config";

/** Every record the CRM screens work with, grouped by kind. */
export type CrmStore = Record<string, BookkeepingRecord[]>;

export interface CrmContextValue {
  store: CrmStore;
  currency: string;
  me: string;
  owners: string[];
  /** Puts saved records into the store, replacing any with the same id. */
  upsert: (records: BookkeepingRecord[]) => void;
  /** Removes records from the store. */
  remove: (kind: string, ids: string[]) => void;
  /** The business's weekly days off, as UTC day numbers (HR pages). */
  weekend?: number[];
  /** False when the business has the CRM app without Accounting: quotes, but no invoices. */
  accounting?: boolean;
}

export function errorText(error: unknown) {
  return error instanceof Error ? readableError(error) : "Something went wrong. Please try again.";
}

export function formatMoney(value: string | number | undefined, currency: string) {
  const number = Number(value || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(number) ? number : 0);
  } catch {
    return `${currency} ${(Number.isFinite(number) ? number : 0).toFixed(2)}`;
  }
}

export function formatDateTime(value: string | undefined) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}

export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The text a field shows in lists and on the detail page. */
export function displayValue(field: CrmField | undefined, data: Record<string, string>, key: string, currency: string) {
  const value = data[key] ?? "";
  if (!field) return value;
  if (field.type === "checkbox") return value === "true" ? "Yes" : "No";
  if (!value) return "";
  if (field.type === "currency") return formatMoney(value, currency);
  if (field.type === "percent") return `${value}%`;
  if (field.type === "datetime") return formatDateTime(value);
  if (field.type === "related") return data.related ? `${data.relatedType}: ${data.related}` : "";
  if (field.type === "file") return data[`${key}Name`] || "File";
  return value;
}

export function fieldFor(mod: CrmModule, key: string): CrmField | undefined {
  if (key === "fullName") return { key, label: mod.key === "leads" ? "Lead name" : "Contact name", section: "" };
  return mod.fields.find((field) => field.key === key);
}

export function recordTitle(record: BookkeepingRecord) {
  if (record.kind === "customers") return record.data.name || "Customer";
  if (record.kind === "employees") return record.data.name || "Employee";
  if (record.kind === "items") return record.data.name || "Item";
  const mod = crmModuleByKind(record.kind);
  return mod ? crmTitle(mod, record.data) : "Record";
}

const toneClasses: Record<ReturnType<typeof statusTone>, string> = {
  good: "bg-accent text-accent-foreground",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-chart-3/20 text-foreground",
  info: "bg-primary/10 text-primary",
  neutral: "bg-secondary text-secondary-foreground",
};

export function StatusBadge({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses[statusTone(value)]}`}>{value}</span>;
}

/** Initials in a circle, as Zoho shows record owners and contacts. */
export function Initials({ name, className = "" }: { name: string; className?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  return <span className={`grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary ${className}`}>{letters}</span>;
}

export function toCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Records whose "Related to", contact or account lookup points at this record. */
export function activitiesFor(store: CrmStore, record: BookkeepingRecord) {
  const type = record.kind === "customers" ? "Account" : record.kind === "crm-leads" ? "Lead" : record.kind === "crm-contacts" ? "Contact" : record.kind === "crm-deals" ? "Deal" : record.kind === "crm-campaigns" ? "Campaign" : record.kind === "crm-cases" ? "Case" : "";
  return ["crm-tasks", "crm-meetings", "crm-calls"].flatMap((kind) => (store[kind] ?? []).filter((activity) =>
    (activity.data.relatedType === type && activity.data.relatedId === record.id) ||
    (record.kind === "crm-contacts" && activity.data.contactId === record.id),
  ));
}

/** Whether an activity is still to be done. */
export function isOpenActivity(record: BookkeepingRecord) {
  if (record.kind === "crm-tasks") return record.data.status !== "Completed";
  if (record.kind === "crm-calls") return record.data.callStatus === "Scheduled";
  if (record.kind === "crm-meetings") return (record.data.to || record.data.from || "") >= `${today()}T00:00`;
  return false;
}

export function activityWhen(record: BookkeepingRecord) {
  if (record.kind === "crm-tasks") return record.data.dueDate || "";
  if (record.kind === "crm-calls") return formatDateTime(record.data.startTime);
  return formatDateTime(record.data.from);
}
