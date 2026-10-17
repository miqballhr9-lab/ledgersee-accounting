const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The business's weekly days off (Settings > Advanced), as UTC day numbers; Sunday when not set. */
export function weekendDays(setting: string | undefined): number[] {
  const days = (setting ?? "").split(/[,\s]+/).map((name) => dayNames.indexOf(name.trim().toLowerCase())).filter((day) => day >= 0);
  return days.length ? [...new Set(days)] : [0];
}

export const isWeekend = (date: string, weekend: number[]) => weekend.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
