"use client";

import { useState } from "react";
import { toast } from "sonner";

import { getAttachmentUploadTarget } from "@/app/actions";
import { saveCrmRecord } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { relatedKind, relatedTypes, stageProbability, type CrmField, type CrmModule, type RelatedType } from "@/lib/crm-config";
import { errorText, formatMoney, recordTitle, today, type CrmContextValue } from "@/components/crm/crm-shared";

interface CrmRecordEditorProps {
  module: CrmModule;
  /** The record being edited, or null for a new one. */
  record: BookkeepingRecord | null;
  /** Values a new record starts with, e.g. "Related to" when created from a deal. */
  preset?: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: CrmContextValue;
  onSaved?: (record: BookkeepingRecord) => void;
}

const lookupKind: Partial<Record<NonNullable<CrmField["type"]>, string>> = {
  account: "customers",
  contact: "crm-contacts",
  deal: "crm-deals",
  campaign: "crm-campaigns",
  employee: "employees",
  department: "hr-departments",
  leaveType: "hr-leave-types",
  job: "hr-jobs",
};

function plusDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startValues(module: CrmModule, record: BookkeepingRecord | null, preset: Record<string, string> | undefined, me: string) {
  if (record) return { ...record.data };
  const values: Record<string, string> = { owner: me };
  const hour = `${today()}T${String(Math.min(new Date().getHours() + 1, 23)).padStart(2, "0")}:00`;
  if (module.kind === "crm-leads") values.leadStatus = "Not Contacted";
  if (module.kind === "crm-deals") {
    values.stage = "Qualification";
    values.probability = "10";
    values.closingDate = plusDays(30);
    values.type = "New Business";
  }
  if (module.kind === "crm-tasks") {
    values.status = "Not Started";
    values.priority = "Normal";
    values.dueDate = today();
    values.repeat = "Never";
  }
  if (module.kind === "crm-meetings") {
    values.from = hour;
    values.to = hour.replace(/T(\d{2})/, (_, h: string) => `T${String(Math.min(Number(h) + 1, 23)).padStart(2, "0")}`);
    values.reminder = "15 minutes before";
  }
  if (module.kind === "crm-calls") {
    values.callType = "Outbound";
    values.callStatus = "Scheduled";
    values.startTime = hour;
  }
  if (module.kind === "crm-campaigns") {
    values.status = "Planning";
    values.startDate = today();
  }
  if (module.kind === "crm-cases") {
    values.status = "New";
    values.priority = "Medium";
    values.caseOrigin = "Phone";
  }
  if (module.kind === "crm-solutions") values.status = "Draft";
  if (module.kind === "hr-attendance") Object.assign(values, { date: today(), status: "Present", checkIn: "09:00" });
  if (module.kind === "hr-leaves") Object.assign(values, { fromDate: today(), toDate: today(), status: "To Approve" });
  if (module.kind === "hr-allocations") Object.assign(values, { validFrom: `${new Date().getFullYear()}-01-01`, validTo: `${new Date().getFullYear()}-12-31`, status: "To Approve" });
  if (module.kind === "hr-loans") Object.assign(values, { loanType: "Loan", requestDate: today(), installments: "6", status: "To Approve" });
  if (module.kind === "hr-claims") Object.assign(values, { date: today(), status: "To Submit", paidBy: "Employee (to reimburse)" });
  if (module.kind === "hr-jobs") Object.assign(values, { status: "Recruiting", openings: "1", employmentType: "Full time" });
  if (module.kind === "hr-candidates") Object.assign(values, { stage: "New" });
  if (module.kind === "hr-onboarding") Object.assign(values, { status: "To Do", dueDate: today() });
  if (module.kind === "hr-appraisals") Object.assign(values, { status: "To Confirm", period: String(new Date().getFullYear()), reviewDate: today() });
  if (module.kind === "hr-settlements") Object.assign(values, { status: "Draft", reason: "Resigned", lastWorkingDay: today(), gratuityDaysPerYear: "30" });
  if (module.kind === "hr-leave-types") Object.assign(values, { paid: "true", daysPerYear: "14", approval: "By time off officer", requiresAllocation: "Yes" });
  if (!module.fields.some((field) => field.type === "owner")) delete values.owner;
  return { ...values, ...preset };
}

export default function CrmRecordEditor({ module, record, preset, open, onOpenChange, context, onSaved }: CrmRecordEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => startValues(module, record, preset, context.me));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  async function upload(key: string, file: File | undefined) {
    if (!file) return;
    setUploading(key);
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      set({ [key]: target.publicUrl, [`${key}Name`]: file.name });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setUploading(null);
    }
  }
  const [lastKey, setLastKey] = useState(`${record?.id ?? "new"}-${open}`);
  const key = `${record?.id ?? "new"}-${open}`;
  if (key !== lastKey) {
    setLastKey(key);
    setValues(startValues(module, record, preset, context.me));
  }

  function set(changes: Record<string, string>) {
    setValues((current) => {
      const next = { ...current, ...changes };
      if (module.kind === "crm-deals" && "stage" in changes) next.probability = String(stageProbability(changes.stage) ?? next.probability ?? "");
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await saveCrmRecord(module.kind, values, record?.id);
      context.upsert([saved]);
      toast.success(record ? `${module.label} updated.` : `${module.label} created.`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const sections = [...new Set(module.fields.map((field) => field.section))];
  const expected = module.kind === "crm-deals" ? (Number(values.amount || 0) * Number(values.probability || 0)) / 100 : 0;

  function optionsFor(kind: string) {
    return (context.store[kind] ?? [])
      .filter((option) => option.id !== record?.id && !(kind === "crm-leads" && option.data.leadStatus === "Converted"))
      .map((option) => ({ id: option.id, name: recordTitle(option) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderField(field: CrmField) {
    const id = `crm-${module.key}-${field.key}`;
    const value = values[field.key] ?? "";
    if (field.readOnly) {
      const shown = field.key === "expectedRevenue" ? formatMoney(expected, context.currency) : value || "Assigned when saved";
      return <Input id={id} value={shown} readOnly className="bg-muted/50" />;
    }
    if (field.type === "file") {
      return (
        <div className="space-y-1.5">
          <Input id={id} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploading === field.key} onChange={(event) => void upload(field.key, event.target.files?.[0])} />
          {uploading === field.key ? <p className="text-xs text-muted-foreground">Uploading…</p> : value ? <p className="flex items-center gap-2 text-xs"><a className="text-primary underline-offset-4 hover:underline" href={value} target="_blank" rel="noreferrer">{values[`${field.key}Name`] || "Uploaded file"}</a><button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => set({ [field.key]: "", [`${field.key}Name`]: "" })}>Remove</button></p> : null}
        </div>
      );
    }
    if (field.type === "textarea") return <Textarea id={id} rows={3} value={value} onChange={(event) => set({ [field.key]: event.target.value })} placeholder={field.placeholder} />;
    if (field.type === "checkbox") {
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox id={id} checked={value === "true"} onCheckedChange={(checked) => set({ [field.key]: checked ? "true" : "false" })} />
          {field.label}
        </label>
      );
    }
    if (field.type === "select" || field.type === "owner") {
      const options = field.type === "owner" ? [...new Set([...context.owners, value].filter(Boolean))] : [...(field.options ?? [])];
      return (
        <Select value={value || null} onValueChange={(next) => set({ [field.key]: String(next ?? "") })}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder="-None-" /></SelectTrigger>
          <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    const lookup = field.type ? lookupKind[field.type] : undefined;
    if (lookup) {
      const options = optionsFor(lookup);
      const idKey = `${field.key}Id`;
      return (
        <Select value={values[idKey] || null} onValueChange={(next) => {
          const chosen = options.find((option) => option.id === next);
          const changes: Record<string, string> = { [idKey]: chosen?.id ?? "", [field.key]: chosen?.name ?? "" };
          // Picking a contact fills in their account, as Zoho does.
          if (field.type === "contact" && chosen && module.fields.some((item) => item.type === "account") && !values.accountId) {
            const contact = context.store["crm-contacts"]?.find((item) => item.id === chosen.id);
            if (contact?.data.accountId) Object.assign(changes, { accountId: contact.data.accountId, account: contact.data.account });
          }
          set(changes);
        }}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder={options.length ? `Choose ${field.label.toLowerCase()}` : `No ${field.label.toLowerCase().replace(" name", "")}s yet`} /></SelectTrigger>
          <SelectContent>
            {values[idKey] ? <SelectItem value="">-None-</SelectItem> : null}
            {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (field.type === "related") {
      const type = (values.relatedType || "") as RelatedType | "";
      const options = type ? optionsFor(relatedKind[type]) : [];
      return (
        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2">
          <Select value={type || null} onValueChange={(next) => set({ relatedType: String(next ?? ""), relatedId: "", related: "" })}>
            <SelectTrigger id={id} className="w-full" aria-label="Related to type"><SelectValue placeholder="-None-" /></SelectTrigger>
            <SelectContent>
              {type ? <SelectItem value="">-None-</SelectItem> : null}
              {relatedTypes.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={values.relatedId || null} disabled={!type} onValueChange={(next) => {
            const chosen = options.find((option) => option.id === next);
            set({ relatedId: chosen?.id ?? "", related: chosen?.name ?? "" });
          }}>
            <SelectTrigger className="w-full" aria-label="Related record"><SelectValue placeholder={type ? (options.length ? `Choose a ${type.toLowerCase()}` : `No ${type.toLowerCase()}s yet`) : "Choose a type first"} /></SelectTrigger>
            <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      );
    }
    const inputType = field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "url" ? "url" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : ["number", "currency", "percent"].includes(field.type ?? "") ? "number" : "text";
    return (
      <Input
        id={id}
        type={inputType}
        value={value}
        step={field.type === "currency" ? "0.01" : field.type === "number" || field.type === "percent" ? "any" : undefined}
        min={["number", "currency", "percent"].includes(field.type ?? "") ? 0 : undefined}
        max={field.type === "percent" ? 100 : undefined}
        placeholder={field.placeholder}
        onChange={(event) => set({ [field.key]: event.target.value })}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{record ? `Edit ${module.label.toLowerCase()}` : `Create ${module.label}`}</DialogTitle>
          <DialogDescription>{module.description}</DialogDescription>
        </DialogHeader>
        <form id={`crm-form-${module.key}`} onSubmit={save} className="space-y-6">
          {sections.map((section) => (
            <fieldset key={section} className="min-w-0">
              <legend className="mb-3 text-sm font-semibold">{section}</legend>
              <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
                {module.fields.filter((field) => field.section === section).map((field) => (
                  <div key={field.key} className={`min-w-0 space-y-1.5 ${field.wide ? "sm:col-span-2" : ""}`}>
                    {field.type !== "checkbox" ? (
                      <Label htmlFor={`crm-${module.key}-${field.key}`}>{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label>
                    ) : null}
                    {renderField(field)}
                    {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`crm-form-${module.key}`} disabled={saving || Boolean(uploading)}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
