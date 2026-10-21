"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Award, Cake, CalendarDays, Clock, FileText, HandCoins, LogIn, LogOut, PartyPopper, ReceiptText, Wallet } from "lucide-react";
import { BusinessClock, InstallAppButton, currentLocation, useAutoRefresh } from "@/components/hr/employee-app";

import { selfCheck, selfRequest, type MyPortal as Portal } from "@/app/hr-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorText, formatMoney, StatusBadge } from "@/components/crm/crm-shared";
import { uploadFile } from "@/lib/upload-file";

type RequestKind = "hr-leaves" | "hr-loans" | "hr-claims";

function Card({ title, icon: Icon, action, children }: { title: string; icon: typeof Clock; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} className="text-primary" />{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-3 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function MyPortal({ portal, name, email, currency, canRequest }: { portal: Portal; name: string; email: string; currency: string; canRequest: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [request, setRequest] = useState<RequestKind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  // Approvals and changes made by HR show up without reloading.
  useAutoRefresh(60);

  async function act(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await work();
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  function open(kind: RequestKind) {
    setForm(kind === "hr-leaves" ? { fromDate: portal.today, toDate: portal.today, leaveTypeId: portal.leaveTypes[0]?.id ?? "" } : kind === "hr-loans" ? { loanType: "Salary advance", installments: "3" } : { date: portal.today, category: "Travel" });
    setRequest(kind);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    try {
      const uploadedUrl = await uploadFile(file);
            setForm((current) => ({ ...current, receipt: uploadedUrl, receiptName: file.name }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  if (!portal.employee) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">Your HR portal isn’t set up yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ask HR in {portal.business} to add your email ({email}) to your employee profile. Then your attendance, time off, payslips and requests appear here.</p>
      </div>
    );
  }

  const employee = portal.employee.data;
  const now = portal.attendanceNow;
  const leaveLeft = (type: Portal["leaveTypes"][number]) => (type.allowance === null ? null : Math.max(0, type.allowance - type.used));
  const chosenType = portal.leaveTypes.find((type) => type.id === form.leaveTypeId);

  /** Checks in or out, sending where the phone is when the employee allows it. */
  async function check(direction: "in" | "out") {
    const location = await currentLocation();
    await act(direction, () => selfCheck(direction, location ?? undefined), direction === "in" ? "Checked in. Have a good day." : "Checked out. See you next time.");
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-5 pb-24 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">My portal / {portal.business}</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight sm:text-3xl">Hello, {name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{employee.designation || "Employee"}{employee.department ? ` · ${employee.department}` : ""}{employee.employeeId ? ` · ID ${employee.employeeId}` : ""}</p>
        </div>
        <InstallAppButton />
      </header>

      <section id="check-in" className="mt-5 scroll-mt-4 rounded-xl border border-border bg-card p-5 text-center shadow-sm">
        <BusinessClock timeZone={portal.timeZone} />
        <p className="mt-3 text-sm">
          {now.open
            ? <>Checked in since <strong>{now.since}</strong>{now.date !== portal.today ? " (yesterday)" : ""}</>
            : now.sessions.length ? <>Checked out at <strong>{now.sessions[now.sessions.length - 1].out}</strong>{now.hours ? ` · ${now.hours} h today` : ""}</> : <span className="text-muted-foreground">Not checked in today.</span>}
        </p>
        {canRequest ? (
          now.open
            ? <Button size="lg" className="mt-4 h-14 w-full max-w-sm gap-2 bg-amber-500 text-base text-white hover:bg-amber-600" disabled={Boolean(busy)} onClick={() => void check("out")}><LogOut size={18} />{busy === "out" ? "Checking out…" : "Check out"}</Button>
            : <Button size="lg" className="mt-4 h-14 w-full max-w-sm gap-2 text-base" disabled={Boolean(busy)} onClick={() => void check("in")}><LogIn size={18} />{busy === "in" ? "Checking in…" : now.sessions.length ? "Check in again" : "Check in"}</Button>
        ) : null}
        {now.sessions.length > 1 ? <p className="mt-3 text-xs text-muted-foreground">Today: {now.sessions.map((session) => `${session.in}–${session.out || "…"}`).join(", ")}</p> : null}
        <p className="mt-2 text-[11px] text-muted-foreground">Times are in {portal.timeZone.replace(/_/g, " ")}. Your location is saved with each check in if you allow it.</p>
      </section>

      <section id="time-off" className="mt-4 scroll-mt-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={15} className="text-primary" />My time off balance ({portal.today.slice(0, 4)})</h2>
          {canRequest ? <Button size="sm" onClick={() => open("hr-leaves")}>Request time off</Button> : null}
        </div>
        {portal.leaveTypes.length ? (
          <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {portal.leaveTypes.map((type) => {
              const left = leaveLeft(type);
              return (
                <li key={type.id} className="bg-card px-4 py-3">
                  <p className="text-sm font-medium">{type.name}{type.paid ? "" : " (unpaid)"}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{left === null ? "No limit" : <>{left} <span className="text-sm font-normal text-muted-foreground">days left</span></>}</p>
                  <p className="text-xs text-muted-foreground">{type.used} used{type.allowance !== null ? ` of ${type.allowance}` : ""}{type.pending ? ` · ${type.pending} waiting for approval` : ""}</p>
                  {type.allowance ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (type.used / type.allowance) * 100)}%` }} /></div> : null}
                </li>
              );
            })}
          </ul>
        ) : <Empty text="HR hasn't set up time off types yet." />}
      </section>

      <section id="celebrations" className="mt-4 scroll-mt-4 rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><PartyPopper size={15} className="text-primary" />Birthdays & work anniversaries</h2></div>
        {portal.celebrations.length ? (
          <ul className="divide-y divide-border">
            {portal.celebrations.slice(0, 12).map((item) => (
              <li key={`${item.employeeId}-${item.kind}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full ${item.kind === "Birthday" ? "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>{item.kind === "Birthday" ? <Cake size={15} /> : <Award size={15} />}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.employeeId === portal.employee?.id ? "You" : item.name}</span><span className="block text-xs text-muted-foreground">{item.kind === "Birthday" ? "Birthday" : `${item.years} ${item.years === 1 ? "year" : "years"} with the company`}</span></span>
                </span>
                <span className={`shrink-0 text-xs ${item.daysAway === 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>{item.daysAway === 0 ? "Today 🎉" : item.daysAway === 1 ? "Tomorrow" : new Date(`${item.date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}</span>
              </li>
            ))}
          </ul>
        ) : <Empty text="None in the next 30 days." />}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="My time off requests" icon={CalendarDays} action={canRequest ? <Button size="sm" variant="outline" onClick={() => open("hr-leaves")}>New time off</Button> : undefined}>
          {portal.leaves.length ? (
            <ul className="divide-y divide-border">{portal.leaves.slice(0, 8).map((leave) => (
              <li key={leave.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-medium">{leave.data.leaveType}</p><p className="text-xs text-muted-foreground">{leave.data.fromDate} → {leave.data.toDate} · {leave.data.days} days</p></div><StatusBadge value={leave.data.status} /></li>
            ))}</ul>
          ) : <Empty text="No time off yet." />}
        </Card>

        <div id="payslips" className="scroll-mt-4"><Card title="My payslips" icon={Wallet}>
          {portal.payslips.length ? (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-1.5">Month</th><th className="px-4 py-1.5">Gross</th><th className="px-4 py-1.5">Deductions</th><th className="px-4 py-1.5">Net pay</th><th className="px-4 py-1.5">Status</th></tr></thead>
                <tbody>{portal.payslips.slice(0, 12).map((slip) => (
                  <tr key={slip.id} className="border-t border-border"><td className="px-4 py-2">{slip.data.month}</td><td className="px-4 py-2 tabular-nums">{formatMoney(slip.data.grossSalary, currency)}</td><td className="px-4 py-2 tabular-nums">{formatMoney(slip.data.totalDeductions, currency)}</td><td className="px-4 py-2 font-medium tabular-nums">{formatMoney(slip.data.payableSalary, currency)}</td><td className="px-4 py-2"><StatusBadge value={slip.data.status || "Unpaid"} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty text="No payslips yet." />}
        </Card></div>

        <Card title="My attendance" icon={Clock}>
          {portal.attendance.length ? (
            <ul className="divide-y divide-border">{portal.attendance.slice(0, 10).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2"><span className="tabular-nums">{row.data.date}</span><span className="text-xs text-muted-foreground">{row.data.checkIn || "—"} → {row.data.checkOut || "—"}{row.data.hoursWorked ? ` · ${row.data.hoursWorked} h` : ""}</span><StatusBadge value={row.data.status} /></li>
            ))}</ul>
          ) : <Empty text="No attendance yet." />}
        </Card>

        <Card title="My salary attachments" icon={HandCoins} action={canRequest ? <Button size="sm" variant="outline" onClick={() => open("hr-loans")}>Request</Button> : undefined}>
          {portal.loans.length ? (
            <ul className="divide-y divide-border">{portal.loans.map((loan) => (
              <li key={loan.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-medium">{loan.data.loanType} · {formatMoney(loan.data.amount, currency)}</p><p className="text-xs text-muted-foreground">{formatMoney(loan.data.monthlyInstallment, currency)} a month · remaining {formatMoney(loan.data.balance, currency)}</p></div><StatusBadge value={loan.data.status} /></li>
            ))}</ul>
          ) : <Empty text="No salary attachments." />}
        </Card>

        <Card title="My expenses" icon={ReceiptText} action={canRequest ? <Button size="sm" variant="outline" onClick={() => open("hr-claims")}>New expense</Button> : undefined}>
          {portal.claims.length ? (
            <ul className="divide-y divide-border">{portal.claims.slice(0, 8).map((claim) => (
              <li key={claim.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-medium">{claim.data.description}</p><p className="text-xs text-muted-foreground">{claim.data.date} · {claim.data.category} · {formatMoney(claim.data.amount, currency)}</p></div><StatusBadge value={claim.data.status} /></li>
            ))}</ul>
          ) : <Empty text="No expenses yet." />}
        </Card>

        <Card title="My documents & holidays" icon={FileText}>
          {portal.documents.length ? (
            <ul className="mb-3 divide-y divide-border">{portal.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 py-2"><span>{doc.data.documentType}: {doc.data.file ? <a className="text-primary underline-offset-4 hover:underline" href={doc.data.file} target="_blank" rel="noreferrer">{doc.data.documentName}</a> : doc.data.documentName}</span><span className="text-xs text-muted-foreground">{doc.data.expiryDate ? `Expires ${doc.data.expiryDate}` : ""}</span></li>
            ))}</ul>
          ) : null}
          {portal.holidays.length ? (
            <ul className="divide-y divide-border">{portal.holidays.map((holiday) => (
              <li key={holiday.id} className="flex items-center justify-between gap-3 py-2"><span>{holiday.data.holidayName}</span><span className="text-xs tabular-nums text-muted-foreground">{holiday.data.date}</span></li>
            ))}</ul>
          ) : <Empty text="No upcoming holidays." />}
        </Card>
      </div>

      <nav aria-label="Employee app" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {[["#check-in", "Attendance", Clock], ["#time-off", "Time off", CalendarDays], ["#celebrations", "Events", PartyPopper], ["#payslips", "Payslips", Wallet]].map(([href, label, Icon]) => {
          const NavIcon = Icon as typeof Clock;
          return <a key={href as string} href={href as string} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground active:text-primary"><NavIcon size={18} />{label as string}</a>;
        })}
      </nav>

      <Dialog open={request !== null} onOpenChange={(next) => { if (!busy) setRequest(next ? request : null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{request === "hr-leaves" ? "New time off" : request === "hr-loans" ? "Ask for a loan or advance" : "New expense"}</DialogTitle>
            <DialogDescription>HR is notified in the app and approves or rejects it.</DialogDescription>
          </DialogHeader>
          <form id="self-request" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
            event.preventDefault();
            if (!request) return;
            void act("request", async () => { await selfRequest(request, form); setRequest(null); }, "Request sent.");
          }}>
            {request === "hr-leaves" ? (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="self-type">Time off type</Label>
                  <Select value={form.leaveTypeId || null} onValueChange={(value) => setForm({ ...form, leaveTypeId: String(value ?? "") })}>
                    <SelectTrigger id="self-type" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{portal.leaveTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="self-from">From</Label><Input id="self-from" type="date" value={form.fromDate ?? ""} onChange={(event) => setForm({ ...form, fromDate: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="self-to">To</Label><Input id="self-to" type="date" value={form.toDate ?? ""} onChange={(event) => setForm({ ...form, toDate: event.target.value })} /></div>
                {chosenType ? <p className="text-xs text-muted-foreground sm:col-span-2">{leaveLeft(chosenType) === null ? `${chosenType.name} has no limit.` : `You have ${leaveLeft(chosenType)} ${chosenType.name.toLowerCase()} days left this year${chosenType.pending ? ` (${chosenType.pending} more waiting for approval)` : ""}.`}</p> : null}
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={form.halfDay === "true"} onCheckedChange={(checked) => setForm({ ...form, halfDay: checked ? "true" : "false" })} />Half day</label>
              </>
            ) : null}
            {request === "hr-loans" ? (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="self-loan-type">Type</Label>
                  <Select value={form.loanType ?? "Salary advance"} onValueChange={(value) => setForm({ ...form, loanType: String(value ?? "Loan") })}>
                    <SelectTrigger id="self-loan-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Salary advance">Salary advance</SelectItem><SelectItem value="Loan">Loan</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="self-amount">Amount</Label><Input id="self-amount" type="number" min={1} value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="self-installments">Pay back over (months)</Label><Input id="self-installments" type="number" min={1} value={form.installments ?? ""} onChange={(event) => setForm({ ...form, installments: event.target.value })} /></div>
              </>
            ) : null}
            {request === "hr-claims" ? (
              <>
                <div className="space-y-1.5"><Label htmlFor="self-date">Date</Label><Input id="self-date" type="date" value={form.date ?? ""} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="self-category">Category</Label>
                  <Select value={form.category ?? "Travel"} onValueChange={(value) => setForm({ ...form, category: String(value ?? "Other") })}>
                    <SelectTrigger id="self-category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{["Travel", "Fuel", "Meals", "Accommodation", "Office supplies", "Mobile & internet", "Training", "Medical", "Other"].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="self-description">Description</Label><Input id="self-description" value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="self-claim-amount">Amount</Label><Input id="self-claim-amount" type="number" min={0} step="0.01" value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="self-receipt">Receipt</Label><Input id="self-receipt" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} />{form.receiptName ? <p className="text-xs text-muted-foreground">{form.receiptName}</p> : null}</div>
              </>
            ) : null}
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="self-reason">{request === "hr-claims" ? "Notes" : "Reason"}</Label><Textarea id="self-reason" rows={2} value={(request === "hr-claims" ? form.notes : form.reason) ?? ""} onChange={(event) => setForm({ ...form, [request === "hr-claims" ? "notes" : "reason"]: event.target.value })} /></div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setRequest(null)}>Cancel</Button>
            <Button type="submit" form="self-request" disabled={Boolean(busy)}>{busy === "request" ? "Sending…" : "Send request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
