"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, CalendarDays, ChevronDown, Scale, Columns3, Ellipsis, KanbanSquare, List, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload, UserCheck, Users } from "lucide-react";

import { deleteCrmRecords, importCrmRecords, updateCrmField } from "@/app/crm-actions";
import BulkActionsMenu from "@/components/bookkeeping/BulkActionsMenu";
import { useNewRecordParam } from "@/hooks/use-new-record-param";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCsv } from "@/lib/budget-utils";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmModule, isClosedStage, type CrmModule, type CrmModuleKey, type CrmPage } from "@/lib/crm-config";
import ConvertLeadDialog from "@/components/crm/ConvertLeadDialog";
import AttendanceDialog from "@/components/hr/AttendanceDialog";
import LeaveBalances from "@/components/hr/LeaveBalances";
import CrmRecordDetail from "@/components/crm/CrmRecordDetail";
import CrmRecordEditor from "@/components/crm/CrmRecordEditor";
import {
  displayValue,
  downloadFile,
  errorText,
  fieldFor,
  formatMoney,
  recordTitle,
  StatusBadge,
  toCsv,
  type CrmContextValue,
  type CrmStore,
} from "@/components/crm/crm-shared";

interface CrmWorkspaceProps {
  /** A CRM page (leads, accounts, activities…) or an HR module key (leave-requests…). */
  page: CrmPage | string;
  initialStore: CrmStore;
  currency: string;
  me: string;
  owners: string[];
  /** Record to open on arrival, from links like /app/crm/deals?open=<id>. */
  openId?: string;
  /** Applications only: show one job position's pipeline (Odoo's "New applications" on a job). */
  jobFilter?: string;
  /** HR pages: the business's weekly days off, as UTC day numbers. */
  weekend?: number[];
}

const pageInfo: Record<string, { title: string; description: string }> = {
  leads: { title: "Leads", description: crmModule("leads")!.description },
  contacts: { title: "Contacts", description: crmModule("contacts")!.description },
  accounts: { title: "Accounts", description: "The companies and people you sell to. Accounts are your customers in Sales, so their quotes, invoices and balances show up here too." },
  deals: { title: "Deals", description: crmModule("deals")!.description },
  activities: { title: "Activities", description: "Tasks, meetings and calls across all your leads, contacts, accounts and deals." },
  campaigns: { title: "Campaigns", description: crmModule("campaigns")!.description },
  cases: { title: "Cases", description: crmModule("cases")!.description },
  solutions: { title: "Solutions", description: crmModule("solutions")!.description },
};

type ViewFilter = "all" | "mine" | "open" | "closed" | "today" | "overdue";

function subscribeToNothing() {
  return () => {};
}

/** Column choices saved in this browser; read as text so the snapshot stays stable between renders. */
function readSavedColumns(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseColumns(text: string | null) {
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as unknown;
    return Array.isArray(saved) && saved.length && saved.every((item) => typeof item === "string") ? (saved as string[]) : null;
  } catch {
    return null;
  }
}

interface SavedView {
  name: string;
  search: string;
  filter: ViewFilter;
  status: string;
  pipeline: string;
  sort: { key: string; desc: boolean } | null;
}

function parseViews(text: string | null): SavedView[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SavedView => Boolean(item) && typeof item === "object" && typeof (item as SavedView).name === "string") : [];
  } catch {
    return [];
  }
}

function isClosed(mod: CrmModule, record: BookkeepingRecord) {
  const value = mod.statusKey ? record.data[mod.statusKey] : "";
  if (mod.kind === "crm-deals") return isClosedStage(value);
  if (mod.kind === "crm-leads") return ["Converted", "Junk Lead", "Lost Lead", "Not Qualified"].includes(value ?? "");
  if (mod.kind === "crm-tasks") return value === "Completed";
  if (mod.kind === "crm-calls") return value !== "Scheduled";
  if (mod.kind === "crm-cases") return value === "Closed";
  if (mod.kind === "crm-campaigns") return value === "Complete" || value === "Inactive";
  if (mod.kind === "crm-meetings") return (record.data.to || record.data.from || "") < new Date().toISOString().slice(0, 16);
  return false;
}

function dueDateOf(record: BookkeepingRecord) {
  return (record.data.dueDate || record.data.closingDate || record.data.from || record.data.startTime || "").slice(0, 10);
}

export default function CrmWorkspace({ page, initialStore, currency, me, owners, openId, jobFilter, weekend }: CrmWorkspaceProps) {
  const router = useRouter();
  const [store, setStore] = useState<CrmStore>(initialStore);
  const [lastInitial, setLastInitial] = useState(initialStore);
  if (initialStore !== lastInitial) {
    setLastInitial(initialStore);
    setStore(initialStore);
  }
  const [activityKey, setActivityKey] = useState<CrmModuleKey>("tasks");
  const mod = page === "accounts" ? null : crmModule(page === "activities" ? activityKey : page)!;
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [pipeline, setPipeline] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<"list" | "kanban" | "balances" | "calendar">(page === "deals" || page === "applications" || page === "job-positions" ? "kanban" : "list");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ mod: CrmModule; record: BookkeepingRecord | null; preset?: Record<string, string> } | null>(null);
  const [detail, setDetail] = useState<BookkeepingRecord | null>(() => (openId ? Object.values(initialStore).flat().find((record) => record.id === openId) ?? null : null));
  const [converting, setConverting] = useState<BookkeepingRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [massUpdate, setMassUpdate] = useState<{ key: string; value: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [shownKind, setShownKind] = useState(mod?.kind);
  if (shownKind !== mod?.kind) {
    setShownKind(mod?.kind);
    setSelected([]);
    setStatusFilter("");
    setFilter("all");
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const columnsKey = `crm-columns-${mod?.key ?? "accounts"}`;
  const savedColumns = useSyncExternalStore(subscribeToNothing, () => readSavedColumns(columnsKey), () => null);
  const [columnChoices, setColumnChoices] = useState<Record<string, string[]>>({});
  // Saved views, as Zoho's custom views: a named search, filter, status, pipeline and sort, kept in this browser.
  const viewsKey = `crm-views-${mod?.kind ?? "accounts"}`;
  const savedViewsText = useSyncExternalStore(subscribeToNothing, () => readSavedColumns(viewsKey), () => null);
  const [viewChoices, setViewChoices] = useState<Record<string, SavedView[]>>({});
  const savedViews: SavedView[] = viewChoices[viewsKey] ?? parseViews(savedViewsText);
  function storeViews(next: SavedView[]) {
    setViewChoices((current) => ({ ...current, [viewsKey]: next }));
    try { window.localStorage.setItem(viewsKey, JSON.stringify(next)); } catch { /* Views just won't be remembered. */ }
  }
  const columns = columnChoices[columnsKey] ?? parseColumns(savedColumns) ?? [...(mod?.columns ?? [])];
  function setColumns(next: string[]) {
    setColumnChoices((current) => ({ ...current, [columnsKey]: next }));
  }

  const upsert = useCallback((records: BookkeepingRecord[]) => {
    setStore((current) => {
      const next = { ...current };
      for (const record of records) {
        const list = next[record.kind] ?? [];
        next[record.kind] = list.some((item) => item.id === record.id) ? list.map((item) => (item.id === record.id ? record : item)) : [record, ...list];
      }
      return next;
    });
    setDetail((current) => records.find((record) => record.id === current?.id) ?? current);
  }, []);
  const remove = useCallback((kind: string, ids: string[]) => {
    setStore((current) => ({ ...current, [kind]: (current[kind] ?? []).filter((item) => !ids.includes(item.id)) }));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  }, []);
  const context: CrmContextValue = { store, currency, me, owners, upsert, remove, weekend };

  useEffect(() => {
    if (!openId) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("open");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }, [openId]);
  useNewRecordParam(() => openNew(jobPreset));

  const records = useMemo(() => (mod ? store[mod.kind] ?? [] : store.customers ?? []), [mod, store]);
  const todayText = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      if (term && !Object.values(record.data).some((value) => value?.toLowerCase().includes(term))) return false;
      if (!mod) return true;
      if (jobFilter && mod.kind === "hr-candidates" && record.data.job !== jobFilter) return false;
      if (pipeline && mod.kind === "crm-deals" && (record.data.pipeline || "Standard") !== pipeline) return false;
      if (statusFilter && mod.statusKey && record.data[mod.statusKey] !== statusFilter) return false;
      if (filter === "mine" && record.data.owner !== me) return false;
      if (filter === "open" && isClosed(mod, record)) return false;
      if (filter === "closed" && !isClosed(mod, record)) return false;
      if (filter === "today" && dueDateOf(record) !== todayText) return false;
      if (filter === "overdue" && !(dueDateOf(record) && dueDateOf(record) < todayText && !isClosed(mod, record))) return false;
      return true;
    }).sort((a, b) => {
      // Column sorting, as in Zoho's list views: numbers by value, everything else alphabetically.
      if (!sort) return 0;
      const left = a.data[sort.key] ?? "";
      const right = b.data[sort.key] ?? "";
      const numeric = left !== "" && right !== "" && Number.isFinite(Number(left)) && Number.isFinite(Number(right));
      const order = numeric ? Number(left) - Number(right) : left.localeCompare(right, undefined, { numeric: true });
      return sort.desc ? -order : order;
    });
  }, [jobFilter, pipeline, sort, records, search, mod, statusFilter, filter, me, todayText]);


  const jobPreset = jobFilter && mod?.kind === "hr-candidates" ? { job: jobFilter } : undefined;
  function openNew(preset?: Record<string, string>) {
    // Attendance is entered for many employees at once, on the attendance sheet.
    if (mod?.kind === "hr-attendance" && !preset) {
      setMarking(true);
      return;
    }
    if (mod) setEditor({ mod, record: null, preset });
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function exportRows(rows: BookkeepingRecord[], format: "csv" | "excel") {
    if (!mod) return;
    const fields = mod.fields.filter((field) => field.type !== "related");
    const header = [...fields.map((field) => field.label), ...(mod.fields.some((field) => field.type === "related") ? ["Related to type", "Related to"] : []), "Created", "Modified"];
    const body = rows.map((record) => [
      ...fields.map((field) => (field.type === "checkbox" ? (record.data[field.key] === "true" ? "Yes" : "No") : record.data[field.key] ?? "")),
      ...(mod.fields.some((field) => field.type === "related") ? [record.data.relatedType ?? "", record.data.related ?? ""] : []),
      record.createdAt.slice(0, 10),
      record.updatedAt.slice(0, 10),
    ]);
    const name = `${mod.plural.toLowerCase()}-${todayText}`;
    if (format === "csv") downloadFile(`${name}.csv`, toCsv([header, ...body]), "text/csv;charset=utf-8");
    else {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const table = `<table><tr>${header.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr>${body.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
      downloadFile(`${name}.xls`, `<html><head><meta charset="utf-8"></head><body>${table}</body></html>`, "application/vnd.ms-excel");
    }
  }

  function downloadTemplate() {
    if (!mod) return;
    const fields = mod.fields.filter((field) => !field.readOnly && field.type !== "related");
    downloadFile(`${mod.plural.toLowerCase()}-import-template.csv`, toCsv([fields.map((field) => field.label)]), "text/csv;charset=utf-8");
  }

  async function importFile(file: File) {
    if (!mod) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      toast.error("The file needs a header row and at least one record.");
      return;
    }
    const lookup = new Map<string, string>();
    for (const field of mod.fields) {
      lookup.set(field.key.toLowerCase(), field.key);
      lookup.set(field.label.toLowerCase(), field.key);
    }
    lookup.set("related to type", "relatedType");
    lookup.set("related to", "related");
    const keys = rows[0].map((cell) => lookup.get(cell.trim().toLowerCase()) ?? "");
    if (!keys.some(Boolean)) {
      toast.error("None of the column names match. Download the template to see the expected columns.");
      return;
    }
    const items = rows.slice(1).map((row) => Object.fromEntries(keys.flatMap((key, index) => (key ? [[key, row[index] ?? ""]] : []))));
    await run(async () => {
      const result = await importCrmRecords(mod.kind, items);
      if (result.failed.length) toast.warning(`${result.created} imported. ${result.failed.length} rows skipped: ${result.failed.slice(0, 3).map((item) => `row ${item.row} — ${item.message}`).join("; ")}`);
      else toast.success(`${result.created} ${mod.plural.toLowerCase()} imported.`);
      router.refresh();
    });
  }

  type BulkKey = "update" | "export" | "delete";
  function bulkAction(key: BulkKey) {
    if (!mod) return;
    const rows = records.filter((record) => selected.includes(record.id));
    if (key === "export") exportRows(rows, "csv");
    if (key === "update") setMassUpdate({ key: mod.statusKey ?? "owner", value: "" });
    if (key === "delete") {
      if (!window.confirm(`Delete ${rows.length} ${rows.length === 1 ? mod.label.toLowerCase() : mod.plural.toLowerCase()}? Their notes are deleted too.`)) return;
      void run(async () => {
        await deleteCrmRecords(mod.kind, selected);
        remove(mod.kind, selected);
        toast.success(`${rows.length} deleted.`);
      });
    }
  }

  const updatableFields = mod?.fields.filter((field) => !field.readOnly && ["select", "owner", "date"].includes(field.type ?? "")) ?? [];
  const massField = updatableFields.find((field) => field.key === massUpdate?.key);

  async function moveCard(id: string, value: string) {
    if (!mod?.kanbanKey) return;
    const record = records.find((item) => item.id === id);
    if (!record || record.data[mod.kanbanKey] === value) return;
    if (mod.kind === "crm-leads" && value === "Converted") {
      setConverting(record);
      return;
    }
    upsert([{ ...record, data: { ...record.data, [mod.kanbanKey]: value } }]);
    await run(async () => {
      upsert(await updateCrmField(mod.kind, [id], mod.kanbanKey!, value));
    });
  }

  const info = pageInfo[page] ?? { title: mod?.plural ?? "Records", description: mod?.description ?? "" };
  const sectionLabel = mod?.section === "hr" ? "HRM" : "CRM";
  const accountsStats = useMemo(() => {
    if (page !== "accounts") return new Map<string, { contacts: number; open: number; won: number; outstanding: number }>();
    const stats = new Map<string, { contacts: number; open: number; won: number; outstanding: number }>();
    for (const account of store.customers ?? []) stats.set(account.id, { contacts: 0, open: 0, won: 0, outstanding: 0 });
    for (const contact of store["crm-contacts"] ?? []) { const s = stats.get(contact.data.accountId ?? ""); if (s) s.contacts += 1; }
    for (const deal of store["crm-deals"] ?? []) {
      const s = stats.get(deal.data.accountId ?? "");
      if (!s) continue;
      if (deal.data.stage === "Closed Won") s.won += Number(deal.data.amount || 0);
      else if (!isClosedStage(deal.data.stage)) s.open += Number(deal.data.amount || 0);
    }
    for (const invoice of store.invoices ?? []) {
      const account = (store.customers ?? []).find((customer) => customer.id === invoice.data.customerId || customer.data.name?.trim().toLowerCase() === invoice.data.customer?.trim().toLowerCase());
      const s = account ? stats.get(account.id) : undefined;
      if (s && !["Paid", "Cancelled", "Draft"].includes(invoice.data.status ?? "")) s.outstanding += Math.max(0, Number(invoice.data.amount || 0) - Number(invoice.data.paidAmount || 0) - Number(invoice.data.creditApplied || 0));
    }
    return stats;
  }, [page, store]);

  const allSelected = filtered.length > 0 && filtered.every((record) => selected.includes(record.id));
  const kanbanOptions = mod?.kanbanKey ? (mod.fields.find((field) => field.key === mod.kanbanKey)?.options ?? []) : [];
  const kanbanColumns = mod?.kind === "crm-leads" ? [...kanbanOptions, "Converted"] : [...kanbanOptions];
  const statusOptions = mod?.statusKey ? [...(mod.fields.find((field) => field.key === mod.statusKey)?.options ?? []), ...(mod.kind === "crm-leads" ? ["Converted"] : [])] : [];

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{sectionLabel} / {info.title}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">{info.title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{info.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mod ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2"><ArrowDownToLine size={15} />Import / Export<ChevronDown size={14} /></Button>} />
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={() => fileInput.current?.click()}><Upload size={14} />Import from CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadTemplate}><ArrowDownToLine size={14} />Download import template</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportRows(filtered, "csv")}><ArrowDownToLine size={14} />Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRows(filtered, "excel")}><ArrowDownToLine size={14} />Export Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
          {mod ? <Button type="button" className="gap-2" onClick={() => openNew(jobPreset)}><Plus size={15} />Create {mod.label}</Button>
            : <Button className="gap-2" nativeButton={false} render={<Link href="/app/customers?new=1" />}><Plus size={15} />Create account</Button>}
        </div>
      </header>

      {page === "activities" ? (
        <div className="mt-5 flex gap-1 border-b border-border">
          {(["tasks", "meetings", "calls"] as const).map((key) => (
            <button key={key} type="button" onClick={() => setActivityKey(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${activityKey === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {crmModule(key)!.plural} <span className="text-muted-foreground">({(store[crmModule(key)!.kind] ?? []).length})</span>
            </button>
          ))}
        </div>
      ) : null}

      {page === "deals" && mod ? (
        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Open pipeline", formatMoney(records.filter((deal) => !isClosedStage(deal.data.stage)).reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0), currency)],
            ["Weighted (expected)", formatMoney(records.filter((deal) => !isClosedStage(deal.data.stage)).reduce((sum, deal) => sum + Number(deal.data.expectedRevenue || 0), 0), currency)],
            ["Won", formatMoney(records.filter((deal) => deal.data.stage === "Closed Won").reduce((sum, deal) => sum + Number(deal.data.amount || 0), 0), currency)],
            ["Win rate", (() => { const closed = records.filter((deal) => isClosedStage(deal.data.stage)); return closed.length ? `${Math.round((closed.filter((deal) => deal.data.stage === "Closed Won").length / closed.length) * 100)}%` : "—"; })()],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${info.title.toLowerCase()}`} className="pl-8" aria-label={`Search ${info.title.toLowerCase()}`} />
        </div>
        {jobFilter && mod?.kind === "hr-candidates" ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-sm">
            <span className="text-muted-foreground">Job position:</span><span className="font-medium">{jobFilter}</span>
            <Link href="/app/hr/applications" className="ml-1 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Show all job positions">×</Link>
          </span>
        ) : null}
        {mod ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-1.5">Views<ChevronDown size={14} /></Button>} />
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedViews.length ? savedViews.map((saved) => (
                  <DropdownMenuItem key={saved.name} onClick={() => { setSearch(saved.search); setFilter(saved.filter); setStatusFilter(saved.status); setPipeline(saved.pipeline); setSort(saved.sort); }}>
                    <span className="flex-1 truncate">{saved.name}</span>
                    <span role="button" tabIndex={0} aria-label={`Delete view ${saved.name}`} className="rounded px-1 text-muted-foreground hover:bg-muted" onClick={(event) => { event.stopPropagation(); storeViews(savedViews.filter((item) => item.name !== saved.name)); }}>×</span>
                  </DropdownMenuItem>
                )) : <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  const name = window.prompt("Name this view")?.trim();
                  if (name) storeViews([...savedViews.filter((item) => item.name !== name), { name: name.slice(0, 60), search, filter, status: statusFilter, pipeline, sort }].slice(-20));
                }}>Save current view…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Select value={filter} onValueChange={(value) => setFilter((value ?? "all") as ViewFilter)}>
              <SelectTrigger className="w-[170px]" aria-label="View"><SlidersHorizontal size={14} /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {mod.plural.toLowerCase()}</SelectItem>
                <SelectItem value="mine">My {mod.plural.toLowerCase()}</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                {["crm-tasks", "crm-meetings", "crm-calls", "crm-deals"].includes(mod.kind) ? <SelectItem value="today">Due today</SelectItem> : null}
                {["crm-tasks", "crm-calls", "crm-deals"].includes(mod.kind) ? <SelectItem value="overdue">Overdue</SelectItem> : null}
              </SelectContent>
            </Select>
            {statusOptions.length ? (
              <Select value={statusFilter || "any"} onValueChange={(value) => setStatusFilter(value === "any" ? "" : String(value ?? ""))}>
                <SelectTrigger className="w-[190px]" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any {fieldFor(mod, mod.statusKey!)?.label.toLowerCase() ?? "status"}</SelectItem>
                  {statusOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
          </>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          {mod?.kind === "crm-deals" ? (
            <Select value={pipeline || "all"} onValueChange={(value) => setPipeline(value === "all" ? "" : String(value ?? ""))}>
              <SelectTrigger className="w-[170px]" aria-label="Pipeline"><SelectValue>{pipeline || "All pipelines"}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pipelines</SelectItem>
                {[...new Set(["Standard", ...records.map((record) => record.data.pipeline || "Standard")])].map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          {mod && ["crm-meetings", "crm-tasks", "crm-calls"].includes(mod.kind) ? (
            <div className="flex rounded-md border border-border p-0.5">
              <Button type="button" size="sm" variant={view !== "calendar" ? "secondary" : "ghost"} className="gap-1.5" onClick={() => setView("list")}><List size={14} />List</Button>
              <Button type="button" size="sm" variant={view === "calendar" ? "secondary" : "ghost"} className="gap-1.5" onClick={() => setView("calendar")}><CalendarDays size={14} />Calendar</Button>
            </div>
          ) : null}
          {mod?.kanbanKey || mod?.kind === "hr-jobs" ? (
            <div className="flex rounded-md border border-border p-0.5">
              <Button type="button" size="sm" variant={view === "list" ? "secondary" : "ghost"} className="gap-1.5" onClick={() => setView("list")}><List size={14} />List</Button>
              <Button type="button" size="sm" variant={view === "kanban" ? "secondary" : "ghost"} className="gap-1.5" onClick={() => setView("kanban")}><KanbanSquare size={14} />Kanban</Button>
              {mod.kind === "hr-leaves" ? <Button type="button" size="sm" variant={view === "balances" ? "secondary" : "ghost"} className="gap-1.5" onClick={() => setView("balances")}><Scale size={14} />Balances</Button> : null}
            </div>
          ) : null}
          {mod && view === "list" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2"><Columns3 size={15} />Customise</Button>} />
                <DropdownMenuContent align="end" className="max-h-80 min-w-56 overflow-y-auto">
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  {[...(mod.titleKey === "fullName" ? ["fullName"] : []), ...mod.fields.filter((field) => field.type !== "textarea").map((field) => field.key)].map((key) => (
                    <DropdownMenuCheckboxItem key={key} checked={columns.includes(key)} onCheckedChange={(checked) => {
                      const next = checked ? [...columns, key] : columns.filter((item) => item !== key);
                      if (!next.length) return;
                      setColumns(next);
                      try { window.localStorage.setItem(columnsKey, JSON.stringify(next)); } catch { /* Column choices just won't be remembered. */ }
                    }}>{fieldFor(mod, key)?.label ?? key}</DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setColumns([...mod.columns]); try { window.localStorage.removeItem(columnsKey); } catch { /* Nothing saved to clear. */ } }}>Reset to default</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <BulkActionsMenu<BulkKey>
                count={selected.length}
                pending={busy}
                noun={mod.plural.toLowerCase()}
                onSelect={bulkAction}
                items={[
                  { key: "update", label: "Mass update", icon: Pencil },
                  { key: "export", label: "Export selected", icon: ArrowDownToLine },
                  { key: "delete", label: "Delete", icon: Trash2, destructive: true },
                ]}
              />
            </>
          ) : null}
        </div>
      </section>

      {page === "accounts" ? (
        <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          {filtered.length ? (
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  {["Account name", "Phone", "Email", "Contacts", "Open deals", "Won", "Outstanding", "Payment terms"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const stats = accountsStats.get(account.id);
                  return (
                    <tr key={account.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setDetail(account)}>
                      <td className="px-4 py-3 font-medium text-primary">{account.data.name}</td>
                      <td className="px-4 py-3">{account.data.phone || account.data.mobile || "—"}</td>
                      <td className="px-4 py-3">{account.data.email || "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{stats?.contacts ?? 0}</td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(stats?.open ?? 0, currency)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(stats?.won ?? 0, currency)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(stats?.outstanding ?? 0, currency)}</td>
                      <td className="px-4 py-3">{account.data.paymentTerms || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Users size={20} /></div>
              <h3 className="mt-4 font-semibold">{search ? "No accounts match your search" : "No accounts yet"}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Accounts are created when you add a customer or convert a lead.</p>
            </div>
          )}
        </section>
      ) : null}

      {mod?.kind === "hr-leaves" && view === "balances" ? <LeaveBalances employees={store.employees ?? []} leaveTypes={store["hr-leave-types"] ?? []} leaves={store["hr-leaves"] ?? []} allocations={store["hr-allocations"] ?? []} /> : null}

      {mod?.kind === "hr-jobs" && view === "kanban" ? (
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((job) => {
            const title = job.data.jobTitle || "Job position";
            const applications = (store["hr-candidates"] ?? []).filter((application) => application.data.job === title);
            const fresh = applications.filter((application) => (application.data.stage || "New") === "New").length;
            const ongoing = applications.filter((application) => !["Contract Signed", "Refused"].includes(application.data.stage ?? "")).length;
            const hired = applications.filter((application) => application.data.stage === "Contract Signed").length;
            const recruiting = job.data.status !== "Not recruiting";
            const href = `/app/hr/applications?job=${encodeURIComponent(title)}`;
            return (
              <article key={job.id} className={`flex flex-col rounded-lg border bg-card p-4 shadow-xs ${recruiting ? "border-border" : "border-dashed border-border opacity-80"}`}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setDetail(job)} className="min-w-0 text-left">
                    <h3 className="truncate text-base font-semibold hover:underline">{title}</h3>
                    <p className="truncate text-xs text-muted-foreground">{[job.data.department, job.data.location].filter(Boolean).join(" · ") || "No department"}</p>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${title} options`}><Ellipsis size={15} /></Button>} />
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuItem onClick={() => setEditor({ mod, record: job })}><Pencil size={14} />Configuration</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => run(async () => { upsert(await updateCrmField(mod.kind, [job.id], "status", recruiting ? "Not recruiting" : "Recruiting")); })}>
                        <UserCheck size={14} />{recruiting ? "Stop recruiting" : "Start recruiting"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <Button size="sm" nativeButton={false} render={<Link href={href} />}>{fresh} New {fresh === 1 ? "Application" : "Applications"}</Button>
                  <div className="text-right text-xs text-muted-foreground">
                    {Number(job.data.openings || 0) ? <p><span className="font-semibold text-foreground">{job.data.openings}</span> To recruit</p> : null}
                    <p><Link href={href} className="hover:underline">{ongoing} In progress</Link>{hired ? ` · ${hired} Hired` : ""}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>{job.data.owner || "No recruiter"}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${recruiting ? "bg-[#21B799]/15 text-[#13866f]" : "bg-muted"}`}>{recruiting ? "Recruiting" : "Not recruiting"}</span>
                </div>
              </article>
            );
          })}
          {!filtered.length ? <p className="col-span-full rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No job positions yet. Create one to start recruiting.</p> : null}
        </section>
      ) : null}

      {mod && view === "kanban" && mod.kanbanKey ? (
        <section className="mt-4 flex gap-3 overflow-x-auto pb-3">
          {kanbanColumns.map((column) => {
            const cards = filtered.filter((record) => (record.data[mod.kanbanKey!] || kanbanColumns[0]) === column);
            const total = mod.kanbanAmountKey ? cards.reduce((sum, card) => sum + Number(card.data[mod.kanbanAmountKey!] || 0), 0) : 0;
            return (
              <div
                key={column}
                className={`flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 ${dragging ? "border-dashed border-primary/50" : "border-border"}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); setDragging(null); if (id) void moveCard(id, column); }}
              >
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge value={column} />
                    <span className="text-xs text-muted-foreground">{cards.length}</span>
                  </div>
                  {mod.kanbanAmountKey ? <p className="mt-1.5 text-sm font-semibold tabular-nums">{formatMoney(total, currency)}</p> : null}
                </div>
                <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      draggable
                      onDragStart={(event) => { event.dataTransfer.setData("text/plain", card.id); setDragging(card.id); }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setDetail(card)}
                      className={`rounded-md border border-border bg-card p-3 text-left shadow-xs transition-shadow hover:shadow-sm ${dragging === card.id ? "opacity-50" : ""}`}
                    >
                      <p className="font-medium">{recordTitle(card)}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.data.job || card.data.account || card.data.company || card.data.related || card.data.email || ""}</p>
                      {mod.kind === "hr-candidates" && card.data.rating ? <p className="mt-1 text-sm leading-none text-[#E4A900]" aria-label={`Evaluation: ${card.data.rating}`}>{"★".repeat(["Good", "Very Good", "Excellent"].indexOf(card.data.rating) + 1)}<span className="text-muted-foreground/40">{"★".repeat(3 - ["Good", "Very Good", "Excellent"].indexOf(card.data.rating) - 1)}</span></p> : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                        {mod.kanbanAmountKey ? <span className="font-medium text-foreground tabular-nums">{formatMoney(card.data[mod.kanbanAmountKey], currency)}</span> : <span>{card.data.priority || card.data.leadSource || ""}</span>}
                        <span>{card.data.closingDate || card.data.dueDate || ""}</span>
                      </div>
                      {card.data.owner ? <p className="mt-1.5 text-[11px] text-muted-foreground">{card.data.owner}</p> : null}
                    </button>
                  ))}
                  {!cards.length ? <p className="px-1 py-3 text-center text-xs text-muted-foreground">Drop here</p> : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {mod && view === "calendar" ? (() => {
        // Zoho's calendar view: each day of the month with the meetings, calls and tasks on it.
        const [y, m] = calendarMonth.split("-").map(Number);
        const first = new Date(Date.UTC(y, m - 1, 1));
        const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const offset = (first.getUTCDay() + 6) % 7;
        const onDay = (date: string) => filtered.filter((record) => dueDateOf(record) === date);
        return (
          <section className="mt-4 rounded-lg border border-border bg-card p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
              <input type="month" aria-label="Month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value || calendarMonth)} className="h-8 rounded-md border border-border bg-background px-2 text-sm" />
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-1 py-1 font-medium text-muted-foreground">{day}</div>)}
              {Array.from({ length: offset }, (_, index) => <div key={`pad-${index}`} />)}
              {Array.from({ length: count }, (_, index) => {
                const date = `${calendarMonth}-${String(index + 1).padStart(2, "0")}`;
                const items = onDay(date);
                return (
                  <div key={date} className={`min-h-24 rounded-md border p-1 ${date === todayText ? "border-primary" : "border-border"}`}>
                    <p className="text-right text-[11px] text-muted-foreground">{index + 1}</p>
                    <ul className="space-y-0.5">
                      {items.slice(0, 4).map((record) => (
                        <li key={record.id}><button type="button" onClick={() => setDetail(record)} className="block w-full truncate rounded bg-primary/10 px-1 py-0.5 text-left text-[11px] text-primary hover:bg-primary/20">{(record.data.from || record.data.startTime || "").slice(11, 16)} {recordTitle(record)}</button></li>
                      ))}
                      {items.length > 4 ? <li className="px-1 text-[11px] text-muted-foreground">+{items.length - 4} more</li> : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })() : null}

      {mod && view === "list" ? (
        <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          {filtered.length ? (
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="w-10 px-3 py-3"><Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={(checked) => setSelected(checked ? filtered.map((record) => record.id) : [])} /></th>
                  {columns.map((key) => (
                    <th key={key} className="px-4 py-3" aria-sort={sort?.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((current) => (current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false }))}>
                        {fieldFor(mod, key)?.label ?? key}{sort?.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                  <th className="w-12"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setDetail(record)}>
                    <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                      <Checkbox aria-label={`Select ${recordTitle(record)}`} checked={selected.includes(record.id)} onCheckedChange={(checked) => setSelected((current) => (checked ? [...current, record.id] : current.filter((id) => id !== record.id)))} />
                    </td>
                    {columns.map((key, index) => {
                      const field = fieldFor(mod, key);
                      const value = key === "fullName" ? recordTitle(record) : displayValue(field, record.data, key, currency);
                      return (
                        <td key={key} className={`px-4 py-3 ${field?.type === "currency" ? "tabular-nums" : ""}`}>
                          {key === mod.statusKey || (field?.type === "select" && ["priority", "stage"].includes(key) && key === mod.statusKey) ? <StatusBadge value={value} />
                            : index === 0 ? <span className="font-medium text-primary">{value || "Untitled"}</span>
                            : value || <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${recordTitle(record)}`}><Ellipsis size={16} /></Button>} />
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onClick={() => setDetail(record)}>Open</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditor({ mod, record })}><Pencil size={14} />Edit</DropdownMenuItem>
                          {mod.kind === "crm-leads" && record.data.leadStatus !== "Converted" ? <DropdownMenuItem onClick={() => setConverting(record)}><UserCheck size={14} />Convert</DropdownMenuItem> : null}
                          {mod.kind === "crm-tasks" && record.data.status !== "Completed" ? <DropdownMenuItem onClick={() => void run(async () => { upsert(await updateCrmField("crm-tasks", [record.id], "status", "Completed")); toast.success("Task completed."); })}>Mark completed</DropdownMenuItem> : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => {
                            if (!window.confirm(`Delete “${recordTitle(record)}”?`)) return;
                            void run(async () => { await deleteCrmRecords(mod.kind, [record.id]); remove(mod.kind, [record.id]); toast.success(`${mod.label} deleted.`); });
                          }}><Trash2 size={14} />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Plus size={20} /></div>
              <h3 className="mt-4 font-semibold">{records.length ? `No ${mod.plural.toLowerCase()} match this view` : `No ${mod.plural.toLowerCase()} yet`}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{records.length ? "Change the search or filters to see more." : mod.description}</p>
              {!records.length ? <Button className="mt-4 gap-2" onClick={() => openNew()}><Plus size={15} />Create {mod.label}</Button> : null}
            </div>
          )}
        </section>
      ) : null}
      {mod && view === "list" && filtered.length ? <p className="mt-2 text-xs text-muted-foreground">{filtered.length} of {records.length} {mod.plural.toLowerCase()}</p> : null}

      {editor ? (
        <CrmRecordEditor
          module={editor.mod}
          record={editor.record}
          preset={editor.preset}
          open
          onOpenChange={(open) => { if (!open) setEditor(null); }}
          context={context}
        />
      ) : null}

      <CrmRecordDetail
        record={detail}
        context={context}
        onClose={() => setDetail(null)}
        onOpenRecord={setDetail}
        onEdit={(target, record) => setEditor({ mod: target, record })}
        onCreate={(target, preset) => setEditor({ mod: target, record: null, preset })}
        onConvert={setConverting}
        onRefresh={() => router.refresh()}
      />

      {mod?.kind === "hr-attendance" ? <AttendanceDialog open={marking} onOpenChange={setMarking} context={context} /> : null}

      <ConvertLeadDialog
        lead={converting}
        context={context}
        onOpenChange={(open) => { if (!open) setConverting(null); }}
        onConverted={() => { setDetail(null); router.refresh(); }}
      />

      <Dialog open={massUpdate !== null} onOpenChange={(open) => { if (!open && !busy) setMassUpdate(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mass update</DialogTitle>
            <DialogDescription>Change one field on the {selected.length} selected {mod?.plural.toLowerCase()}.</DialogDescription>
          </DialogHeader>
          {massUpdate && mod ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mass-field">Field</Label>
                <Select value={massUpdate.key} onValueChange={(value) => setMassUpdate({ key: String(value ?? ""), value: "" })}>
                  <SelectTrigger id="mass-field" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{updatableFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mass-value">New value</Label>
                {massField?.type === "date" ? (
                  <Input id="mass-value" type="date" value={massUpdate.value} onChange={(event) => setMassUpdate({ ...massUpdate, value: event.target.value })} />
                ) : (
                  <Select value={massUpdate.value || null} onValueChange={(value) => setMassUpdate({ ...massUpdate, value: String(value ?? "") })}>
                    <SelectTrigger id="mass-value" className="w-full"><SelectValue placeholder="Choose a value" /></SelectTrigger>
                    <SelectContent>{(massField?.type === "owner" ? owners : massField?.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMassUpdate(null)}>Cancel</Button>
            <Button type="button" disabled={busy || !massUpdate?.value} onClick={() => {
              if (!massUpdate || !mod) return;
              void run(async () => {
                upsert(await updateCrmField(mod.kind, selected, massUpdate.key, massUpdate.value));
                toast.success(`${selected.length} updated.`);
                setMassUpdate(null);
                setSelected([]);
              });
            }}>{busy ? "Updating…" : "Update"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

