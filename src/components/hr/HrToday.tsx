"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Award, Cake, CalendarDays, Clock, Smartphone } from "lucide-react";

import { addStandardLeaveTypes } from "@/app/hr-actions";
import { errorText } from "@/components/crm/crm-shared";
import { useAutoRefresh } from "@/components/hr/employee-app";
import { Button } from "@/components/ui/button";
import type { Celebration } from "@/lib/celebrations";

export interface HrTodayProps {
  today: string;
  checkedIn: Array<{ name: string; since: string; fromApp: boolean }>;
  employeeCount: number;
  onLeave: Array<{ name: string; type: string; to: string }>;
  celebrations: Celebration[];
  /** Standard time off types (maternity, paternity…) the business hasn't added yet. */
  missingLeaveTypes: string[];
  canManage: boolean;
}

/** HR's live view of today: who is in, who is off, and birthdays and anniversaries coming up. */
export default function HrToday({ today, checkedIn, employeeCount, onLeave, celebrations, missingLeaveTypes, canManage }: HrTodayProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  // Check ins and requests from the employee app appear without reloading.
  useAutoRefresh(30);

  async function addTypes() {
    setAdding(true);
    try {
      const added = await addStandardLeaveTypes();
      toast.success(added ? `Added ${added} time off ${added === 1 ? "type" : "types"}. Change the days in Time off types if your policy differs.` : "You already have them all.");
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setAdding(false);
    }
  }

  const panel = "rounded-xl border border-border bg-card/90 shadow-sm";
  return (
    <div className="mb-10 space-y-3">
      {canManage && missingLeaveTypes.length ? (
        <div className={`${panel} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
          <p className="text-sm"><span className="font-medium">Set up time off types:</span> <span className="text-muted-foreground">{missingLeaveTypes.join(", ")}.</span></p>
          <Button size="sm" disabled={adding} onClick={() => void addTypes()}>{adding ? "Adding…" : "Add standard types"}</Button>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <section className={panel}>
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><Clock size={15} className="text-primary" />In now · {checkedIn.length} of {employeeCount}</h2>
          {checkedIn.length ? (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto">
              {checkedIn.map((person) => (
                <li key={person.name} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="truncate">{person.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{person.fromApp ? <Smartphone size={12} aria-label="From the app" /> : null}since {person.since}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-muted-foreground">Nobody has checked in yet today.</p>}
          <Link href="/app/hr/attendances" className="block border-t border-border px-4 py-2 text-xs font-medium text-primary hover:underline">All attendances</Link>
        </section>
        <section className={panel}>
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><CalendarDays size={15} className="text-primary" />On time off today · {onLeave.length}</h2>
          {onLeave.length ? (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto">
              {onLeave.map((leave) => <li key={`${leave.name}-${leave.type}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm"><span className="truncate">{leave.name}</span><span className="shrink-0 text-xs text-muted-foreground">{leave.type} · back after {leave.to}</span></li>)}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-muted-foreground">Everyone is in.</p>}
          <Link href="/app/hr/my-time-off" className="block border-t border-border px-4 py-2 text-xs font-medium text-primary hover:underline">Time off</Link>
        </section>
        <section className={panel}>
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><Cake size={15} className="text-primary" />Birthdays & anniversaries</h2>
          {celebrations.length ? (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto">
              {celebrations.map((item) => (
                <li key={`${item.employeeId}-${item.kind}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">{item.kind === "Birthday" ? <Cake size={13} className="shrink-0 text-pink-600" /> : <Award size={13} className="shrink-0 text-amber-600" />}<span className="truncate">{item.name}{item.years ? ` · ${item.years} yr` : ""}</span></span>
                  <span className={`shrink-0 text-xs ${item.date === today ? "font-semibold text-primary" : "text-muted-foreground"}`}>{item.date === today ? "Today" : new Date(`${item.date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-muted-foreground">None in the next 30 days. Add dates of birth and joining dates on employee profiles.</p>}
        </section>
      </div>
    </div>
  );
}
