"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import PayrollSheet from "@/components/bookkeeping/PayrollSheet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpDown, Banknote, CalendarDays, ChevronDown, CircleDollarSign, Copy, FileSpreadsheet, FileText, FileUp, Mail, Pencil, Plus, Printer, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { readableError } from "@/lib/action-error";

import { deleteBookkeepingRecord, importPayrollCsv, sendPayrollSlip } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { payrollCsvFields } from "@/lib/payroll-utils";
import { paymentAccountType } from "@/lib/payment-accounts";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface PayrollWorkspaceProps {
  records: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  /** Saved employees, offered as a picker that fills in the employee details. */
  employees?: BookkeepingRecord[];
  asOfDate: string;
  dateRange?: { startDate: string; endDate: string };
}

function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  if (!year || !value) return month;
  return new Intl.DateTimeFormat("en-PK", { month: "long", year: "numeric" }).format(new Date(year, value - 1, 1));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? readableError(error) : "We couldn’t save this payroll entry. Please try again.";
}

function saveCsv(filename: string, rows: string[][]) {
  const content = `\uFEFF${rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function nextPayrollMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  if (!year || !value) return month;
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, "0")}`;
}

interface PayrollColumn {
  key: string;
  label: string;
  align?: "right";
  render: (record: BookkeepingRecord) => ReactNode;
}

const PAYROLL_COLUMNS_KEY = "mikledger:payroll-columns:v1";
const DEFAULT_PAYROLL_COLUMNS = ["reference", "employee", "designation", "days", "paymentAccount", "grossSalary", "tax", "otherDeductions", "payable", "description"];

function payrollColumns(): PayrollColumn[] {
  const money = (value: string | undefined) => formatRupees(Number(value || 0));
  return [
    { key: "reference", label: "Ref no.", render: (record) => <span className="font-medium">{record.data.reference || "—"}</span> },
    {
      key: "employee",
      label: "Employee",
      render: (record) => (
        <>
          <p className="font-medium">{record.data.employeeName || "Unnamed employee"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{record.data.employeeId} · {record.data.cnic}</p>
          {record.data.employeeEmail ? <p className="mt-0.5 text-xs text-muted-foreground">{record.data.employeeEmail}</p> : null}
          <p className="mt-0.5 text-xs text-muted-foreground">Joined: {record.data.joiningDate || "Not set"}</p>
        </>
      ),
    },
    { key: "employeeId", label: "Employee ID", render: (record) => record.data.employeeId || "—" },
    { key: "cnic", label: "CNIC", render: (record) => record.data.cnic || "—" },
    { key: "employeeEmail", label: "Email", render: (record) => record.data.employeeEmail || "—" },
    { key: "joiningDate", label: "Joining date", render: (record) => record.data.joiningDate || "—" },
    { key: "month", label: "Month", render: (record) => record.data.month || "—" },
    { key: "designation", label: "Designation", render: (record) => record.data.designation || "—" },
    { key: "days", label: "Days", render: (record) => <span className="tabular-nums">{record.data.workedDays || "0"} / {record.data.workingDays || "0"}</span> },
    {
      key: "paymentAccount",
      label: "Payment account",
      render: (record) => record.data.paymentAccountName
        ? <><span className="font-medium">{record.data.paymentMethod || "Account"}</span><span className="block text-xs text-muted-foreground">{record.data.paymentAccountName}</span></>
        : <span className="text-muted-foreground">Not set</span>,
    },
    { key: "baseSalary", label: "Base salary", align: "right", render: (record) => money(record.data.baseSalary) },
    { key: "increment", label: "Increment", align: "right", render: (record) => money(record.data.increment) },
    { key: "allowances", label: "Allowances", align: "right", render: (record) => formatRupees(["incentive", "overtimeAllowance", "gymAllowance", "medicalAllowance", "otherAllowance"].reduce((sum, key) => sum + Number(record.data[key] || 0), 0)) },
    { key: "grossSalary", label: "Gross salary", align: "right", render: (record) => <span className="font-medium">{money(record.data.grossSalary)}</span> },
    { key: "tax", label: "Tax", align: "right", render: (record) => money(record.data.taxDeduction) },
    { key: "otherDeductions", label: "Other deductions", align: "right", render: (record) => formatRupees(Math.max(0, Number(record.data.totalDeductions || 0) - Number(record.data.taxDeduction || 0))) },
    { key: "payable", label: "Payable", align: "right", render: (record) => <span className="font-semibold">{money(record.data.payableSalary)}</span> },
    { key: "description", label: "Description", render: (record) => <span className="block max-w-56 truncate text-muted-foreground">{record.data.description || "—"}</span> },
  ];
}

const PAYROLL_COLUMNS = payrollColumns();

export default function PayrollWorkspace({ records, accounts, employees = [], asOfDate, dateRange }: PayrollWorkspaceProps) {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const currentMonth = asOfDate.slice(0, 7);
  const [savedRecords, setSavedRecords] = useState(records);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [customFromDate, setCustomFromDate] = useState(dateRange?.startDate ?? "");
  const [customToDate, setCustomToDate] = useState(dateRange?.endDate ?? "");
  const [search, setSearch] = useState("");
  const sheetCount = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<{ key: number; month: string; copyFrom?: BookkeepingRecord } | null>(null);
  const [isDeleting, setIsDeleting] = useState("");
  const [isSending, setIsSending] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(DEFAULT_PAYROLL_COLUMNS);
  const allColumns = PAYROLL_COLUMNS;
  const visibleColumns = allColumns.filter((column) => visibleColumnKeys.includes(column.key));

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(PAYROLL_COLUMNS_KEY) || "null");
      if (Array.isArray(stored) && stored.length) setVisibleColumnKeys(stored.filter((key): key is string => typeof key === "string"));
    } catch {
      // Stored choice unreadable; keep the default columns.
    }
  }, []);

  function saveVisibleColumns(next: string[]) {
    const keys = next.includes("employee") ? next : ["employee", ...next];
    setVisibleColumnKeys(keys);
    try {
      window.localStorage.setItem(PAYROLL_COLUMNS_KEY, JSON.stringify(keys));
    } catch {
      // Storage can be blocked; the choice still applies until reload.
    }
  }
  const paymentAccounts = accounts.filter((account) => paymentAccountType(account));

  const periodRecords = useMemo(() => savedRecords.filter((record) => {
    if (!customFromDate && !customToDate) return record.data.month === selectedMonth;
    const month = record.data.month || "";
    return (!customFromDate || month >= customFromDate.slice(0, 7)) && (!customToDate || month <= customToDate.slice(0, 7));
  }), [customFromDate, customToDate, savedRecords, selectedMonth]);
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return periodRecords;
    // A search looks across every month, so a salary can be found by its reference no.
    return savedRecords.filter((record) => [record.data.reference, record.data.employeeId, record.data.employeeName, record.data.employeeEmail, record.data.designation, record.data.cnic]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [periodRecords, savedRecords, search]);
  const monthTotals = useMemo(() => periodRecords.reduce((summary, record) => ({
    gross: summary.gross + Number(record.data.grossSalary || 0),
    payable: summary.payable + Number(record.data.payableSalary || 0),
    tax: summary.tax + Number(record.data.taxDeduction || 0),
  }), { gross: 0, payable: 0, tax: 0 }), [periodRecords]);

  function openNewEntry() {
    setSheet({ key: ++sheetCount.current, month: selectedMonth });
  }

  function openEditEntry(record: BookkeepingRecord) {
    setSheet({ key: ++sheetCount.current, month: record.data.month || selectedMonth });
  }

  function openCopiedEntry(record: BookkeepingRecord) {
    setSheet({ key: ++sheetCount.current, month: nextPayrollMonth(record.data.month || selectedMonth), copyFrom: record });
  }

  async function handleSendSlip(record: BookkeepingRecord) {
    setIsSending(record.id);
    try {
      await sendPayrollSlip(record.id);
      toast.success(`Salary slip sent to ${record.data.employeeEmail}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSending("");
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("The payroll CSV is too large. Keep it under 2 MB.");
      return;
    }
    setIsImporting(true);
    try {
      const result = await importPayrollCsv(await file.text());
      setSavedRecords(result.records);
      router.refresh();
      toast.success(`Payroll import complete: ${result.created} added, ${result.updated} updated.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  function payrollExportRows() {
    const headers = [...payrollCsvFields, "afterIncrement", "proratedSalary", "grossSalary", "estimatedTax", "totalDeductions", "payableSalary"];
    return [headers, ...filteredRecords.map((record) => headers.map((field) => record.data[field] || ""))];
  }

  function exportPayroll() {
    saveCsv("mikledger-payroll.csv", payrollExportRows());
  }

  async function exportPayrollExcel() {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(payrollExportRows()), "Payroll");
      XLSX.writeFile(workbook, "mikledger-payroll.xlsx");
    } catch {
      toast.error("We couldn’t create the Excel file. Please try again.");
    }
  }

  const visibleIds = filteredRecords.map((record) => record.id);
  const selectedRecords = filteredRecords.filter((record) => selectedIds.has(record.id));
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  async function deleteSelected() {
    if (!selectedRecords.length) {
      toast.info("Select payroll rows with the checkboxes first.");
      return;
    }
    const count = selectedRecords.length;
    if (!window.confirm(`Delete ${count} payroll ${count === 1 ? "entry" : "entries"}? This can’t be undone.`)) return;
    setIsDeleting("bulk");
    const deleted: string[] = [];
    for (const record of selectedRecords) {
      try {
        await deleteBookkeepingRecord("payroll", record.id);
        deleted.push(record.id);
      } catch (error) {
        toast.error(`${record.data.employeeName || "Entry"}: ${errorMessage(error)}`);
      }
    }
    setSavedRecords((previous) => previous.filter((item) => !deleted.includes(item.id)));
    setSelectedIds(new Set());
    setIsDeleting("");
    if (deleted.length) toast.success(`Deleted ${deleted.length} payroll ${deleted.length === 1 ? "entry" : "entries"}.`);
    router.refresh();
  }

  async function handleDelete(record: BookkeepingRecord) {
    if (!window.confirm(`Delete ${record.data.employeeName || "this employee"}’s payroll entry for ${monthLabel(record.data.month || selectedMonth)}?`)) return;
    setIsDeleting(record.id);
    try {
      await deleteBookkeepingRecord("payroll", record.id);
      setSavedRecords((previous) => previous.filter((item) => item.id !== record.id));
      toast.success("Payroll entry deleted.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsDeleting("");
    }
  }

  return (
    <main className="space-y-6 px-4 py-6 sm:px-7 lg:px-8">
      <section className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">People & payroll</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Payroll</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Prepare each employee’s monthly pay with Pakistan salary-tax estimates and a clear take-home total.</p>
        </div>
        <Button onClick={openNewEntry} className="w-full shrink-0 sm:w-auto"><Plus size={16} /> Add payroll entry</Button>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Payroll summary">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Employees this month</p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tabular-nums"><Users size={17} className="text-primary" />{periodRecords.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Gross payroll</p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tabular-nums"><Banknote size={17} className="text-primary" />{formatRupees(monthTotals.gross)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Tax withheld</p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tabular-nums"><CircleDollarSign size={17} className="text-primary" />{formatRupees(monthTotals.tax)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Payable salary</p>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tabular-nums"><Banknote size={17} className="text-primary" />{formatRupees(monthTotals.payable)}</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-semibold">Payroll register</h2>
            <p className="mt-1 text-xs text-muted-foreground">{customFromDate || customToDate ? `${customFromDate || "Any date"} – ${customToDate || "Any date"}` : monthLabel(selectedMonth)} · PKR</p>
          </div>
          <input ref={uploadRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Upload payroll CSV" onChange={(event) => { void handleImport(event.target.files?.[0]); event.target.value = ""; }} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center print:hidden">
            <Popover>
              <PopoverTrigger render={<Button type="button" variant="outline" className="justify-between gap-2 sm:w-auto"><CalendarDays size={15} /><span>Date: {customFromDate || customToDate ? `${customFromDate || "Any date"} – ${customToDate || "Any date"}` : monthLabel(selectedMonth)}</span><ChevronDown size={14} /></Button>} />
              <PopoverContent align="start" className="w-80 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-period-month">Payroll month</Label>
                  <Input id="payroll-period-month" type="month" value={selectedMonth} onChange={(event) => { setSelectedMonth(event.target.value); setCustomFromDate(""); setCustomToDate(""); }} />
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Or a custom date range</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="payroll-range-from">From</Label>
                      <Input id="payroll-range-from" type="date" value={customFromDate} onChange={(event) => setCustomFromDate(event.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="payroll-range-to">To</Label>
                      <Input id="payroll-range-to" type="date" value={customToDate} onChange={(event) => setCustomToDate(event.target.value)} />
                    </div>
                  </div>
                  {(customFromDate || customToDate) ? <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => { setCustomFromDate(""); setCustomToDate(""); }}>Clear range and use the month</Button> : null}
                </div>
              </PopoverContent>
            </Popover>
            <Input aria-label="Search payroll" placeholder="Search ref no. or employee…" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:w-56" />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" className="gap-2"><SlidersHorizontal size={16} />Customise</Button>} />
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  {allColumns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.key}
                      checked={visibleColumnKeys.includes(column.key)}
                      disabled={column.key === "employee"}
                      onCheckedChange={(checked) => saveVisibleColumns(checked ? [...visibleColumnKeys, column.key] : visibleColumnKeys.filter((key) => key !== column.key))}
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => saveVisibleColumns(DEFAULT_PAYROLL_COLUMNS)}>Reset to default</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2" disabled={isImporting}><ArrowUpDown size={15} />{isImporting ? "Importing…" : "Import / Export"}<ChevronDown size={14} /></Button>} />
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onClick={() => uploadRef.current?.click()}><FileUp size={15} />Import CSV</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Download</DropdownMenuLabel>
                  <DropdownMenuItem onClick={exportPayroll}><FileText size={15} />CSV file</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportPayrollExcel()}><FileSpreadsheet size={15} />Excel (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()}><Printer size={15} />Print or save as PDF</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!selectedRecords.length || isDeleting === "bulk"} onClick={() => void deleteSelected()}>
                  <Trash2 size={15} />{selectedRecords.length ? `Delete selected (${selectedRecords.length})` : "Delete selected"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {filteredRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 print:hidden">
                    <Checkbox
                      aria-label="Select all payroll rows shown"
                      checked={allSelected}
                      indeterminate={!allSelected && selectedRecords.length > 0}
                      onCheckedChange={(checked) => setSelectedIds(checked ? new Set(visibleIds) : new Set())}
                    />
                  </TableHead>
                  {visibleColumns.map((column) => <TableHead key={column.key} className={column.align === "right" ? "text-right" : undefined}>{column.label}</TableHead>)}
                  <TableHead className="print:hidden"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id} data-state={selectedIds.has(record.id) ? "selected" : undefined}>
                    <TableCell className="w-10 print:hidden">
                      <Checkbox
                        aria-label={`Select ${record.data.employeeName || "payroll entry"}`}
                        checked={selectedIds.has(record.id)}
                        onCheckedChange={(checked) => setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(record.id);
                          else next.delete(record.id);
                          return next;
                        })}
                      />
                    </TableCell>
                    {visibleColumns.map((column) => (
                      <TableCell key={column.key} className={column.align === "right" ? "text-right tabular-nums" : undefined}>{column.render(record)}</TableCell>
                    ))}
                    <TableCell className="print:hidden">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Copy salary for ${record.data.employeeName}`} title="Copy salary to next month" onClick={() => openCopiedEntry(record)}><Copy size={15} /></Button>
                        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href={`/app/payroll/${record.id}/print`} />} aria-label={`Download salary slip for ${record.data.employeeName}`} title="Print or save salary slip as PDF"><ArrowDownToLine size={15} /></Button>
                        <Button variant="ghost" size="icon" aria-label={`Send salary slip to ${record.data.employeeName}`} title="Send salary slip by email" onClick={() => void handleSendSlip(record)} disabled={isSending === record.id}><Mail size={15} /></Button>
                        <Button variant="ghost" size="icon" aria-label={`Edit ${record.data.employeeName}`} onClick={() => openEditEntry(record)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${record.data.employeeName}`} onClick={() => void handleDelete(record)} disabled={isDeleting === record.id}><Trash2 size={15} /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Banknote size={20} /></div>
            <h3 className="mt-4 font-semibold">{search ? "No matching employees" : "No payroll entries for this month"}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{search ? "Try another employee name, ID, designation, or CNIC." : "Add the first employee’s pay details to calculate gross salary, deductions, and take-home pay."}</p>
            {!search ? <Button variant="outline" className="mt-4" onClick={openNewEntry}><Plus size={15} /> Add first entry</Button> : null}
          </div>
        )}
      </section>

      <p className="text-xs leading-5 text-muted-foreground">Tax is estimated from Pakistan’s Tax Year 2027 salaried-income slabs using annualized monthly gross pay, assuming salary is more than 75% of taxable income. Review exemptions, benefits, and final withholding with your tax adviser.</p>

      {sheet ? (
        <PayrollSheet
          key={sheet.key}
          open
          onOpenChange={(next) => { if (!next) setSheet(null); }}
          month={sheet.month}
          copyFrom={sheet.copyFrom}
          employees={employees}
          paymentAccounts={paymentAccounts}
          existingRecords={savedRecords}
          onSaved={(saved, month) => {
            setSavedRecords((previous) => [...saved, ...previous.filter((record) => !saved.some((item) => item.id === record.id))]);
            setSelectedMonth(month);
            setCustomFromDate("");
            setCustomToDate("");
            router.refresh();
          }}
        />
      ) : null}
    </main>
  );
}
