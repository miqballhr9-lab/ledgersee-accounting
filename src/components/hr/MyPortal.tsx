"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Clock, FileText, HandCoins, LogIn, LogOut, ReceiptText, Wallet } from "lucide-react";

import { getAttachmentUploadTarget } from "@/app/actions";
import { selfCheck, selfRequest, type MyPortal as Portal } from "@/app/hr-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorText, formatMoney, StatusBadge, today } from "@/components/crm/crm-shared";

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
    setForm(kind === "hr-leaves" ? { fromDate: today(), toDate: today(), leaveTypeId: portal.leaveTypes[0]?.id ?? "" } : kind === "hr-loans" ? { loanType: "Salary advance", installments: "3" } : { date: today(), category: "Travel" });
    setRequest(kind);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      setForm((current) => ({ ...current, receipt: target.publicUrl, receiptName: file.name }));
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
  const todayRow = portal.attendance.find((row) => row.data.date === today());

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">My portal / {portal.business}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Hello, {name.split(" ")[0]}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{employee.designation || "Employee"}{employee.department ? ` · ${employee.department}` : ""} · {employee.employeeId}</p>
        </div>
        {canRequest ? (
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" disabled={Boolean(busy) || Boolean(todayRow?.data.checkIn)} onClick={() => void act("in", () => selfCheck("in"), "Checked in. Have a good day.")}><LogIn size={15} />{todayRow?.data.checkIn ? `Checked in ${todayRow.data.checkIn}` : "Check in"}</Button>
            <Button variant="outline" className="gap-2" disabled={Boolean(busy) || !todayRow?.data.checkIn || Boolean(todayRow?.data.checkOut)} onClick={() => void act("out", () => selfCheck("out"), "Checked out.")}><LogOut size={15} />{todayRow?.data.checkOut ? `Checked out ${todayRow.data.checkOut}` : "Check out"}</Button>
          </div>
        ) : null}
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {portal.leaveTypes.map((type) => (
          <div key={type.id} className="rounded-lg border border-border bg-card px-4 py-3.5">
            <p className="text-xs text-muted-foreground">{type.name}{type.paid ? "" : " (unpaid)"}</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums">{type.allowance ? `${Math.max(0, type.allowance - type.used)} left` : `${type.used} taken`}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{type.used} of {type.allowance || "—"} days used this year</p>
          </div>
        ))}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="My time off" icon={CalendarDays} action={canRequest ? <Button size="sm" variant="outline" onClick={() => open("hr-leaves")}>New time off</Button> : undefined}>
          {portal.leaves.length ? (
            <ul className="divide-y divide-border">{portal.leaves.slice(0, 8).map((leave) => (
              <li key={leave.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-medium">{leave.data.leaveType}</p><p className="text-xs text-muted-foreground">{leave.data.fromDate} → {leave.data.toDate} · {leave.data.days} days</p></div><StatusBadge value={leave.data.status} /></li>
            ))}</ul>
          ) : <Empty text="No time off yet." />}
        </Card>

        <Card title="My payslips" icon={Wallet}>
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
        </Card>

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
