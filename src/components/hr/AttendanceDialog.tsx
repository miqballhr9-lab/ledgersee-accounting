"use client";

import { useState, type FormEvent } from "react";
import { CalendarCheck, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { markAttendance } from "@/app/hr-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { attendanceStatuses } from "@/lib/hr-config";
import { errorText, today, type CrmContextValue } from "@/components/crm/crm-shared";

interface SheetRow {
  id: number;
  employeeId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  notes: string;
}

const awayStatuses = ["Absent", "On leave", "Holiday"];

// Spreadsheet-style cells, matching the payroll sheet: no box until a cell is focused.
const cellInput = "h-11 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:bg-transparent";
const cellBorder = "border-r border-dashed border-border";

function minutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function hoursBetween(checkIn: string, checkOut: string) {
  const start = minutes(checkIn);
  const end = minutes(checkOut);
  return start !== null && end !== null && end > start ? Math.round(((end - start) / 60) * 100) / 100 : null;
}

function blankRow(id: number): SheetRow {
  return { id, employeeId: "", status: "Present", checkIn: "", checkOut: "", notes: "" };
}

function previousDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * The attendance sheet: one line per employee for a day, like the payroll
 * sheet. Saved attendance for the day loads in; everyone else starts from
 * approved leave, holidays and the office hours, and saving updates anyone
 * already marked.
 */
export default function AttendanceDialog({ open, onOpenChange, context }: { open: boolean; onOpenChange: (open: boolean) => void; context: CrmContextValue }) {
  const allEmployees = context.store.employees ?? [];
  const employees = allEmployees.filter((employee) => employee.data.status !== "Inactive" && employee.data.name?.trim()).sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  const attendance = context.store["hr-attendance"] ?? [];
  const [date, setDate] = useState(today());
  const [officeStart, setOfficeStart] = useState("09:00");
  const [officeEnd, setOfficeEnd] = useState("17:00");
  const [graceMinutes, setGraceMinutes] = useState("15");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [loadedFor, setLoadedFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [error, setError] = useState("");

  /** Saved attendance for the day first, then active employees not yet marked, padded to five lines. */
  function startingRows(day: string, start: string, end: string): SheetRow[] {
    const holidays = context.store["hr-holidays"] ?? [];
    const leaves = context.store["hr-leaves"] ?? [];
    const holiday = holidays.some((item) => item.data.date === day);
    const dayOff = (context.weekend ?? [0]).includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    const lines: SheetRow[] = [];
    for (const record of attendance.filter((item) => item.data.date === day)) {
      if (!allEmployees.some((employee) => employee.id === record.data.employeeId)) continue;
      lines.push({ id: lines.length + 1, employeeId: record.data.employeeId ?? "", status: record.data.status || "Present", checkIn: record.data.checkIn || "", checkOut: record.data.checkOut || "", notes: record.data.notes || "" });
    }
    for (const employee of employees) {
      if (lines.some((line) => line.employeeId === employee.id)) continue;
      const onLeave = leaves.some((item) => item.data.employeeId === employee.id && item.data.status === "Approved" && item.data.fromDate <= day && item.data.toDate >= day);
      const status = holiday || dayOff ? "Holiday" : onLeave ? "On leave" : "Present";
      lines.push({ id: lines.length + 1, employeeId: employee.id, status, checkIn: status === "Present" ? start : "", checkOut: status === "Present" ? end : "", notes: "" });
    }
    while (lines.length < 5) lines.push(blankRow(lines.length + 1));
    return lines;
  }

  const key = `${open}-${date}`;
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    const fresh = startingRows(date, officeStart, officeEnd);
    setRows(fresh);
    setNextId(fresh.length + 1);
    setError("");
  }

  /** Late when checking in after office start plus the grace minutes. */
  function lateness(checkIn: string, status: string) {
    if (status !== "Present" && status !== "Late") return status;
    const start = minutes(officeStart);
    const arrived = minutes(checkIn);
    if (start === null || arrived === null) return status;
    return arrived > start + (Number(graceMinutes) || 0) ? "Late" : "Present";
  }

  function updateRow(id: number, changes: Partial<SheetRow>) {
    setError("");
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...changes };
      if (changes.employeeId !== undefined && !row.employeeId && !next.checkIn && next.status === "Present") {
        next.checkIn = officeStart;
        next.checkOut = officeEnd;
      }
      if (changes.status && awayStatuses.includes(changes.status)) {
        next.checkIn = "";
        next.checkOut = "";
      }
      if (changes.status && !awayStatuses.includes(changes.status) && awayStatuses.includes(row.status) && !next.checkIn) {
        next.checkIn = officeStart;
        next.checkOut = officeEnd;
      }
      if (changes.checkIn !== undefined) next.status = lateness(next.checkIn, next.status);
      return next;
    }));
  }

  function everyonePresent() {
    setRows((current) => current.map((row) => (row.employeeId ? { ...row, status: "Present", checkIn: officeStart, checkOut: officeEnd } : row)));
  }

  function copyPreviousDay() {
    const source = previousDay(date);
    const saved = attendance.filter((item) => item.data.date === source && allEmployees.some((employee) => employee.id === item.data.employeeId));
    if (!saved.length) {
      toast.info(`No attendance saved for ${source} to copy.`);
      return;
    }
    const copied = saved.map((record, index) => ({ id: nextId + index, employeeId: record.data.employeeId ?? "", status: record.data.status || "Present", checkIn: record.data.checkIn || "", checkOut: record.data.checkOut || "", notes: "" }));
    const others = rows.filter((row) => row.employeeId && !copied.some((line) => line.employeeId === row.employeeId));
    setRows([...copied, ...others]);
    setNextId((current) => current + copied.length);
    toast.success(`Copied ${copied.length} ${copied.length === 1 ? "line" : "lines"} from ${source}. Review and save.`);
  }

  function addLines() {
    setRows((current) => [...current, ...Array.from({ length: 5 }, (_, index) => blankRow(nextId + index))]);
    setNextId((current) => current + 5);
  }

  function clearLines() {
    setRows(Array.from({ length: 5 }, (_, index) => blankRow(nextId + index)));
    setNextId((current) => current + 5);
    setError("");
  }

  function copyLine(id: number) {
    setRows((current) => current.flatMap((row) => (row.id === id ? [row, { ...row, id: nextId, employeeId: "" }] : [row])));
    setNextId((current) => current + 1);
  }

  function removeLine(id: number) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : [blankRow(nextId)]));
    setNextId((current) => current + 1);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filled = rows.filter((row) => row.employeeId);
    if (!filled.length) {
      setError("Choose at least one employee.");
      return;
    }
    const chosen = filled.map((row) => row.employeeId);
    const duplicate = chosen.find((id, index) => chosen.indexOf(id) !== index);
    if (duplicate) {
      setError(`${allEmployees.find((employee) => employee.id === duplicate)?.data.name || "An employee"} is on the sheet twice.`);
      return;
    }
    const badTime = filled.find((row) => (row.checkIn && minutes(row.checkIn) === null) || (row.checkOut && minutes(row.checkOut) === null));
    if (badTime) {
      setError(`Enter times like 09:00 for ${allEmployees.find((employee) => employee.id === badTime.employeeId)?.data.name || "every line"}.`);
      return;
    }
    setSaving(true);
    try {
      const saved = await markAttendance(date, filled.map(({ employeeId, status, checkIn, checkOut, notes }) => ({ employeeId, status, checkIn, checkOut, notes })));
      context.upsert(saved);
      toast.success(`Attendance saved for ${saved.length} ${saved.length === 1 ? "employee" : "employees"}.`);
      onOpenChange(false);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  const counted = rows.filter((row) => row.employeeId);
  const countOf = (status: string) => counted.filter((row) => row.status === status).length;
  const totalHours = counted.reduce((sum, row) => sum + (hoursBetween(row.checkIn, row.checkOut) ?? 0), 0);
  const employeeOf = (id: string) => allEmployees.find((employee) => employee.id === id) as BookkeepingRecord | undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(1300px,calc(100vw-3rem))]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">Attendance sheet</DialogTitle>
          <DialogDescription>One line per employee for the day. Approved leave and holidays are filled in for you, check-ins after office start plus grace are marked Late, and hours work out as you type. Saving updates anyone already marked that day.</DialogDescription>
        </DialogHeader>

        <form id="attendance-sheet-form" onSubmit={submit} className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="attendance-date">Date <span className="text-destructive">*</span></Label>
              <Input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attendance-start">Office starts</Label>
              <Input id="attendance-start" type="time" value={officeStart} onChange={(event) => setOfficeStart(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attendance-end">Office ends</Label>
              <Input id="attendance-end" type="time" value={officeEnd} onChange={(event) => setOfficeEnd(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attendance-grace">Late after (minutes)</Label>
              <Input id="attendance-grace" type="number" min="0" max="240" step="1" value={graceMinutes} onChange={(event) => setGraceMinutes(event.target.value)} />
            </div>
          </div>

          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  <th className="sticky left-0 z-10 w-8 min-w-8 bg-card" aria-label="Reorder" />
                  <th className={`sticky left-8 z-10 w-9 min-w-9 bg-card py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                  <th className={`sticky left-[4.25rem] z-10 min-w-52 bg-card px-2.5 py-2.5 text-left ${cellBorder}`}>Employee</th>
                  <th className={`w-28 px-2.5 py-2.5 text-left ${cellBorder}`}>Employee ID</th>
                  <th className={`w-36 px-2.5 py-2.5 text-left ${cellBorder}`}>Designation</th>
                  <th className={`w-36 px-2.5 py-2.5 text-left ${cellBorder}`}>Status</th>
                  <th className={`w-32 px-2.5 py-2.5 text-left ${cellBorder}`}>Check in</th>
                  <th className={`w-32 px-2.5 py-2.5 text-left ${cellBorder}`}>Check out</th>
                  <th className={`w-24 bg-muted/40 px-2.5 py-2.5 text-right ${cellBorder}`}>Hours</th>
                  <th className={`min-w-56 px-2.5 py-2.5 text-left ${cellBorder}`}>Notes</th>
                  <th className="w-20"><span className="sr-only">Line actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const employee = employeeOf(row.employeeId);
                  const away = awayStatuses.includes(row.status);
                  const hours = hoursBetween(row.checkIn, row.checkOut);
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
                        <Select value={row.employeeId || null} onValueChange={(value) => updateRow(row.id, { employeeId: value ?? "" })}>
                          <SelectTrigger className={`${cellInput} !h-11 justify-between [&_svg]:opacity-0 group-hover:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100`} aria-label={`Employee for line ${index + 1}`}>
                            <SelectValue placeholder={employees.length ? "" : "Add employees first"}>{employee?.data.name}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>{employees.map((item) => <SelectItem key={item.id} value={item.id}>{item.data.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className={`px-2.5 text-muted-foreground ${cellBorder}`}>{employee?.data.employeeId || ""}</td>
                      <td className={`px-2.5 text-muted-foreground ${cellBorder}`}>{employee?.data.designation || ""}</td>
                      <td className={`p-0 ${cellBorder}`}>
                        <Select value={row.status} onValueChange={(value) => updateRow(row.id, { status: String(value ?? "Present") })}>
                          <SelectTrigger className={`${cellInput} !h-11 justify-between`} aria-label={`Status for line ${index + 1}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{attendanceStatuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className={`p-0 ${cellBorder}`}><Input type="time" aria-label={`Check in for line ${index + 1}`} value={row.checkIn} disabled={away} onChange={(event) => updateRow(row.id, { checkIn: event.target.value })} className={`${cellInput} tabular-nums`} /></td>
                      <td className={`p-0 ${cellBorder}`}><Input type="time" aria-label={`Check out for line ${index + 1}`} value={row.checkOut} disabled={away} onChange={(event) => updateRow(row.id, { checkOut: event.target.value })} className={`${cellInput} tabular-nums`} /></td>
                      <td className={`bg-muted/40 px-2.5 text-right tabular-nums ${cellBorder}`}>{row.employeeId && hours !== null ? hours.toFixed(2) : ""}</td>
                      <td className={`p-0 ${cellBorder}`}><Input aria-label={`Notes for line ${index + 1}`} value={row.notes} maxLength={500} onChange={(event) => updateRow(row.id, { notes: event.target.value })} className={cellInput} /></td>
                      <td className="px-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy line ${index + 1}`} title="Copy times to a new line" onClick={() => copyLine(row.id)} disabled={saving}><Copy size={14} /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove line ${index + 1}`} title="Remove line" onClick={() => removeLine(row.id)} disabled={saving}><Trash2 size={14} /></Button>
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
                  <td colSpan={6} className={`px-2.5 py-3 text-right ${cellBorder}`}>
                    <span className="font-normal text-muted-foreground">{counted.length} employees · Present {countOf("Present")} · Late {countOf("Late")} · Half day {countOf("Half day")} · Absent {countOf("Absent")} · On leave {countOf("On leave")}</span>
                    <span className="ml-4">Total</span>
                  </td>
                  <td className={`bg-muted/40 px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{totalHours.toFixed(2)}</td>
                  <td className={cellBorder} />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLines} disabled={saving}><Plus size={14} />Add lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearLines} disabled={saving}>Clear all lines</Button>
            <Button type="button" variant="outline" size="sm" onClick={everyonePresent} disabled={saving}><CalendarCheck size={14} />Everyone present</Button>
            <Button type="button" variant="outline" size="sm" onClick={copyPreviousDay} disabled={saving} title="Fill the sheet with the previous day’s attendance"><Copy size={14} />Copy previous day</Button>
          </div>
          {!employees.length ? <p className="text-sm text-muted-foreground">Add your staff on the Employees page first, then pick them here.</p> : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        </form>

        <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="attendance-sheet-form" disabled={saving || !employees.length}>{saving ? "Saving…" : "Save attendance"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
