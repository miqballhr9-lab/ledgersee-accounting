import type { Metadata } from "next";

import HrHome from "@/components/hr/HrHome";
import HrToday from "@/components/hr/HrToday";
import { requireUser } from "@/lib/auth";
import { upcomingCelebrations } from "@/lib/celebrations";
import { loadHrData } from "@/lib/hr-data";
import { attendanceSessions } from "@/lib/hr-rules";
import { canWriteKind } from "@/lib/permissions";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "HRM" };

const standardTypes = ["Annual leave", "Casual leave", "Sick leave", "Maternity leave", "Paternity leave", "Unpaid leave"];

export default async function HrHomePage() {
  await requireFeature("hr");
  const me = await requireUser();
  const { store, currency, today } = await loadHrData();
  const employees = (store.employees ?? []).filter((employee) => employee.data.status !== "Inactive" && employee.data.name?.trim());
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const lastNight = yesterday.toISOString().slice(0, 10);
  // Who is in right now: an open check in today, or one from last night not closed yet.
  const checkedIn = (store["hr-attendance"] ?? [])
    .filter((row) => row.data.date === today || row.data.date === lastNight)
    .flatMap((row) => {
      const sessions = attendanceSessions(row.data.sessions);
      if (!sessions.length && row.data.checkIn) sessions.push({ in: row.data.checkIn, out: row.data.checkOut ?? "" });
      const last = sessions[sessions.length - 1];
      return last && !last.out ? [{ name: row.data.employee || "Employee", since: `${row.data.date === lastNight ? "yesterday " : ""}${last.in}`, fromApp: row.data.checkInSource === "Employee app" }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const onLeave = (store["hr-leaves"] ?? [])
    .filter((leave) => leave.data.status === "Approved" && (leave.data.fromDate ?? "") <= today && (leave.data.toDate || leave.data.fromDate || "") >= today)
    .map((leave) => ({ name: leave.data.employee || "Employee", type: leave.data.leaveType || "Time off", to: leave.data.toDate || leave.data.fromDate || "" }));
  const typeNames = new Set((store["hr-leave-types"] ?? []).map((type) => (type.data.leaveName ?? "").trim().toLowerCase()));
  return (
    <HrHome store={store} currency={currency} asOfDate={today}>
      <HrToday
        today={today}
        checkedIn={checkedIn}
        employeeCount={employees.length}
        onLeave={onLeave}
        celebrations={upcomingCelebrations(employees, today)}
        missingLeaveTypes={standardTypes.filter((name) => !typeNames.has(name.toLowerCase()))}
        canManage={canWriteKind(me.role, "hr-leave-types")}
      />
    </HrHome>
  );
}
