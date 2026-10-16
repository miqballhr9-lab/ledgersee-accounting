"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/crm/crm-shared";

export interface TimeOffBalance {
  typeId: string;
  name: string;
  allowance: number | null;
  used: number;
  planned: number;
}

export interface TimeOffEntry {
  id: string;
  employeeId: string;
  typeId: string;
  type: string;
  from: string;
  to: string;
  days: string;
  status: string;
}

interface Props {
  year: string;
  today: string;
  employees: { id: string; name: string }[];
  defaultEmployeeId: string;
  types: { id: string; name: string }[];
  balances: Record<string, TimeOffBalance[]>;
  leaves: TimeOffEntry[];
  holidays: { name: string; from: string; to: string }[];
}

const colours = ["#714B67", "#017E84", "#E46F78", "#21B799", "#E4A900", "#5B899E", "#8F5FD8"];
const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

function days(value: number) {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} ${value === 1 ? "day" : "days"}`;
}

function datesBetween(from: string, to: string) {
  const out: string[] = [];
  if (!from) return out;
  const end = to && to >= from ? to : from;
  const cursor = new Date(`${from}T12:00:00Z`);
  for (let guard = 0; guard < 400; guard += 1) {
    const text = cursor.toISOString().slice(0, 10);
    out.push(text);
    if (text >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Odoo Time Off dashboard: balance cards per type and the year's calendar of time off and public holidays. */
export default function TimeOffDashboard({ year, today, employees, defaultEmployeeId, types, balances, leaves, holidays }: Props) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const employee = employees.find((entry) => entry.id === employeeId);
  const colourOf = (typeId: string) => colours[Math.max(0, types.findIndex((type) => type.id === typeId)) % colours.length];
  const mine = leaves.filter((leave) => leave.employeeId === employeeId && !["Refused", "Cancelled"].includes(leave.status));
  const byDate = new Map<string, TimeOffEntry>();
  for (const leave of mine) for (const date of datesBetween(leave.from, leave.to)) if (!byDate.has(date) || leave.status === "Approved") byDate.set(date, leave);
  const holidayByDate = new Map<string, string>();
  for (const holiday of holidays) for (const date of datesBetween(holiday.from, holiday.to)) holidayByDate.set(date, holiday.name);
  const shownBalances = (balances[employeeId] ?? []).filter((balance) => balance.allowance !== null || balance.used > 0 || balance.planned > 0);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button className="gap-1.5" nativeButton={false} render={<Link href="/app/hr/time-off?new=1" />}><Plus size={15} />New</Button>
          <h1 className="text-lg font-semibold">My Time Off</h1>
        </div>
        {employees.length > 1 ? (
          <Select value={employeeId || null} onValueChange={(value) => setEmployeeId(String(value ?? ""))}>
            <SelectTrigger className="w-60" aria-label="Employee"><SelectValue>{employee?.name ?? "Choose an employee"}</SelectValue></SelectTrigger>
            <SelectContent>{employees.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </header>

      {!employee ? <p className="py-16 text-center text-sm text-muted-foreground">Add an employee to see their time off.</p> : (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Time off balances">
            {shownBalances.length ? shownBalances.map((balance) => {
              const left = balance.allowance === null ? null : balance.allowance - balance.used;
              return (
                <div key={balance.typeId} className="rounded-lg border border-border bg-card p-4" style={{ borderTop: `4px solid ${colourOf(balance.typeId)}` }}>
                  <p className="text-sm font-semibold">{balance.name}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums">{left === null ? days(balance.used) : Number.isInteger(left) ? left : left.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">{left === null ? `taken in ${year}` : `${left === 1 ? "day" : "days"} available`}</p>
                  {balance.allowance !== null ? <p className="mt-2 text-xs text-muted-foreground">{days(balance.used)} taken of {days(balance.allowance)}</p> : null}
                  {balance.planned ? <p className="text-xs font-medium text-[#E4A900]">{days(balance.planned)} to approve</p> : null}
                </div>
              );
            }) : <p className="col-span-full rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No time off types allocated yet. Add types in Time off types or give an allocation.</p>}
          </section>

          <section className="mt-6 rounded-lg border border-border bg-card p-4" aria-label={`${year} calendar`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{year}</h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {types.map((type) => <li key={type.id} className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: colourOf(type.id) }} />{type.name}</li>)}
                <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-dashed border-foreground/50" />To approve</li>
                <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-muted-foreground/25" />Public holiday</li>
              </ul>
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, month) => {
                const first = new Date(Date.UTC(Number(year), month, 1));
                const count = new Date(Date.UTC(Number(year), month + 1, 0)).getUTCDate();
                const offset = (first.getUTCDay() + 6) % 7;
                return (
                  <div key={month}>
                    <p className="mb-1.5 text-sm font-semibold">{first.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}</p>
                    <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
                      {weekdays.map((day, index) => <span key={index} className="py-0.5 font-medium text-muted-foreground">{day}</span>)}
                      {Array.from({ length: offset }, (_, index) => <span key={`pad-${index}`} />)}
                      {Array.from({ length: count }, (_, index) => {
                        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
                        const leave = byDate.get(date);
                        const holiday = holidayByDate.get(date);
                        const weekend = (offset + index) % 7 === 6;
                        const approved = leave?.status === "Approved";
                        return (
                          <span key={date} title={leave ? `${leave.type} · ${leave.status}` : holiday}
                            className={`rounded py-1 tabular-nums ${date === today ? "ring-2 ring-primary" : ""} ${leave ? (approved ? "font-semibold text-white" : "border border-dashed font-semibold") : holiday ? "bg-muted-foreground/25 font-medium" : weekend ? "text-muted-foreground/60" : ""}`}
                            style={leave ? (approved ? { background: colourOf(leave.typeId) } : { borderColor: colourOf(leave.typeId), color: colourOf(leave.typeId) }) : undefined}>
                            {index + 1}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Time off requests</h2>
            {mine.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Time off type</th><th className="px-4 py-2 font-medium">From</th><th className="px-4 py-2 font-medium">To</th><th className="px-4 py-2 text-right font-medium">Duration</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
                  <tbody>
                    {[...mine].sort((a, b) => b.from.localeCompare(a.from)).map((leave) => (
                      <tr key={leave.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2"><Link href={`/app/hr/time-off?open=${leave.id}`} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2.5 rounded-full" style={{ background: colourOf(leave.typeId) }} />{leave.type}</Link></td>
                        <td className="px-4 py-2 tabular-nums">{leave.from}</td>
                        <td className="px-4 py-2 tabular-nums">{leave.to}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{days(Number(leave.days || 0))}</td>
                        <td className="px-4 py-2"><StatusBadge value={leave.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="py-6 text-center text-sm text-muted-foreground">No time off requested yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}
