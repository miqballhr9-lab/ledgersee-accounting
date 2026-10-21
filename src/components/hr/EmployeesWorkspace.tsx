"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, ChevronDown, ListChecks, Trash2, Clock, FileBadge, HandCoins, LayoutGrid, List, Mail, Phone, Plus, ReceiptText, Search, Smartphone, Star, Wallet } from "lucide-react";
import { toast } from "sonner";

import { deleteBookkeepingRecord, getAttachmentUploadTarget, saveBookkeepingRecord } from "@/app/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { inviteMember } from "@/app/team-actions";
import { useNewRecordParam, useOpenRecordParam } from "@/hooks/use-new-record-param";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { readableError } from "@/lib/action-error";
import { moduleBySlug, type FormField } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";

interface EmployeesWorkspaceProps {
  employees: BookkeepingRecord[];
  departments: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  /** HR records counted on each employee's smart buttons. */
  related: Record<string, BookkeepingRecord[]>;
  asOfDate: string;
}

const tabs = ["Work information", "Resume", "Private information", "HR settings"] as const;
const ALL = "__all__";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** A soft colour per person, like Odoo's avatar placeholders. */
function avatarTone(name: string) {
  const tones = ["bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];
  const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return tones[sum % tones.length];
}

function nextEmployeeId(employees: BookkeepingRecord[]) {
  const highest = employees.reduce((max, row) => Math.max(max, Number((row.data.employeeId ?? "").replace(/\D/g, "")) || 0), 0);
  return `EMP-${String(highest + 1).padStart(3, "0")}`;
}

/** Employees as in Odoo: a Kanban of cards with a department panel, and the employee form with its smart buttons and notebook. */
export default function EmployeesWorkspace({ employees, departments, accounts, related, asOfDate }: EmployeesWorkspaceProps) {
  const router = useRouter();
  const employeeModule = moduleBySlug("employees");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<BookkeepingRecord | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<(typeof tabs)[number]>("Work information");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  /** Archives (or brings back) or deletes the checked employees. Archiving keeps their payroll and history. */
  async function bulkAction(action: "archive" | "restore" | "delete") {
    const targets = employees.filter((employee) => selectedIds.has(employee.id));
    if (!targets.length) return;
    if (action === "delete" && !window.confirm(`Delete ${targets.length} ${targets.length === 1 ? "employee" : "employees"}? This can’t be undone. Archive keeps their payroll and history instead.`)) return;
    setBulkBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const employee of targets) {
      try {
        if (action === "delete") await deleteBookkeepingRecord("employees", employee.id);
        else await saveBookkeepingRecord("employees", { ...employee.data, status: action === "archive" ? "Inactive" : "Active" }, employee.id);
        done += 1;
      } catch (error) {
        failed.push(`${employee.data.name || "Employee"}: ${error instanceof Error ? readableError(error) : "couldn’t be changed"}`);
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (done) toast.success(`${done} ${done === 1 ? "employee" : "employees"} ${action === "delete" ? "deleted" : action === "archive" ? "archived" : "restored"}.`);
    if (failed.length) toast.error(failed.join(" "));
    router.refresh();
  }

  /** Invites the open employee to sign in with the Employee role, which opens their own portal (the employee app). */
  async function inviteToApp() {
    if (!editing) return;
    const email = (values.email ?? editing.data.email ?? "").trim();
    if (!email) {
      toast.error("Add the employee's work email first, then save.");
      return;
    }
    setInviting(true);
    try {
      const result = await inviteMember({ name: values.name || editing.data.name || "", email, role: "Employee", department: values.department || editing.data.department || "" });
      try {
        await navigator.clipboard.writeText(result.link);
      } catch {
        // Copying can be blocked; the email still has the link.
      }
      toast.success(result.emailed ? `Invitation emailed to ${email}. The link is also copied, to send on WhatsApp.` : `Invitation link copied. Send it to ${email}; email isn't set up.`);
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "The invitation couldn't be sent.");
    } finally {
      setInviting(false);
    }
  }

  /** The employee's photo, uploaded like any attachment and shown on the form and the kanban card. */
  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a picture (PNG, JPG or WebP).");
      return;
    }
    setUploading(true);
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      setValues((current) => ({ ...current, photo: target.publicUrl }));
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "The photo couldn’t be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  const departmentNames = useMemo(() => [...new Set([
    ...departments.map((row) => row.data.departmentName?.trim() ?? ""),
    ...employees.map((row) => row.data.department?.trim() ?? ""),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [departments, employees]);
  const visible = employees
    .filter((row) => (showArchived ? row.data.status === "Inactive" : row.data.status !== "Inactive"))
    .filter((row) => department === ALL || (row.data.department ?? "") === department)
    .filter((row) => !search.trim() || [row.data.name, row.data.designation, row.data.email, row.data.employeeId].some((value) => (value ?? "").toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));
  const managers = employees.filter((row) => row.id !== editing?.id && row.data.status !== "Inactive").map((row) => row.data.name ?? "").filter(Boolean).sort();

  function open(record: BookkeepingRecord | null) {
    setEditing(record);
    setTab("Work information");
    setValues(record ? { ...record.data } : { status: "Active", employeeType: "Employee", joiningDate: asOfDate, department: department === ALL ? "" : department });
  }
  useNewRecordParam(() => open(null));
  useOpenRecordParam((id) => {
    const record = employees.find((row) => row.id === id);
    if (record) open(record);
  });

  async function save() {
    if (!values.name?.trim()) {
      toast.error("Enter the employee's name.");
      return;
    }
    setSaving(true);
    try {
      const data = { ...values, name: values.name.trim(), employeeId: values.employeeId?.trim() || nextEmployeeId(employees) };
      await saveBookkeepingRecord("employees", data, editing?.id);
      toast.success(editing ? "Employee updated." : "Employee created.");
      setEditing(undefined);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t save this employee.");
    } finally {
      setSaving(false);
    }
  }

  const fields = employeeModule?.fields ?? [];
  const field = (key: string) => fields.find((entry) => entry.key === key);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  function control(entry: FormField) {
    const id = `employee-${entry.key}`;
    const value = values[entry.key] ?? "";
    if (entry.key === "department") {
      return (
        <Select value={value || null} onValueChange={(next) => set("department", next ?? "")}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder={departmentNames.length ? "Choose a department" : "Add departments first"} /></SelectTrigger>
          <SelectContent>{departmentNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (entry.key === "manager" || entry.key === "coach") {
      return (
        <Select value={value || null} onValueChange={(next) => set(entry.key, next ?? "")}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder={entry.key === "coach" ? "Choose a coach" : "Choose a manager"} /></SelectTrigger>
          <SelectContent>{managers.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (entry.key === "paymentAccountId") {
      return (
        <Select value={value || null} onValueChange={(next) => set("paymentAccountId", next ?? "")}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose an account" /></SelectTrigger>
          <SelectContent>{paymentAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{paymentAccountLabel(account)}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (entry.type === "select") {
      return (
        <Select value={value || null} onValueChange={(next) => set(entry.key, next ?? "")}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>{(entry.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (entry.type === "textarea") return <Textarea id={id} rows={2} value={value} onChange={(event) => set(entry.key, event.target.value)} />;
    return <Input id={id} type={entry.type === "number" ? "number" : entry.type === "date" ? "date" : entry.type === "email" ? "email" : "text"} value={value} placeholder={entry.placeholder} onChange={(event) => set(entry.key, event.target.value)} />;
  }

  const row = (key: string) => {
    const entry = field(key);
    if (!entry) return null;
    return (
      <div key={key} className={`grid items-start gap-x-4 gap-y-1 py-1.5 sm:grid-cols-[170px_minmax(0,1fr)] ${entry.type === "textarea" ? "md:col-span-2" : ""}`}>
        <Label htmlFor={`employee-${key}`} className="pt-2 text-sm font-semibold text-foreground/90">{entry.label}</Label>
        <div className="space-y-1">{control(entry)}{entry.help ? <p className="text-xs text-muted-foreground">{entry.help}</p> : null}</div>
      </div>
    );
  };

  // Smart buttons: what this employee has across HR, as in Odoo.
  const mine = (kind: string) => (related[kind] ?? []).filter((record) => editing && (record.data.employeeId === editing.id || record.data.employee === editing.data.name || record.data.employeeName === editing.data.name));
  const year = asOfDate.slice(0, 4);
  const month = asOfDate.slice(0, 7);
  const smartButtons = editing ? [
    { label: "Time off", value: `${mine("hr-leaves").filter((row) => row.data.status === "Approved" && (row.data.fromDate ?? "").startsWith(year)).reduce((sum, row) => sum + Number(row.data.days || 0), 0)} days`, href: "/app/hr/time-off", icon: CalendarDays },
    { label: "Attendance", value: `${mine("hr-attendance").filter((row) => (row.data.date ?? "").startsWith(month)).reduce((sum, row) => sum + Number(row.data.hoursWorked || 0), 0).toFixed(1)} h`, href: "/app/hr/attendances", icon: Clock },
    { label: "Contracts", value: mine("hr-contracts").find((row) => row.data.status === "Running")?.data.endDate ? `Ends ${mine("hr-contracts").find((row) => row.data.status === "Running")?.data.endDate}` : String(mine("hr-contracts").length), href: "/app/hr/contracts", icon: FileBadge },
    { label: "Payslips", value: String(mine("payroll").length), href: "/app/payroll", icon: Wallet },
    { label: "Expenses", value: String(mine("hr-claims").length), href: "/app/hr/expenses", icon: ReceiptText },
    { label: "Appraisals", value: String(mine("hr-appraisals").length), href: "/app/hr/appraisals", icon: Star },
    { label: "Documents", value: String(mine("hr-documents").length), href: "/app/hr/documents", icon: FileBadge },
    { label: "Attachments", value: String(mine("hr-loans").length), href: "/app/hr/salary-attachments", icon: HandCoins },
  ] : [];
  const tabKeys: Record<(typeof tabs)[number], string[]> = {
    "Work information": ["workLocation", "joiningDate", "workSchedule", "coach", "tags"],
    Resume: ["skills", "resume"],
    "Private information": ["cnic", "dateOfBirth", "emergencyContact", "emergencyPhone", "bankName", "bankAccountTitle", "bankAccountNumber", "address"],
    "HR settings": ["employeeId", "employeeType", "status", "baseSalary", "socialDeduction", "overtimeRate", "kioskPin", "paymentAccountId", "notes"],
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <Button className="gap-1.5" onClick={() => open(null)}><Plus size={15} />New</Button>
          <h1 className="text-xl font-semibold">Employees</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search…" className="pl-9" aria-label="Search employees" />
          </div>
          <Button variant={showArchived ? "secondary" : "outline"} size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Archived" : "Active"}</Button>
          {view === "list" ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" disabled={!selectedIds.size || bulkBusy} title={selectedIds.size ? undefined : "Select employees with the checkboxes first"}><ListChecks size={15} />{bulkBusy ? "Working…" : `Actions${selectedIds.size ? ` (${selectedIds.size})` : ""}`}<ChevronDown size={14} /></Button>} />
              <DropdownMenuContent align="end" className="min-w-44">
                {showArchived ? <DropdownMenuItem onClick={() => void bulkAction("restore")}><ArchiveRestore size={15} />Restore</DropdownMenuItem> : <DropdownMenuItem onClick={() => void bulkAction("archive")}><Archive size={15} />Archive</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void bulkAction("delete")}><Trash2 size={15} />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="flex rounded-md border border-border">
            <Button variant={view === "kanban" ? "secondary" : "ghost"} size="icon-sm" aria-label="Kanban" onClick={() => setView("kanban")}><LayoutGrid size={15} /></Button>
            <Button variant={view === "list" ? "secondary" : "ghost"} size="icon-sm" aria-label="List" onClick={() => setView("list")}><List size={15} /></Button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department</p>
          <ul className="mt-2 space-y-0.5 text-sm">
            {[ALL, ...departmentNames].map((name) => (
              <li key={name}>
                <button type="button" onClick={() => setDepartment(name)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left ${department === name ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}>
                  <span className="truncate">{name === ALL ? "All" : name}</span>
                  <span className="text-xs text-muted-foreground">{employees.filter((row) => row.data.status !== "Inactive" && (name === ALL || row.data.department === name)).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {view === "kanban" ? (
          <section className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((employee) => (
              <button key={employee.id} type="button" onClick={() => open(employee)} className="flex gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md">
                {employee.data.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={employee.data.photo} alt="" className="size-16 shrink-0 rounded-md object-cover" />
                  : <span className={`flex size-16 shrink-0 items-center justify-center rounded-md text-lg font-semibold ${avatarTone(employee.data.name ?? "")}`}>{initials(employee.data.name ?? "")}</span>}
                <span className="min-w-0 space-y-0.5">
                  <span className="block truncate font-semibold">{employee.data.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{employee.data.designation || "—"}</span>
                  {employee.data.email ? <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Mail size={12} />{employee.data.email}</span> : null}
                  {employee.data.mobile ? <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Phone size={12} />{employee.data.mobile}</span> : null}
                </span>
              </button>
            ))}
            {!visible.length ? <p className="col-span-full rounded-lg border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">{employees.length ? "No employees match." : "No employees yet. Choose New to add the first one."}</p> : null}
          </section>
        ) : (
          <section className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="w-10 pl-4"><Checkbox aria-label="Select all employees" checked={visible.length > 0 && visible.every((employee) => selectedIds.has(employee.id))} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); visible.forEach((employee) => (checked ? next.add(employee.id) : next.delete(employee.id))); return next; })} /></th>{["Employee name", "Work phone", "Work email", "Department", "Job position", "Manager"].map((heading) => <th key={heading} className="px-4 py-2.5 font-medium">{heading}</th>)}</tr></thead>
              <tbody>
                {visible.map((employee) => (
                  <tr key={employee.id} className={`cursor-pointer border-b border-border/70 hover:bg-muted/40 ${selectedIds.has(employee.id) ? "bg-primary/5" : ""}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("[role=checkbox]")) open(employee); }}>
                    <td className="w-10 pl-4" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${employee.data.name || "employee"}`} checked={selectedIds.has(employee.id)} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(employee.id); else next.delete(employee.id); return next; })} /></td>
                    <td className="px-4 py-2.5 font-medium">{employee.data.name}</td>
                    <td className="px-4 py-2.5">{employee.data.workPhone || employee.data.mobile || "—"}</td>
                    <td className="px-4 py-2.5">{employee.data.email || "—"}</td>
                    <td className="px-4 py-2.5">{employee.data.department || "—"}</td>
                    <td className="px-4 py-2.5">{employee.data.designation || "—"}</td>
                    <td className="px-4 py-2.5">{employee.data.manager || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">No employees match.</p> : null}
          </section>
        )}
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(next) => { if (!next && !saving) setEditing(undefined); }}>
        <DialogContent showCloseButton={false} className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-lg">
              <button type="button" className="text-primary hover:underline" onClick={() => setEditing(undefined)}>Employees</button>
              <span className="text-muted-foreground">/</span>
              <DialogTitle className="truncate text-lg font-normal">{editing ? editing.data.name : "New"}</DialogTitle>
              <DialogDescription className="sr-only">Employee form</DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {editing ? <Button variant="outline" className="gap-1.5" disabled={saving || inviting} title="Email a login for the employee app: check in/out, time off, payslips" onClick={() => void inviteToApp()}><Smartphone size={15} />{inviting ? "Inviting…" : "Invite to employee app"}</Button> : null}
              <Button variant="outline" disabled={saving} onClick={() => setEditing(undefined)}>Discard</Button>
              <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40">
            <div className="mx-auto w-full max-w-5xl p-3 sm:p-6">
              <div className="rounded-lg border border-border bg-card px-4 py-6 shadow-sm sm:px-10 sm:py-8">
                {smartButtons.length ? (
                  <div className="-mt-2 mb-6 flex flex-wrap justify-end border-b border-border pb-3">
                    {smartButtons.map((button) => (
                      <Link key={button.label} href={button.href} className="flex min-w-28 items-center gap-2 border-l border-border px-3 py-1.5 text-left hover:bg-muted">
                        <button.icon size={18} className="text-muted-foreground" />
                        <span className="leading-tight"><span className="block text-sm font-semibold">{button.value}</span><span className="block text-xs text-muted-foreground">{button.label}</span></span>
                      </Link>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <input id="employee-name" aria-label="Employee's name" value={values.name ?? ""} onChange={(event) => set("name", event.target.value)} placeholder="Employee's name" className="w-full border-0 border-b border-border bg-transparent pb-1 text-3xl! font-semibold outline-none focus:border-primary" />
                    <input id="employee-designation" aria-label="Job position" value={values.designation ?? ""} onChange={(event) => set("designation", event.target.value)} placeholder="Job position" className="mt-2 w-full border-0 border-b border-transparent bg-transparent pb-1 text-lg! text-muted-foreground outline-none focus:border-border" />
                  </div>
                  <label className="group relative size-24 shrink-0 cursor-pointer" title="Upload a photo">
                    {values.photo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={values.photo} alt="" className="size-24 rounded-md object-cover" />
                      : <span className={`flex size-24 items-center justify-center rounded-md text-2xl font-semibold ${avatarTone(values.name ?? "")}`}>{initials(values.name ?? "")}</span>}
                    <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/50 py-0.5 text-center text-[11px] text-white opacity-0 group-hover:opacity-100">{uploading ? "Uploading…" : "Change photo"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Employee photo" onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} />
                  </label>
                </div>
                <div className="mt-6 grid gap-x-12 md:grid-cols-2">{["email", "mobile", "workPhone", "department", "manager"].map(row)}</div>
                <div className="mt-8">
                  <div role="tablist" className="flex flex-wrap border-b border-border">
                    {tabs.map((name) => (
                      <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)} className={`-mb-px border border-transparent px-4 py-2 text-sm ${tab === name ? "rounded-t-md border-border border-b-card bg-card font-semibold" : "text-muted-foreground hover:text-foreground"}`}>{name}</button>
                    ))}
                  </div>
                  <div className="grid gap-x-12 pt-4 md:grid-cols-2">{tabKeys[tab].map(row)}</div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
