"use client";

import { useState, type FormEvent } from "react";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { calculatePayroll, emptyPayrollValues, type PayrollValues, type SalaryTaxRule } from "@/lib/payroll-utils";
import { adjustedWorkedDays, parseSalaryRules, payrollAdjustments, salaryRuleAmounts } from "@/lib/payroll-adjustments";

export interface PayrollHrRecords {
  leaves: BookkeepingRecord[];
  loans: BookkeepingRecord[];
  attendance: BookkeepingRecord[];
  /** Weekly days off (UTC day numbers), which unpaid time off doesn't count. */
  weekend?: number[];
  /** Salary rules from Settings, which fill allowances and deductions on new lines. */
  salaryRules?: string;
}

interface PayrollSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  /** When set, the sheet starts from this entry's figures (used to copy a salary into another month). */
  copyFrom?: BookkeepingRecord | null;
  employees: BookkeepingRecord[];
  /** Payroll entries already saved; the month's entries load into the sheet and saving updates them. */
  existingRecords: BookkeepingRecord[];
  onSaved: (records: BookkeepingRecord[], month: string) => void;
  /** The country's salary tax, for the estimate shown when the tax box is empty. */
  taxRule?: SalaryTaxRule;
  currency?: string;
  /** Unpaid time off and absences lower a new line's worked days; running salary attachments fill its loan deduction. */
  hr?: PayrollHrRecords;
}

/** The HR figures for a new line: worked days after unpaid time off and absences, and this month's loan installment. */
function hrLine(month: string, employee: BookkeepingRecord, workingDays: string, hr?: PayrollHrRecords): Partial<SheetRow> {
  if (!hr) return {};
  const adjustments = payrollAdjustments(month, { id: employee.id, name: employee.data.name }, hr.leaves, hr.loans, hr.attendance, hr.weekend);
  const overtimeRate = Number(employee.data.overtimeRate) || 0;
  return {
    ...salaryRuleAmounts(parseSalaryRules(hr.salaryRules), Number(employee.data.baseSalary) || 0, employee.data.department),
    workedDays: adjustedWorkedDays(workingDays, adjustments),
    ...(adjustments.loanDeduction ? { loanDeduction: String(adjustments.loanDeduction) } : {}),
    ...(employee.data.socialDeduction ? { socialDeduction: employee.data.socialDeduction } : {}),
    ...(overtimeRate && adjustments.overtimeHours ? { overtimeAllowance: (Math.round(overtimeRate * adjustments.overtimeHours * 100) / 100).toFixed(2) } : {}),
  };
}

interface Person {
  employeeId: string;
  name: string;
  email: string;
  cnic: string;
  designation: string;
  joiningDate: string;
  paymentAccountId: string;
}

interface SheetRow {
  id: number;
  /** An Employees record id, or "entry:<payroll id>" for someone only on a saved payroll entry. */
  personKey: string;
  workedDays: string;
  baseSalary: string;
  increment: string;
  incentive: string;
  overtimeAllowance: string;
  gymAllowance: string;
  medicalAllowance: string;
  otherAllowance: string;
  taxDeduction: string;
  loanDeduction: string;
  fineDeduction: string;
  socialDeduction: string;
  adjustment: string;
  description: string;
}

/** Amount columns the sheet edits, in the order they appear; each matches a payroll entry field. */
const allowanceColumns = [
  { key: "incentive", label: "Incentive" },
  { key: "overtimeAllowance", label: "Overtime" },
  { key: "gymAllowance", label: "Gym" },
  { key: "medicalAllowance", label: "Medical" },
  { key: "otherAllowance", label: "Other allowance" },
] as const;
const deductionColumns = [
  // Advances and loans share one column; it saves to the loan deduction field.
  { key: "loanDeduction", label: "Advance / loan" },
  { key: "fineDeduction", label: "Fine" },
  { key: "socialDeduction", label: "EOBI / PF" },
  { key: "adjustment", label: "Other adjustment" },
] as const;
const amountKeys = ["baseSalary", "increment", ...allowanceColumns.map((column) => column.key), "taxDeduction", ...deductionColumns.map((column) => column.key)] as const;

function savedAmount(value: string | undefined) {
  return value && Number(value) ? value : "";
}

function personFromEmployee(employee: BookkeepingRecord): Person {
  return {
    employeeId: employee.data.employeeId || "",
    name: employee.data.name || "",
    email: employee.data.email || "",
    cnic: employee.data.cnic || "",
    designation: employee.data.designation || "",
    joiningDate: employee.data.joiningDate || "",
    paymentAccountId: employee.data.paymentAccountId || "",
  };
}

function personFromEntry(entry: BookkeepingRecord): Person {
  return {
    employeeId: entry.data.employeeId || "",
    name: entry.data.employeeName || "",
    email: entry.data.employeeEmail || "",
    cnic: entry.data.cnic || "",
    designation: entry.data.designation || "",
    joiningDate: entry.data.joiningDate || "",
    paymentAccountId: entry.data.paymentAccountId || "",
  };
}

function samePerson(entry: BookkeepingRecord, employee: BookkeepingRecord) {
  return entry.data.employeeId === employee.data.employeeId && entry.data.employeeName?.trim() === employee.data.name?.trim();
}

// Spreadsheet-style cells, matching the journal sheet: no box until a cell is focused.
const cellInput = "h-11 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:bg-transparent";
const cellBorder = "border-r border-dashed border-border";

function blankRow(id: number, workingDays: string): SheetRow {
  return {
    id, personKey: "", workedDays: workingDays, baseSalary: "", increment: "",
    incentive: "", overtimeAllowance: "", gymAllowance: "", medicalAllowance: "", otherAllowance: "",
    taxDeduction: "", loanDeduction: "", fineDeduction: "", socialDeduction: "", adjustment: "", description: "",
  };
}

function rowFromEntry(id: number, entry: BookkeepingRecord, personKey: string): SheetRow {
  const row: SheetRow = { ...blankRow(id, entry.data.workedDays || ""), personKey, description: entry.data.description || "" };
  for (const key of amountKeys) row[key] = savedAmount(entry.data[key]);
  row.taxDeduction = entry.data.taxDeduction || "";
  const advanceAndLoan = (Number(entry.data.advanceDeduction) || 0) + (Number(entry.data.loanDeduction) || 0);
  row.loanDeduction = advanceAndLoan ? String(Math.round(advanceAndLoan * 100) / 100) : "";
  return row;
}

/** The month's saved entries first, then active employees who have none yet, padded to five lines. */
function startingRows(month: string, entries: BookkeepingRecord[], activeEmployees: BookkeepingRecord[], employees: BookkeepingRecord[], workingDays: string, copyFrom?: BookkeepingRecord | null, hr?: PayrollHrRecords) {
  const keyFor = (entry: BookkeepingRecord) => employees.find((employee) => samePerson(entry, employee))?.id ?? `entry:${entry.id}`;
  const rows: SheetRow[] = copyFrom
    ? [{ ...rowFromEntry(1, copyFrom, keyFor(copyFrom)), workedDays: workingDays }]
    : entries.filter((entry) => entry.data.month === month).map((entry, index) => rowFromEntry(index + 1, entry, keyFor(entry)));
  if (!copyFrom) {
    for (const employee of activeEmployees) {
      if (!rows.some((row) => row.personKey === employee.id)) {
        rows.push({ ...blankRow(rows.length + 1, workingDays), personKey: employee.id, baseSalary: employee.data.baseSalary || "", ...hrLine(month, employee, workingDays, hr) });
      }
    }
  }
  while (rows.length < 5) rows.push(blankRow(rows.length + 1, workingDays));
  return rows.map((row, index) => ({ ...row, id: index + 1 }));
}

function defaultReference(month: string) {
  return month ? `SAL-${month}` : "SAL";
}

function formatPay(value: number, currency: string) {
  if (currency === "PKR") return `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

/** Enter a month's salaries for many employees at once, one employee per line. */
export default function PayrollSheet({ open, onOpenChange, month: initialMonth, copyFrom, employees, existingRecords, onSaved, taxRule, currency = "PKR", hr }: PayrollSheetProps) {
  const rupees = (value: number) => formatPay(value, currency);
  const activeEmployees = employees.filter((employee) => employee.data.name?.trim() && employee.data.status !== "Inactive");
  const monthEntries = existingRecords.filter((entry) => entry.data.month === initialMonth);
  const [month, setMonth] = useState(initialMonth);
  const [reference, setReference] = useState(() => (copyFrom ? "" : monthEntries.find((entry) => entry.data.reference)?.data.reference) || defaultReference(initialMonth));
  const [workingDays, setWorkingDays] = useState(() => (copyFrom ?? monthEntries[0])?.data.workingDays || "26");
  const [rows, setRows] = useState<SheetRow[]>(() => startingRows(initialMonth, existingRecords, activeEmployees, employees, (copyFrom ?? monthEntries[0])?.data.workingDays || "26", copyFrom, hr));
  const [nextId, setNextId] = useState(() => rows.length + 1);
  // People who appear only on saved entries (not on the Employees list) stay pickable.
  const entryPeople = new Map<string, Person>();
  for (const entry of [...existingRecords, ...(copyFrom ? [copyFrom] : [])]) {
    if (!employees.some((employee) => samePerson(entry, employee))) entryPeople.set(`entry:${entry.id}`, personFromEntry(entry));
  }

  function personFor(key: string): Person | null {
    const employee = employees.find((item) => item.id === key);
    if (employee) return personFromEmployee(employee);
    return entryPeople.get(key) ?? null;
  }
  const [pending, setPending] = useState(false);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [error, setError] = useState("");

  function payrollValues(row: SheetRow): PayrollValues | null {
    const person = personFor(row.personKey);
    if (!person) return null;
    return {
      ...emptyPayrollValues(month),
      employeeId: person.employeeId,
      employeeName: person.name,
      employeeEmail: person.email,
      cnic: person.cnic,
      designation: person.designation,
      joiningDate: person.joiningDate,
      paymentAccountId: person.paymentAccountId,
      ...Object.fromEntries(amountKeys.map((key) => [key, row[key] || "0"])),
      taxDeduction: row.taxDeduction,
      workingDays: workingDays || "0",
      workedDays: row.workedDays || "0",
      reference: reference.trim(),
      description: row.description,
    };
  }

  function updateRow(id: number, key: keyof Omit<SheetRow, "id">, value: string) {
    setError("");
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      if (key !== "personKey") return { ...row, [key]: value };
      const employee = employees.find((item) => item.id === value);
      // A newly picked employee brings their wage and this month's time off, absences and loan installment.
      const fresh = !row.personKey && employee ? hrLine(month, employee, workingDays, hr) : {};
      return { ...row, ...fresh, personKey: value, baseSalary: row.baseSalary || employee?.data.baseSalary || "" };
    }));
  }

  function changeMonth(value: string) {
    // Keep the reference in step with the month unless it was typed in by hand.
    if (reference === defaultReference(month)) setReference(defaultReference(value));
    setMonth(value);
  }

  function changeWorkingDays(value: string) {
    // Lines still on the old full-month count follow the new one.
    setRows((current) => current.map((row) => (row.workedDays === workingDays ? { ...row, workedDays: value } : row)));
    setWorkingDays(value);
  }

  function addLines() {
    setRows((current) => [...current, ...Array.from({ length: 5 }, (_, index) => blankRow(nextId + index, workingDays))]);
    setNextId((current) => current + 5);
  }

  function clearLines() {
    setRows(Array.from({ length: 5 }, (_, index) => blankRow(nextId + index, workingDays)));
    setNextId((current) => current + 5);
    setError("");
  }

  function previousMonth(value: string) {
    const [year, monthNumber] = value.split("-").map(Number);
    const date = new Date(year, monthNumber - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  /** Fill the sheet with last month's salaries for every employee paid then, keeping this month's working days. */
  function copyPreviousMonth() {
    const sourceMonth = previousMonth(month);
    const entries = existingRecords.filter((entry) => entry.data.month === sourceMonth);
    if (!entries.length) {
      toast.info(`No payroll saved for ${sourceMonth} to copy.`);
      return;
    }
    const keyFor = (entry: BookkeepingRecord) => employees.find((employee) => samePerson(entry, employee))?.id ?? `entry:${entry.id}`;
    const copied = entries.map((entry, index) => ({ ...rowFromEntry(nextId + index, entry, keyFor(entry)), workedDays: workingDays }));
    const others = rows.filter((row) => row.personKey && !copied.some((line) => line.personKey === row.personKey));
    setRows([...copied, ...others]);
    setNextId((current) => current + copied.length);
    setError("");
    toast.success(`Copied ${copied.length} ${copied.length === 1 ? "salary" : "salaries"} from ${sourceMonth}. Review and save.`);
  }

  function moveRow(fromId: number, toId: number) {
    if (fromId === toId) return;
    setRows((current) => {
      const from = current.findIndex((row) => row.id === fromId);
      const to = current.findIndex((row) => row.id === toId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moving] = next.splice(from, 1);
      next.splice(to, 0, moving);
      return next;
    });
  }

  function copyLine(id: number) {
    setRows((current) => current.flatMap((row) => (row.id === id ? [row, { ...row, id: nextId }] : [row])));
    setNextId((current) => current + 1);
  }

  function removeLine(id: number) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : [blankRow(nextId, workingDays)]));
    setNextId((current) => current + 1);
  }

  const lineTotals = rows.map((row) => {
    const values = payrollValues(row);
    return values ? calculatePayroll(values, taxRule) : null;
  });
  const columnTotal = (key: keyof SheetRow) => rows.reduce((sum, row, index) => sum + (lineTotals[index] ? Number(row[key]) || 0 : 0), 0);
  const sheetTotals = lineTotals.reduce((sum, totals) => totals ? {
    gross: sum.gross + totals.grossSalary,
    tax: sum.tax + totals.taxDeduction,
    payable: sum.payable + totals.payableSalary,
  } : sum, { gross: 0, tax: 0, payable: 0 });
  const allowanceTotal = (row: SheetRow) => allowanceColumns.reduce((sum, column) => sum + (Number(row[column.key]) || 0), 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filled = rows.filter((row) => row.personKey);
    if (!filled.length) {
      setError("Choose at least one employee.");
      return;
    }
    const chosen = filled.map((row) => row.personKey);
    const duplicate = chosen.find((id, index) => chosen.indexOf(id) !== index);
    if (duplicate) {
      setError(`${personFor(duplicate)?.name || "An employee"} is on the sheet twice.`);
      return;
    }
    setPending(true);
    setError("");
    const saved: BookkeepingRecord[] = [];
    const failed: string[] = [];
    for (const row of filled) {
      const values = payrollValues(row);
      if (!values) continue;
      const existing = existingRecords.find((record) => record.data.month === month && record.data.employeeId === values.employeeId && record.data.employeeName === values.employeeName);
      try {
        saved.push(await saveBookkeepingRecord("payroll", { ...values }, existing?.id));
      } catch (saveError) {
        failed.push(`${values.employeeName}: ${saveError instanceof Error ? readableError(saveError) : "couldn’t be saved"}`);
      }
    }
    setPending(false);
    if (saved.length) {
      onSaved(saved, month);
      toast.success(`Saved salary for ${saved.length} ${saved.length === 1 ? "employee" : "employees"}.`);
    }
    if (failed.length) {
      setError(failed.join(" "));
      setRows((current) => current.filter((row) => !row.personKey || !saved.some((record) => record.data.employeeName === personFor(row.personKey)?.name)));
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(1400px,calc(100vw-3rem))]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">Payroll sheet</DialogTitle>
          <DialogDescription>One line per employee for the month. Gross, tax and payable work out as you type; leave Tax empty to use the estimate. Removing a line here doesn’t delete a saved entry.</DialogDescription>
        </DialogHeader>

        <form id="payroll-sheet-form" onSubmit={submit} className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sheet-reference">Reference no. <span className="text-destructive">*</span></Label>
              <Input id="sheet-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} required placeholder="SAL-2026-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sheet-month">Payroll month <span className="text-destructive">*</span></Label>
              <Input id="sheet-month" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sheet-working-days">Total working days</Label>
              <Input id="sheet-working-days" type="number" min="1" max="31" step="1" value={workingDays} onChange={(event) => changeWorkingDays(event.target.value)} required />
            </div>
          </div>

          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[2360px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  <th className="sticky left-0 z-10 w-8 min-w-8 bg-card" aria-label="Reorder" />
                  <th className={`sticky left-8 z-10 w-9 min-w-9 bg-card py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                  <th className={`sticky left-[4.25rem] z-10 min-w-52 bg-card px-2.5 py-2.5 text-left ${cellBorder}`}>Employee</th>
                  <th className={`w-28 px-2.5 py-2.5 text-left ${cellBorder}`}>Employee ID</th>
                  <th className={`w-36 px-2.5 py-2.5 text-left ${cellBorder}`}>Designation</th>
                  <th className={`w-20 px-2.5 py-2.5 text-right ${cellBorder}`}>Days</th>
                  <th className={`w-32 px-2.5 py-2.5 text-right ${cellBorder}`}>Base salary</th>
                  <th className={`w-28 px-2.5 py-2.5 text-right ${cellBorder}`}>Increment</th>
                  {allowanceColumns.map((column) => <th key={column.key} className={`w-28 px-2.5 py-2.5 text-right ${cellBorder}`}>{column.label}</th>)}
                  <th className={`w-32 bg-muted/40 px-2.5 py-2.5 text-right ${cellBorder}`}>Total allowances</th>
                  <th className={`w-32 px-2.5 py-2.5 text-right ${cellBorder}`}>Gross salary</th>
                  <th className={`w-28 px-2.5 py-2.5 text-right ${cellBorder}`}>Tax</th>
                  {deductionColumns.map((column) => <th key={column.key} className={`w-28 px-2.5 py-2.5 text-right ${cellBorder}`}>{column.label}</th>)}
                  <th className={`w-32 px-2.5 py-2.5 text-right ${cellBorder}`}>Payable</th>
                  <th className={`min-w-64 px-2.5 py-2.5 text-left ${cellBorder}`}>Description</th>
                  <th className="w-20"><span className="sr-only">Line actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const person = personFor(row.personKey);
                  const totals = lineTotals[index];
                  const number = (key: "workedDays" | (typeof amountKeys)[number], label: string, placeholder?: string) => (
                    <td key={key} className={`p-0 ${cellBorder}`}>
                      <Input aria-label={`${label} for line ${index + 1}`} type="number" min={key === "adjustment" ? undefined : "0"} step={key === "workedDays" ? "1" : "0.01"} inputMode="decimal" value={row[key]} placeholder={placeholder} onChange={(event) => updateRow(row.id, key, event.target.value)} className={`${cellInput} text-right tabular-nums`} />
                    </td>
                  );
                  return (
                    <tr
                      key={row.id}
                      className={`group border-b border-border hover:bg-muted/30 ${draggedRowId === row.id ? "opacity-50" : ""}`}
                      onDragOver={(event) => { if (draggedRowId !== null) event.preventDefault(); }}
                      onDrop={(event) => { event.preventDefault(); if (draggedRowId !== null) moveRow(draggedRowId, row.id); setDraggedRowId(null); }}
                    >
                      <td className="sticky left-0 z-10 w-8 min-w-8 bg-card text-center">
                        <span draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedRowId(row.id); }} onDragEnd={() => setDraggedRowId(null)} className="inline-flex cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing" aria-label={`Drag line ${index + 1} to reorder`} title="Drag to reorder"><GripVertical size={15} /></span>
                      </td>
                      <td className={`sticky left-8 z-10 w-9 min-w-9 bg-card pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                      <td className={`sticky left-[4.25rem] z-10 min-w-52 bg-card p-0 ${cellBorder}`}>
                        <Select value={row.personKey || null} onValueChange={(value) => updateRow(row.id, "personKey", value ?? "")}>
                          <SelectTrigger className={`${cellInput} !h-11 justify-between [&_svg]:opacity-0 group-hover:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100`} aria-label={`Employee for line ${index + 1}`}>
                            <SelectValue placeholder={activeEmployees.length ? "" : "Add employees first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {activeEmployees.map((item) => <SelectItem key={item.id} value={item.id}>{item.data.name}</SelectItem>)}
                            {[...entryPeople].map(([key, entryPerson]) => <SelectItem key={key} value={key}>{entryPerson.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`px-2.5 text-muted-foreground ${cellBorder}`}>{person?.employeeId || ""}</td>
                      <td className={`px-2.5 text-muted-foreground ${cellBorder}`}>{person?.designation || ""}</td>
                      {number("workedDays", "Worked days")}
                      {number("baseSalary", "Base salary")}
                      {number("increment", "Increment")}
                      {allowanceColumns.map((column) => number(column.key, column.label))}
                      <td className={`bg-muted/40 px-2.5 text-right tabular-nums ${cellBorder}`}>{totals ? rupees(allowanceTotal(row)) : ""}</td>
                      <td className={`px-2.5 text-right font-medium tabular-nums ${cellBorder}`}>{totals ? rupees(totals.grossSalary) : ""}</td>
                      {number("taxDeduction", "Tax", totals ? String(Math.round(totals.estimatedTax)) : "")}
                      {deductionColumns.map((column) => number(column.key, column.label))}
                      <td className={`px-2.5 text-right font-semibold tabular-nums ${cellBorder}`}>{totals ? rupees(totals.payableSalary) : ""}</td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Input aria-label={`Description for line ${index + 1}`} value={row.description} maxLength={1000} onChange={(event) => updateRow(row.id, "description", event.target.value)} className={cellInput} />
                      </td>
                      <td className="px-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy line ${index + 1}`} title="Copy line" onClick={() => copyLine(row.id)} disabled={pending}><Copy size={14} /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove line ${index + 1}`} title="Remove line" onClick={() => removeLine(row.id)} disabled={pending}><Trash2 size={14} /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm font-semibold">
                  <td />
                  <td className={cellBorder} />
                  <td colSpan={6} className={`px-2.5 py-3 text-right ${cellBorder}`}>Total</td>
                  {allowanceColumns.map((column) => <td key={column.key} className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(columnTotal(column.key))}</td>)}
                  <td className={`bg-muted/40 px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(allowanceColumns.reduce((sum, column) => sum + columnTotal(column.key), 0))}</td>
                  <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(sheetTotals.gross)}</td>
                  <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(sheetTotals.tax)}</td>
                  {deductionColumns.map((column) => <td key={column.key} className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(columnTotal(column.key))}</td>)}
                  <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{rupees(sheetTotals.payable)}</td>
                  <td className={cellBorder} />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLines} disabled={pending}><Plus size={14} />Add lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearLines} disabled={pending}>Clear all lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={copyPreviousMonth} disabled={pending} title="Fill this sheet with the previous month’s salaries"><Copy size={14} />Copy previous month</Button>
          </div>
          {!activeEmployees.length && !entryPeople.size ? <p className="text-sm text-muted-foreground">Add your staff on the Employees page first, then pick them here.</p> : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        </form>

        <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="payroll-sheet-form" disabled={pending}>{pending ? "Saving…" : "Save salaries"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
