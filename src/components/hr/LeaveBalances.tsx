import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

/** Each active employee's leave this year: allowance, taken, waiting for approval and left, per leave type. */
export default function LeaveBalances({ employees, leaveTypes, leaves }: { employees: BookkeepingRecord[]; leaveTypes: BookkeepingRecord[]; leaves: BookkeepingRecord[] }) {
  const year = new Date().getFullYear().toString();
  const active = employees.filter((employee) => employee.data.status !== "Inactive").sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  if (!leaveTypes.length) return <p className="mt-4 rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">Add leave types first (HR → Leave types), for example Annual 14 days, Casual 10 days, Sick 8 days.</p>;
  const total = (employeeId: string, typeId: string, status: string) => leaves
    .filter((leave) => leave.data.employeeId === employeeId && leave.data.leaveTypeId === typeId && leave.data.status === status && (leave.data.fromDate ?? "").startsWith(year))
    .reduce((sum, leave) => sum + Number(leave.data.days || 0), 0);
  return (
    <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3">Employee</th>
            {leaveTypes.map((type) => <th key={type.id} className="px-4 py-3">{type.data.leaveName} <span className="font-normal">({type.data.daysPerYear || 0})</span></th>)}
          </tr>
        </thead>
        <tbody>
          {active.map((employee) => (
            <tr key={employee.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium">{employee.data.name}</td>
              {leaveTypes.map((type) => {
                const allowance = Number(type.data.daysPerYear || 0);
                const taken = total(employee.id, type.id, "Approved");
                const pending = total(employee.id, type.id, "Pending");
                const left = allowance - taken;
                return (
                  <td key={type.id} className="px-4 py-3 tabular-nums">
                    <span className={`font-semibold ${left <= 0 && allowance ? "text-destructive" : ""}`}>{allowance ? `${left} left` : `${taken} taken`}</span>
                    <span className="block text-xs text-muted-foreground">{taken} taken{pending ? ` · ${pending} pending` : ""}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!active.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No active employees.</p> : null}
    </section>
  );
}
