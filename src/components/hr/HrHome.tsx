import Link from "next/link";
import { Banknote, BriefcaseBusiness, CalendarDays, Check, Clock, FileWarning, HandCoins, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMoney, StatusBadge, type CrmStore } from "@/components/crm/crm-shared";

function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href ? <Link href={href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">View all</Link> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export default function HrHome({ store, currency, asOfDate }: { store: CrmStore; currency: string; asOfDate: string }) {
  const employees = (store.employees ?? []).filter((employee) => employee.data.status !== "Inactive");
  const attendanceToday = (store["hr-attendance"] ?? []).filter((row) => row.data.date === asOfDate);
  const present = attendanceToday.filter((row) => ["Present", "Late", "Half day"].includes(row.data.status ?? "")).length;
  const leaves = store["hr-leaves"] ?? [];
  const onLeave = leaves.filter((leave) => leave.data.status === "Approved" && leave.data.fromDate <= asOfDate && leave.data.toDate >= asOfDate);
  const pendingLeaves = leaves.filter((leave) => leave.data.status === "Pending");
  const pendingLoans = (store["hr-loans"] ?? []).filter((loan) => loan.data.status === "Requested");
  const pendingClaims = (store["hr-claims"] ?? []).filter((claim) => claim.data.status === "Submitted");
  const loanBalance = (store["hr-loans"] ?? []).filter((loan) => loan.data.status === "Approved").reduce((sum, loan) => sum + Number(loan.data.balance || 0), 0);
  const expiring = (store["hr-documents"] ?? []).filter((doc) => doc.data.expiryDate && doc.data.expiryDate <= addDays(asOfDate, 30)).sort((a, b) => a.data.expiryDate.localeCompare(b.data.expiryDate));
  const holidays = (store["hr-holidays"] ?? []).filter((holiday) => (holiday.data.date ?? "") >= asOfDate).sort((a, b) => a.data.date.localeCompare(b.data.date)).slice(0, 6);
  const openJobs = (store["hr-jobs"] ?? []).filter((job) => job.data.status === "Open");
  const candidates = store["hr-candidates"] ?? [];
  const stages = ["Applied", "Screening", "Interview", "Offer", "Hired"].map((stage) => ({ stage, count: candidates.filter((candidate) => candidate.data.stage === stage).length }));
  const maxStage = Math.max(1, ...stages.map((item) => item.count));
  const departments = Object.entries(employees.reduce<Record<string, number>>((counts, employee) => {
    const name = employee.data.department || "No department";
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);
  const maxDept = Math.max(1, ...departments.map(([, count]) => count));
  const joiners = employees.filter((employee) => (employee.data.joiningDate ?? "").startsWith(asOfDate.slice(0, 7)));
  const waiting = [...pendingLeaves.map((row) => ({ row, kind: "Leave", href: "/app/hr/leave-requests", text: `${row.data.leaveType} · ${row.data.fromDate} → ${row.data.toDate} (${row.data.days} days)` })),
    ...pendingLoans.map((row) => ({ row, kind: "Loan", href: "/app/hr/loans", text: `${row.data.loanType} · ${formatMoney(row.data.amount, currency)}` })),
    ...pendingClaims.map((row) => ({ row, kind: "Claim", href: "/app/hr/expense-claims", text: `${row.data.category} · ${formatMoney(row.data.amount, currency)}` }))];

  const month = asOfDate.slice(0, 7);
  const monthName = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthPayroll = (store.payroll ?? []).filter((row) => row.data.month === month);
  const paidCount = monthPayroll.filter((row) => row.data.status === "Paid").length;
  const markedDays = new Set((store["hr-attendance"] ?? []).filter((row) => (row.data.date ?? "").startsWith(month)).map((row) => row.data.date)).size;
  const unpaidLeaveDays = leaves
    .filter((leave) => leave.data.status === "Approved" && leave.data.paid === "false" && (leave.data.fromDate ?? "").startsWith(month))
    .reduce((sum, leave) => sum + Number(leave.data.days || 0), 0);
  const activeLoans = (store["hr-loans"] ?? []).filter((loan) => loan.data.status === "Approved" && (!loan.data.startMonth || loan.data.startMonth <= month)).length;
  const payrollGross = monthPayroll.length
    ? monthPayroll.reduce((sum, row) => sum + Number(row.data.grossSalary || 0), 0)
    : employees.reduce((sum, employee) => sum + Number(employee.data.baseSalary || 0), 0);
  const payrollDeductions = monthPayroll.reduce((sum, row) => sum + Number(row.data.totalDeductions || 0), 0);
  const payrollNet = monthPayroll.reduce((sum, row) => sum + Number(row.data.payableSalary || 0), 0);
  const sheetReady = monthPayroll.length > 0 && monthPayroll.length >= employees.length;
  const allPaid = monthPayroll.length > 0 && paidCount === monthPayroll.length;
  const steps = [
    { title: "Attendance", note: markedDays ? `${markedDays} ${markedDays === 1 ? "day" : "days"} marked this month` : "No days marked yet", done: markedDays > 0, current: false },
    { title: "Leave & loans", note: `${unpaidLeaveDays} unpaid leave ${unpaidLeaveDays === 1 ? "day" : "days"} · ${activeLoans} loan ${activeLoans === 1 ? "installment" : "installments"}`, done: pendingLeaves.length === 0 && pendingLoans.length === 0, current: false },
    { title: "Salary sheet", note: monthPayroll.length ? `${monthPayroll.length} of ${employees.length} prepared` : "Not prepared yet", done: sheetReady, current: !sheetReady },
    { title: "Pay & payslips", note: monthPayroll.length ? `${paidCount} of ${monthPayroll.length} paid` : "Waiting for the salary sheet", done: allPaid, current: sheetReady && !allPaid },
  ];
  const nextStep = !sheetReady
    ? { label: monthPayroll.length ? "Continue salary sheet" : "Prepare salary sheet", href: "/app/payroll?new=1" }
    : !allPaid ? { label: "Pay salaries", href: "/app/payroll" } : { label: "View payslips", href: "/app/payroll" };

  const kpis = [
    { label: "Active employees", value: String(employees.length), note: joiners.length ? `${joiners.length} joined this month` : "No new joiners this month", icon: Users },
    { label: "Present today", value: attendanceToday.length ? `${present} / ${employees.length}` : "—", note: attendanceToday.length ? `${attendanceToday.length} marked` : "Not marked yet", icon: Clock },
    { label: "On leave today", value: String(onLeave.length), note: `${pendingLeaves.length} requests waiting`, icon: CalendarDays },
    { label: "Loans outstanding", value: formatMoney(loanBalance, currency), note: `${pendingLoans.length} requests waiting`, icon: HandCoins },
    { label: "Open jobs", value: String(openJobs.length), note: `${candidates.filter((candidate) => !["Hired", "Rejected", "Withdrawn"].includes(candidate.data.stage ?? "")).length} candidates in progress`, icon: BriefcaseBusiness },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">HR / Home</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">People</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Today&apos;s attendance, who is away, this month&apos;s payroll, what is waiting for approval, and your hiring at a glance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href="/app/hr/attendance" />}><Clock size={15} />Attendance</Button>
          <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href="/app/hr/leave-requests?new=1" />}><Plus size={15} />Leave</Button>
          <Button variant="outline" className="gap-2 border-primary text-primary" nativeButton={false} render={<Link href="/app/payroll" />}><Banknote size={15} />Run payroll</Button>
          <Button className="gap-2" nativeButton={false} render={<Link href="/app/employees?new=1" />}><Plus size={15} />Add employee</Button>
        </div>
      </header>

      <section aria-labelledby="payroll-month" className="mt-6 overflow-hidden rounded-lg border border-primary bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/5 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">Payroll</p>
            <h2 id="payroll-month" className="mt-0.5 text-lg font-semibold">{monthName} salaries</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/app/payroll" />}>Open salary register</Button>
            <Button nativeButton={false} render={<Link href={nextStep.href} />}>{nextStep.label}</Button>
          </div>
        </div>
        <ol className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-2.5">
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${step.done ? "bg-accent text-accent-foreground" : step.current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {step.done ? <Check size={14} aria-label="Done" /> : index + 1}
              </span>
              <div><p className="text-sm font-semibold">{step.title}</p><p className="text-xs text-muted-foreground">{step.note}</p></div>
            </li>
          ))}
        </ol>
        <div className="grid border-t border-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Employees on payroll", String(employees.length)],
            [monthPayroll.length ? "Gross" : "Gross (estimate)", formatMoney(payrollGross, currency)],
            ["Tax & deductions", monthPayroll.length ? formatMoney(payrollDeductions, currency) : "—"],
            ["Net payable", monthPayroll.length ? formatMoney(payrollNet, currency) : "—"],
          ].map(([label, value], index) => (
            <div key={label} className={`px-5 py-3.5 ${index ? "border-t border-border sm:border-t-0 sm:border-l" : ""}`}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${label === "Net payable" ? "text-primary" : ""}`}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
            <div className="flex items-center justify-between gap-2 text-muted-foreground"><p className="text-xs">{kpi.label}</p><kpi.icon size={15} /></div>
            <p className="mt-1.5 text-xl font-semibold tabular-nums">{kpi.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.note}</p>
          </div>
        ))}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Waiting for approval">
          {waiting.length ? (
            <ul className="divide-y divide-border">
              {waiting.slice(0, 10).map(({ row, kind, href, text }) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`${href}?open=${row.id}`} className="font-medium hover:underline">{row.data.employee}</Link>
                    <p className="truncate text-xs text-muted-foreground">{kind}: {text}</p>
                  </div>
                  <StatusBadge value={row.data.status} />
                </li>
              ))}
            </ul>
          ) : <Empty text="Nothing is waiting for approval." />}
        </Panel>

        <Panel title="Away today" href="/app/hr/leave-requests">
          {onLeave.length ? (
            <ul className="divide-y divide-border">
              {onLeave.map((leave) => (
                <li key={leave.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-medium">{leave.data.employee}</span>
                  <span className="text-xs text-muted-foreground">{leave.data.leaveType} · until {leave.data.toDate}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="Everyone is in today." />}
        </Panel>

        <Panel title="Headcount by department" href="/app/hr/departments">
          {departments.length ? (
            <ul className="space-y-3">
              {departments.map(([name, count]) => (
                <li key={name}>
                  <div className="flex items-center justify-between text-sm"><span>{name}</span><span className="tabular-nums">{count}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(count / maxDept) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No employees yet." />}
        </Panel>

        <Panel title="Hiring pipeline" href="/app/hr/candidates">
          {candidates.length ? (
            <ul className="space-y-3">
              {stages.map((item) => (
                <li key={item.stage}>
                  <div className="flex items-center justify-between text-sm"><span>{item.stage}</span><span className="tabular-nums">{item.count}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-chart-2" style={{ width: `${(item.count / maxStage) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty text="No candidates yet." />}
        </Panel>

        <Panel title="Documents expiring within 30 days" href="/app/hr/documents">
          {expiring.length ? (
            <ul className="divide-y divide-border">
              {expiring.slice(0, 8).map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><p className="font-medium">{doc.data.employee}</p><p className="truncate text-xs text-muted-foreground">{doc.data.documentType} · {doc.data.documentName}</p></div>
                  <span className={`flex shrink-0 items-center gap-1 text-xs ${doc.data.expiryDate < asOfDate ? "font-medium text-destructive" : "text-muted-foreground"}`}><FileWarning size={13} />{doc.data.expiryDate < asOfDate ? "Expired " : ""}{doc.data.expiryDate}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="No documents expire in the next 30 days." />}
        </Panel>

        <Panel title="Upcoming holidays" href="/app/hr/holidays">
          {holidays.length ? (
            <ul className="divide-y divide-border">
              {holidays.map((holiday) => (
                <li key={holiday.id} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{holiday.data.holidayName}</span><span className="text-xs tabular-nums text-muted-foreground">{holiday.data.date}</span></li>
              ))}
            </ul>
          ) : <Empty text="No holidays added. Add this year's public holidays in HR → Holidays." />}
        </Panel>
      </div>
    </div>
  );
}
