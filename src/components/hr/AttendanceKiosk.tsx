"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, LogIn, LogOut, Search } from "lucide-react";

import { kioskCheck, selfCheck } from "@/app/hr-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/components/crm/crm-shared";
import { BusinessClock, useAutoRefresh } from "@/components/hr/employee-app";

export interface KioskEmployee {
  id: string;
  name: string;
  job: string;
  department: string;
  checkIn: string;
  checkOut: string;
  hours: string;
  /** The employee set a kiosk PIN, asked for before checking in or out at the kiosk. */
  needsPin?: boolean;
}

const tones = ["bg-[#714B67]", "bg-[#017E84]", "bg-[#E46F78]", "bg-[#21B799]", "bg-[#5B899E]", "bg-[#E4A900]", "bg-[#8F5FD8]"];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function Avatar({ name, size = "size-12 text-base" }: { name: string; size?: string }) {
  const tone = tones[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length];
  return <span className={`grid shrink-0 place-items-center rounded-md font-semibold text-white ${tone} ${size}`}>{initials(name)}</span>;
}

const isIn = (employee: KioskEmployee) => Boolean(employee.checkIn && !employee.checkOut);

/** Odoo Attendances: check in/out for yourself, and kiosk mode where employees tap their name. */
export default function AttendanceKiosk({ business, employees, myEmployeeId, canKiosk, timeZone = "Asia/Karachi" }: { business: string; employees: KioskEmployee[]; myEmployeeId: string | null; canKiosk: boolean; timeZone?: string }) {
  const router = useRouter();
  // Check ins from phones and the kiosk show up here as they happen.
  useAutoRefresh(30);
  const [mode, setMode] = useState<"me" | "kiosk">(myEmployeeId || !canKiosk ? "me" : "kiosk");
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; direction: "in" | "out"; time: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const mine = employees.find((employee) => employee.id === myEmployeeId) ?? null;
  const picked = employees.find((employee) => employee.id === pickedId) ?? null;

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => { setDone(null); setPickedId(null); }, 4000);
    return () => window.clearTimeout(timer);
  }, [done]);

  async function check(employee: KioskEmployee, self: boolean) {
    const direction = isIn(employee) ? "out" : "in";
    setBusy(true);
    try {
      const time = self ? await selfCheck(direction) : await kioskCheck(employee.id, direction, pin);
      setPin("");
      setDone({ name: employee.name, direction, time });
      router.refresh();
    } catch (error) {
      toast.error(errorText(error), { position: "top-center" });
    } finally {
      setBusy(false);
    }
  }

  const term = search.trim().toLowerCase();
  const shown = employees.filter((employee) => !term || employee.name.toLowerCase().includes(term) || employee.department.toLowerCase().includes(term));

  function checkCard(employee: KioskEmployee, self: boolean) {
    const inside = isIn(employee);
    return (
      <div className="mx-auto w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <div className="flex justify-center"><Avatar name={employee.name} size="size-24 text-3xl" /></div>
        <h2 className="mt-4 text-2xl font-semibold">{inside ? "Want to check out" : employee.checkOut ? "Welcome back" : "Welcome"}, {employee.name}{inside ? "?" : "!"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{[employee.job, employee.department].filter(Boolean).join(" · ") || "Employee"}</p>
        {employee.checkIn ? <p className="mt-3 text-sm">Checked in at <strong>{employee.checkIn}</strong>{employee.checkOut ? <> · out at <strong>{employee.checkOut}</strong> · {employee.hours || "0"} h worked</> : null}</p> : <p className="mt-3 text-sm text-muted-foreground">Not checked in today.</p>}
        {employee.checkOut ? <p className="mt-2 text-xs text-muted-foreground">Back at work? Check in again; today&apos;s hours add up.</p> : null}
        {!self && employee.needsPin ? <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} aria-label="Your PIN" placeholder="Enter your PIN" value={pin} onChange={(event) => setPin(event.target.value)} className="mx-auto mt-6 max-w-40 text-center tracking-[0.4em]" /> : null}
        <Button type="button" disabled={busy || (!self && Boolean(employee.needsPin) && !pin)} onClick={() => check(employee, self)} className={`mt-6 h-auto w-full gap-3 py-5 text-lg text-white ${inside ? "bg-[#E4A900] hover:bg-[#c99500]" : "bg-[#21B799] hover:bg-[#1a9c82]"}`}>
          {inside ? <LogOut size={22} /> : <LogIn size={22} />}{inside ? "Check out" : "Check in"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/app/hr/attendances" className="text-primary hover:underline">Attendances</Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold">{mode === "kiosk" ? "Kiosk mode" : "Check in / out"}</span>
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          {myEmployeeId ? <Button type="button" size="sm" variant={mode === "me" ? "secondary" : "ghost"} onClick={() => { setMode("me"); setDone(null); }}>My attendance</Button> : null}
          {canKiosk ? <Button type="button" size="sm" variant={mode === "kiosk" ? "secondary" : "ghost"} onClick={() => { setMode("kiosk"); setDone(null); setPickedId(null); }}>Kiosk mode</Button> : null}
        </div>
      </header>

      <div className="mt-8 text-center"><BusinessClock timeZone={timeZone} /></div>

      <div className="mt-8">
        {done ? (
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center" role="status">
            <div className="flex justify-center"><Avatar name={done.name} size="size-20 text-2xl" /></div>
            <h2 className="mt-4 text-2xl font-semibold">{done.direction === "in" ? `Welcome ${done.name}!` : `Goodbye ${done.name}!`}</h2>
            <p className="mt-2 text-muted-foreground">{done.direction === "in" ? "Checked in" : "Checked out"}{done.time ? ` at ${done.time}` : ""}. {done.direction === "in" ? "Have a good day!" : "Have a nice evening!"}</p>
            <Button type="button" variant="outline" className="mt-6" onClick={() => { setDone(null); setPickedId(null); }}>OK</Button>
          </div>
        ) : mode === "me" ? (
          mine ? checkCard(mine, true) : (
            <p className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">Your email isn&apos;t linked to an employee. Add it as the work email on your employee to check in here.</p>
          )
        ) : picked ? (
          <div className="space-y-4">
            <div className="mx-auto max-w-md"><Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setPickedId(null)}><ArrowLeft size={14} />Back</Button></div>
            {checkCard(picked, false)}
          </div>
        ) : (
          <div>
            <div className="text-center">
              <h2 className="text-xl font-semibold">{business}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Welcome! Tap your name to check in or out.</p>
            </div>
            <div className="relative mx-auto mt-5 max-w-md">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees…" className="pl-9" aria-label="Search employees" />
            </div>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {shown.map((employee) => (
                <li key={employee.id}>
                  <button type="button" onClick={() => setPickedId(employee.id)} className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary hover:shadow-sm">
                    <Avatar name={employee.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{employee.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{employee.job || employee.department || "Employee"}</span>
                    </span>
                    <span className={`size-2.5 shrink-0 rounded-full ${isIn(employee) ? "bg-[#21B799]" : employee.checkOut ? "bg-muted-foreground/40" : "bg-[#E46F78]"}`} title={isIn(employee) ? "Checked in" : employee.checkOut ? "Checked out" : "Not checked in"} />
                  </button>
                </li>
              ))}
            </ul>
            {!shown.length ? <p className="mt-6 text-center text-sm text-muted-foreground">No employees found.</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
