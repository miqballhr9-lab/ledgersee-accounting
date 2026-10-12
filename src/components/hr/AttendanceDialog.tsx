"use client";

import { useState } from "react";
import { toast } from "sonner";

import { markAttendance } from "@/app/hr-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { attendanceStatuses } from "@/lib/hr-config";
import { errorText, today, type CrmContextValue } from "@/components/crm/crm-shared";

interface Row {
  status: string;
  checkIn: string;
  checkOut: string;
}

function rowsFor(date: string, employees: BookkeepingRecord[], attendance: BookkeepingRecord[], leaves: BookkeepingRecord[], holidays: BookkeepingRecord[]) {
  const holiday = holidays.some((item) => item.data.date === date);
  const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
  return Object.fromEntries(employees.map((employee) => {
    const marked = attendance.find((item) => item.data.employeeId === employee.id && item.data.date === date);
    if (marked) return [employee.id, { status: marked.data.status || "Present", checkIn: marked.data.checkIn || "", checkOut: marked.data.checkOut || "" }];
    const onLeave = leaves.some((item) => item.data.employeeId === employee.id && item.data.status === "Approved" && item.data.fromDate <= date && item.data.toDate >= date);
    const status = holiday || sunday ? "Holiday" : onLeave ? "On leave" : "Present";
    return [employee.id, { status, checkIn: status === "Present" ? "09:00" : "", checkOut: status === "Present" ? "17:00" : "" }];
  })) as Record<string, Row>;
}

/** Marks a whole day's attendance in one sheet, starting from leave and holidays already known. */
export default function AttendanceDialog({ open, onOpenChange, context }: { open: boolean; onOpenChange: (open: boolean) => void; context: CrmContextValue }) {
  const employees = (context.store.employees ?? []).filter((employee) => employee.data.status !== "Inactive").sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  const [date, setDate] = useState(today());
  const source = () => rowsFor(date, employees, context.store["hr-attendance"] ?? [], context.store["hr-leaves"] ?? [], context.store["hr-holidays"] ?? []);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loadedFor, setLoadedFor] = useState("");
  const [saving, setSaving] = useState(false);
  const key = `${open}-${date}`;
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setRows(source());
  }

  function update(id: string, changes: Partial<Row>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await markAttendance(date, employees.map((employee) => ({ employeeId: employee.id, ...rows[employee.id] })));
      context.upsert(saved);
      toast.success(`Attendance saved for ${saved.length} ${saved.length === 1 ? "employee" : "employees"}.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mark attendance</DialogTitle>
          <DialogDescription>One row per active employee. Approved leave and holidays are filled in for you; change anything before saving.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">Date</Label>
            <Input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows(Object.fromEntries(employees.map((employee) => [employee.id, { ...rows[employee.id], status: "Present", checkIn: rows[employee.id]?.checkIn || "09:00", checkOut: rows[employee.id]?.checkOut || "17:00" }])))}>Everyone present</Button>
        </div>
        {employees.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Check in</th><th className="px-3 py-2">Check out</th></tr></thead>
              <tbody>
                {employees.map((employee) => {
                  const row = rows[employee.id] ?? { status: "Present", checkIn: "", checkOut: "" };
                  const away = ["Absent", "On leave", "Holiday"].includes(row.status);
                  return (
                    <tr key={employee.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2"><p className="font-medium">{employee.data.name}</p><p className="text-xs text-muted-foreground">{employee.data.employeeId} · {employee.data.designation}</p></td>
                      <td className="px-3 py-2">
                        <Select value={row.status} onValueChange={(value) => update(employee.id, { status: String(value ?? "Present") })}>
                          <SelectTrigger className="w-[130px]" aria-label={`Status for ${employee.data.name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{attendanceStatuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2"><Input type="time" className="w-[120px]" value={row.checkIn} disabled={away} aria-label={`Check in for ${employee.data.name}`} onChange={(event) => update(employee.id, { checkIn: event.target.value })} /></td>
                      <td className="px-3 py-2"><Input type="time" className="w-[120px]" value={row.checkOut} disabled={away} aria-label={`Check out for ${employee.data.name}`} onChange={(event) => update(employee.id, { checkOut: event.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-md bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">Add employees first (HR → Employees).</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving || !employees.length} onClick={() => void save()}>{saving ? "Saving…" : "Save attendance"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
