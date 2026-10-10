"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CalendarDays, CircleDollarSign, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { deleteBookkeepingRecord } from "@/app/actions";
import { savePayrollRecord } from "@/app/payroll-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { calculatePayroll, emptyPayrollValues, type PayrollValues } from "@/lib/payroll-utils";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface PayrollWorkspaceProps {
  records: BookkeepingRecord[];
  asOfDate: string;
}

interface PayrollFieldSpec {
  name: keyof PayrollValues;
  label: string;
  type?: "text" | "number";
  required?: boolean;
  step?: string;
  allowNegative?: boolean;
  placeholder?: string;
}

const earningsFields: PayrollFieldSpec[] = [
  { name: "baseSalary", label: "Base salary", type: "number", required: true, step: "0.01" },
  { name: "increment", label: "Increment", type: "number", step: "0.01" },
  { name: "incentive", label: "Incentive", type: "number", step: "0.01" },
  { name: "overtimeAllowance", label: "Overtime allowance", type: "number", step: "0.01" },
  { name: "gymAllowance", label: "Gym allowance", type: "number", step: "0.01" },
  { name: "medicalAllowance", label: "Medical allowance", type: "number", step: "0.01" },
  { name: "otherAllowance", label: "Other allowance", type: "number", step: "0.01" },
];

const deductionFields: PayrollFieldSpec[] = [
  { name: "advanceDeduction", label: "Advance deduction", type: "number", step: "0.01" },
  { name: "loanDeduction", label: "Loan deduction", type: "number", step: "0.01" },
  { name: "fineDeduction", label: "Fine", type: "number", step: "0.01" },
  { name: "adjustment", label: "Adjustment (+ / −)", type: "number", step: "0.01", allowNegative: true },
];

function recordToValues(record: BookkeepingRecord, month: string): PayrollValues {
  const defaults = emptyPayrollValues(month);
  const data = record.data;
  return {
    ...defaults,
    employeeId: data.employeeId || "",
    employeeName: data.employeeName || "",
    cnic: data.cnic || "",
    designation: data.designation || "",
    month: data.month || month,
    baseSalary: data.baseSalary || "0",
    increment: data.increment || "0",
    workingDays: data.workingDays || "26",
    workedDays: data.workedDays || "26",
    incentive: data.incentive || "0",
    overtimeAllowance: data.overtimeAllowance || "0",
    gymAllowance: data.gymAllowance || "0",
    medicalAllowance: data.medicalAllowance || "0",
    otherAllowance: data.otherAllowance || "0",
    taxDeduction: data.taxDeduction || "",
    advanceDeduction: data.advanceDeduction || "0",
    loanDeduction: data.loanDeduction || "0",
    fineDeduction: data.fineDeduction || "0",
    adjustment: data.adjustment || "0",
    description: data.description || "",
  };
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
  return error instanceof Error ? error.message : "We couldn’t save this payroll entry. Please try again.";
}

export default function PayrollWorkspace({ records, asOfDate }: PayrollWorkspaceProps) {
  const router = useRouter();
  const currentMonth = asOfDate.slice(0, 7);
  const [savedRecords, setSavedRecords] = useState(records);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [values, setValues] = useState<PayrollValues>(() => emptyPayrollValues(currentMonth));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState("");
  const totals = calculatePayroll(values);

  const periodRecords = useMemo(() => savedRecords.filter((record) => record.data.month === selectedMonth), [savedRecords, selectedMonth]);
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return periodRecords;
    return periodRecords.filter((record) => [record.data.employeeId, record.data.employeeName, record.data.designation, record.data.cnic]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [periodRecords, search]);
  const monthTotals = useMemo(() => periodRecords.reduce((summary, record) => ({
    gross: summary.gross + Number(record.data.grossSalary || 0),
    payable: summary.payable + Number(record.data.payableSalary || 0),
    tax: summary.tax + Number(record.data.taxDeduction || 0),
  }), { gross: 0, payable: 0, tax: 0 }), [periodRecords]);

  function updateField(name: keyof PayrollValues, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  function openNewEntry() {
    setEditingId("");
    setValues(emptyPayrollValues(selectedMonth));
    setDialogOpen(true);
  }

  function openEditEntry(record: BookkeepingRecord) {
    setEditingId(record.id);
    setValues(recordToValues(record, selectedMonth));
    setDialogOpen(true);
  }

  function renderInputField(spec: PayrollFieldSpec) {
    const inputId = `payroll-${spec.name}`;
    return (
      <div key={spec.name} className="space-y-1.5">
        <Label htmlFor={inputId}>{spec.label}{spec.required ? <span className="text-destructive"> *</span> : null}</Label>
        <Input
          id={inputId}
          name={spec.name}
          type={spec.type || "text"}
          value={values[spec.name]}
          onChange={(event) => updateField(spec.name, event.target.value)}
          required={spec.required}
          min={spec.type === "number" && !spec.allowNegative ? "0" : undefined}
          step={spec.step}
          placeholder={spec.placeholder}
        />
      </div>
    );
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const saved = await savePayrollRecord(values, editingId || undefined);
      setSavedRecords((previous) => [saved, ...previous.filter((record) => record.id !== saved.id)]);
      setSelectedMonth(saved.data.month);
      setDialogOpen(false);
      toast.success(editingId ? "Payroll entry updated." : "Payroll entry saved.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
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

  const employeeFields: PayrollFieldSpec[] = [
    { name: "employeeId", label: "Employee ID", required: true, placeholder: "EMP-001" },
    { name: "employeeName", label: "Employee name", required: true, placeholder: "Full name" },
    { name: "cnic", label: "CNIC", required: true, placeholder: "12345-1234567-1" },
    { name: "designation", label: "Designation", required: true, placeholder: "Job title" },
  ];

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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Payroll summary">
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
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Monthly pay register</h2>
            <p className="mt-1 text-xs text-muted-foreground">{monthLabel(selectedMonth)} · PKR</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Payroll month" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="pl-9 sm:w-48" />
            </div>
            <Input aria-label="Search payroll" placeholder="Search employee…" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:w-56" />
          </div>
        </div>
        {filteredRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead className="text-right">Gross salary</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Other deductions</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <p className="font-medium">{record.data.employeeName || "Unnamed employee"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{record.data.employeeId} · {record.data.cnic}</p>
                    </TableCell>
                    <TableCell>{record.data.designation || "—"}</TableCell>
                    <TableCell className="tabular-nums">{record.data.workedDays || "0"} / {record.data.workingDays || "0"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatRupees(Number(record.data.grossSalary || 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupees(Number(record.data.taxDeduction || 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupees(Math.max(0, Number(record.data.totalDeductions || 0) - Number(record.data.taxDeduction || 0)))}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatRupees(Number(record.data.payableSalary || 0))}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{record.data.description || "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92svh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit payroll entry" : "Add payroll entry"}</DialogTitle>
            <DialogDescription>Enter the employee’s salary and attendance. Gross pay, estimated tax, deductions, and payable salary update below.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-6">
            <input type="hidden" name="month" value={values.month} />
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Employee details</h3>
              <div className="grid gap-4 sm:grid-cols-2">{employeeFields.map(renderInputField)}</div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-month">Payroll month</Label>
                  <Input id="payroll-month" type="month" value={values.month} onChange={(event) => updateField("month", event.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-working-days">Total working days</Label>
                  <Input id="payroll-working-days" type="number" min="1" max="31" step="1" value={values.workingDays} onChange={(event) => updateField("workingDays", event.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-worked-days">Worked days</Label>
                  <Input id="payroll-worked-days" type="number" min="0" max="31" step="1" value={values.workedDays} onChange={(event) => updateField("workedDays", event.target.value)} required />
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Earnings</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{earningsFields.map(renderInputField)}</div>
              <div className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">After increment</p><p className="mt-1 font-semibold tabular-nums">{formatRupees(totals.revisedSalary)}</p></div>
                <div><p className="text-xs text-muted-foreground">Attendance-adjusted basic</p><p className="mt-1 font-semibold tabular-nums">{formatRupees(totals.proratedSalary)}</p></div>
                <div><p className="text-xs text-muted-foreground">Gross salary</p><p className="mt-1 font-semibold tabular-nums">{formatRupees(totals.grossSalary)}</p></div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Tax and deductions</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="payroll-tax">Income tax (PKR)</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => updateField("taxDeduction", "")}>Use estimate</Button>
                  </div>
                  <Input id="payroll-tax" type="number" min="0" step="0.01" value={values.taxDeduction || totals.estimatedTax.toFixed(2)} onChange={(event) => updateField("taxDeduction", event.target.value)} />
                  <p className="text-xs text-muted-foreground">Estimate: {formatRupees(totals.estimatedTax)} / month</p>
                </div>
                {deductionFields.map(renderInputField)}
              </div>
              <p className="text-xs text-muted-foreground">Use a positive adjustment to add pay, or a negative value to reduce it.</p>
            </section>

            <section className="space-y-3 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Description</h3>
              <div className="space-y-1.5">
                <Label htmlFor="payroll-description">Notes for this payroll entry</Label>
                <Textarea id="payroll-description" rows={3} maxLength={1000} value={values.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Add a note about attendance, incentive, or an adjustment" />
              </div>
            </section>

            <section className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Final payable salary</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatRupees(totals.payableSalary)}</p>
              </div>
              <p className="text-xs text-muted-foreground">Gross pay − tax − advance − loan − fines + adjustment</p>
            </section>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : editingId ? "Save changes" : "Save payroll entry"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
