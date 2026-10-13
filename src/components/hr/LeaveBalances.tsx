import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

/** Each active employee's leave this year: allowance, taken, waiting for approval and left, per leave type. */
export default function LeaveBalances({ employees, leaveTypes, leaves, allocations = [] }: { employees: BookkeepingRecord[]; leaveTypes: BookkeepingRecord[]; leaves: BookkeepingRecord[]; allocations?: BookkeepingRecord[] }) {
  const year = new Date().getFullYear().toString();
  const active = employees.filter((employee) => employee.data.status !== "Inactive").sort((a, b) => (a.data.name ?? "").localeCompare(b.data.name ?? ""));
  if (!leaveTypes.length) return <p className="mt-4 rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">Add time off types first (HRM → Time off types), for example Paid time off, Sick time off and Unpaid.</p>;
  const total = (employeeId: string, typeId: string, status: string) => leaves
    .filter((leave) => leave.data.employeeId === employeeId && leave.data.leaveTypeId === typeId && (status === "To Approve" ? ["To Approve", "Pending"].includes(leave.data.status ?? "") : leave.data.status === status) && (leave.data.fromDate ?? "").startsWith(year))
    .reduce((sum, leave) => sum + Number(leave.data.days || 0), 0);
  return (
    <section className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3">Employee</th>
            {leaveTypes.map((type) => <th key={type.id} className="px-4 py-3">{type.data.leaveName}</th>)}
          </tr>
        </thead>
        <tbody>
          {active.map((employee) => (
            <tr key={employee.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium">{employee.data.name}</td>
              {leaveTypes.map((type) => {
                // Approved allocations valid this year, else the type's days a year, as the save rules count them.
                const allocated = allocations.filter((entry) => entry.data.status === "Approved" && entry.data.employeeId === employee.id && entry.data.leaveTypeId === type.id && (entry.data.validFrom ?? "") <= `${year}-12-31` && (!entry.data.validTo || entry.data.validTo >= `${year}-01-01`));
                const allowance = allocated.length ? allocated.reduce((sum, entry) => sum + Number(entry.data.days || 0), 0) : type.data.requiresAllocation === "No limit" ? 0 : Number(type.data.daysPerYear || 0);
                const taken = total(employee.id, type.id, "Approved");
                const pending = total(employee.id, type.id, "To Approve");
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
