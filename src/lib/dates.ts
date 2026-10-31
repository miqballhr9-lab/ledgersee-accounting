import { packFor } from "@/lib/tax-packs";

/**
 * One clock for the whole app: the business's time zone. "Today" for a new
 * document, a check-in, a due date or a report is the date there, never the
 * server's (UTC) or the browser's. Works on the server and in the browser.
 */
export const DEFAULT_TIME_ZONE = "Asia/Karachi";

/**
 * The business's time zone from its settings. When none is set, the tax
 * country's; and a zone left on New York from an earlier setup in a business
 * whose tax country is elsewhere is taken to be that country's, since that
 * mismatch (a Pakistan business on New York time) is never what was meant.
 */
export function effectiveTimeZone(settings: Record<string, string | undefined> | null | undefined) {
  const pack = packFor(settings?.taxCountry);
  const chosen = settings?.timeZone?.trim();
  if (chosen && !(pack && chosen === "America/New_York" && pack.timeZone !== chosen) && validZone(chosen)) return chosen;
  return pack?.timeZone || DEFAULT_TIME_ZONE;
}

function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD in a time zone (the business's by default in the browser). */
export function dateInZone(timeZone: string | undefined, at: Date = new Date()) {
  const zone = timeZone && validZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** HH:MM (24-hour) in a time zone. */
export function timeInZone(timeZone: string | undefined, at: Date = new Date()) {
  const zone = timeZone && validZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

// In the browser, the app frame sets the signed-in business's zone once per page.
let browserZone: string | undefined;

export function setBrowserTimeZone(timeZone: string | undefined) {
  if (timeZone) browserZone = timeZone;
}

/** Today in the business's time zone, for client components. */
export function todayHere() {
  return dateInZone(browserZone);
}

/** This month (YYYY-MM) in the business's time zone, for client components. */
export function thisMonthHere() {
  return todayHere().slice(0, 7);
}
