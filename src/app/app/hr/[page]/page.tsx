import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import CrmWorkspace from "@/components/crm/CrmWorkspace";
import AttendanceKiosk from "@/components/hr/AttendanceKiosk";
import OrgChart from "@/components/hr/OrgChart";
import TimeOffDashboard, { type TimeOffBalance } from "@/components/hr/TimeOffDashboard";
import { requireUser } from "@/lib/auth";
import { hrModules, hrPages } from "@/lib/hr-config";
import { loadHrData } from "@/lib/hr-data";
import { leaveUsed, timeOffAllowance, type HrContext } from "@/lib/hr-rules";
import { isToApprove } from "@/lib/hr-status";
import { canWriteKind } from "@/lib/permissions";
import { requireFeature } from "@/lib/plan-gate";

interface HrPageProps {
  params: Promise<{ page: string }>;
  searchParams: Promise<{ open?: string; job?: string }>;
}

export async function generateMetadata({ params }: HrPageProps): Promise<Metadata> {
  const { page } = await params;
  const special: Record<string, string> = { "my-time-off": "My Time Off", "check-in": "Check in / out", "org-chart": "Org chart" };
  return { title: `${special[page] ?? hrModules.find((module) => module.key === page)?.plural ?? "HRM"} · HRM` };
}

/** Pages renamed to Odoo's names; old links still land in the right place. */
const renamed: Record<string, string> = {
  attendance: "attendances", "leave-requests": "time-off", "leave-types": "time-off-types", holidays: "public-holidays", loans: "salary-attachments",
  "expense-claims": "expenses", jobs: "job-positions", candidates: "applications", settlements: "departures",
};

export default async function HrSectionPage({ params, searchParams }: HrPageProps) {
  await requireFeature("hr");
  const { page } = await params;
  if (renamed[page]) redirect(`/app/hr/${renamed[page]}`);
  if (page === "my-time-off") return <MyTimeOffPage />;
  if (page === "check-in") return <CheckInPage />;
  if (page === "org-chart") {
    const { store } = await loadHrData();
    return <OrgChart people={activeEmployees(store).map((employee) => ({ id: employee.id, name: employee.data.name || "Employee", job: employee.data.designation ?? "", department: employee.data.department ?? "", manager: employee.data.manager ?? "", photo: employee.data.photo ?? "" }))} />;
  }
  if (!hrPages.includes(page)) notFound();
  const { open, job } = await searchParams;
  const { store, currency, me, owners, weekend, recruitmentStages } = await loadHrData();
  return <CrmWorkspace key={page} page={page} initialStore={store} currency={currency} me={me} owners={owners} weekend={weekend} recruitmentStages={recruitmentStages} openId={open} jobFilter={page === "applications" ? job : undefined} />;
}

const activeEmployees = (store: Awaited<ReturnType<typeof loadHrData>>["store"]) =>
  (store.employees ?? []).filter((employee) => employee.data.status !== "Inactive").sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));

/** Odoo's My Time Off: balances and the year's calendar, for you or (for HR) any employee. */
async function MyTimeOffPage() {
  const me = await requireUser();
  const { store, today, weekend } = await loadHrData();
  const year = today.slice(0, 4);
  const employees = activeEmployees(store);
  const email = me.email.trim().toLowerCase();
  const mine = employees.find((employee) => employee.data.email?.trim().toLowerCase() === email);
  // Only HR sees everyone's balances; anyone else sees their own.
  const shown = canWriteKind(me.role, "hr-leaves") ? employees : employees.filter((employee) => employee === mine);
  const rows = (kind: string) => (store[kind] ?? []) as unknown as ReturnType<HrContext["byKind"]>;
  const context: HrContext = { byKind: rows, actor: me.name };
  const types = (store["hr-leave-types"] ?? []).map((type) => ({ id: type.id, name: type.data.leaveName || "Time off" }));
  const leaves = store["hr-leaves"] ?? [];
  const balances: Record<string, TimeOffBalance[]> = {};
  for (const employee of shown) {
    balances[employee.id] = types.map((type) => {
      const data = { employeeId: employee.id, leaveTypeId: type.id };
      const planned = leaves.filter((leave) => leave.data.employeeId === employee.id && leave.data.leaveTypeId === type.id && isToApprove(leave.data.status) && (leave.data.fromDate ?? "").startsWith(year))
        .reduce((sum, leave) => sum + Number(leave.data.days || 0), 0);
      return { typeId: type.id, name: type.name, allowance: timeOffAllowance(context, data, year), used: leaveUsed(rows("hr-leaves"), data, year), planned };
    });
  }
  const ids = new Set(shown.map((employee) => employee.id));
  return (
    <TimeOffDashboard
      year={year}
      weekend={weekend}
      today={today}
      employees={shown.map((employee) => ({ id: employee.id, name: employee.data.name || "Employee" }))}
      defaultEmployeeId={mine && ids.has(mine.id) ? mine.id : shown[0]?.id ?? ""}
      types={types}
      balances={balances}
      leaves={leaves.filter((leave) => ids.has(leave.data.employeeId ?? "")).map((leave) => ({
        id: leave.id, employeeId: leave.data.employeeId ?? "", typeId: leave.data.leaveTypeId ?? "", type: leave.data.leaveType || "Time off",
        from: leave.data.fromDate ?? "", to: leave.data.toDate ?? "", days: leave.data.days ?? "", status: leave.data.status ?? "",
      }))}
      holidays={(store["hr-holidays"] ?? []).map((holiday) => ({ name: holiday.data.holidayName ?? "", from: holiday.data.date ?? "", to: holiday.data.endDate ?? "" }))}
    />
  );
}

/** Odoo Attendances' check in/out screen, with kiosk mode for HR. */
async function CheckInPage() {
  const me = await requireUser();
  const { store, today, timeZone: settingsTimeZone } = await loadHrData();
  const employees = activeEmployees(store);
  const email = me.email.trim().toLowerCase();
  const mine = employees.find((employee) => employee.data.email?.trim().toLowerCase() === email);
  const canKiosk = canWriteKind(me.role, "hr-attendance");
  const shown = canKiosk ? employees : employees.filter((employee) => employee === mine);
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const lastNight = yesterday.toISOString().slice(0, 10);
  const records = store["hr-attendance"] ?? [];
  // Today's row, or last night's check in still open (a night shift checks out after midnight).
  const rowFor = (employeeId: string) => {
    const todays = records.find((entry) => entry.data.date === today && entry.data.employeeId === employeeId);
    const previous = records.find((entry) => entry.data.date === lastNight && entry.data.employeeId === employeeId);
    return !(todays && todays.data.checkIn && !todays.data.checkOut) && previous?.data.checkIn && !previous.data.checkOut ? previous : todays;
  };
  return (
    <AttendanceKiosk
      timeZone={settingsTimeZone}
      business={me.workspaceName}
      myEmployeeId={mine?.id ?? null}
      canKiosk={canKiosk}
      employees={shown.map((employee) => {
        const row = rowFor(employee.id);
        return { id: employee.id, name: employee.data.name || "Employee", job: employee.data.designation ?? "", department: employee.data.department ?? "", checkIn: row?.data.checkIn ?? "", checkOut: row?.data.checkOut ?? "", hours: row?.data.hoursWorked ?? "", needsPin: Boolean(employee.data.kioskPin) };
      })}
    />
  );
}
