/**
 * Birthdays and work anniversaries coming up, from each active employee's
 * date of birth and joining date. Only the day and month are shown, never
 * the year someone was born.
 */
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

export interface Celebration {
  employeeId: string;
  name: string;
  kind: "Birthday" | "Work anniversary";
  /** The date it falls on next (YYYY-MM-DD), today included. */
  date: string;
  /** Years of service reached, for an anniversary. */
  years?: number;
  daysAway: number;
}

const dayMs = 24 * 60 * 60 * 1000;

/** The next time a yearly date comes round on or after today; 29 February is kept on 28 February in other years. */
function nextOccurrence(original: string, today: string) {
  const [, month, day] = original.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  const on = (target: number) => {
    const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
    const safeDay = month === 2 && day === 29 && !leap ? 28 : day;
    return `${target}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
  };
  const thisYear = on(year);
  return thisYear >= today ? thisYear : on(year + 1);
}

export function upcomingCelebrations(employees: Array<Pick<BookkeepingRecord, "id" | "data">>, today: string, withinDays = 30): Celebration[] {
  const list: Celebration[] = [];
  const valid = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
  for (const employee of employees) {
    if (employee.data.status === "Inactive" || !employee.data.name?.trim()) continue;
    const name = employee.data.name.trim();
    const add = (kind: Celebration["kind"], original: string) => {
      const date = nextOccurrence(original, today);
      const daysAway = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
      if (daysAway > withinDays) return;
      const years = kind === "Work anniversary" ? Number(date.slice(0, 4)) - Number(original.slice(0, 4)) : undefined;
      // The joining day itself isn't an anniversary.
      if (kind === "Work anniversary" && !years) return;
      list.push({ employeeId: employee.id, name, kind, date, daysAway, ...(years ? { years } : {}) });
    };
    if (valid(employee.data.dateOfBirth)) add("Birthday", employee.data.dateOfBirth);
    if (valid(employee.data.joiningDate)) add("Work anniversary", employee.data.joiningDate);
  }
  return list.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}
