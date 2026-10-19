import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

export const paymentTermOptions = ["Due on receipt", "15 days", "30 days", "60 days"];

/**
 * The payment terms for a new invoice or bill: the customer's or supplier's
 * own terms, else the business's default for bills (Settings), else 30 days.
 */
export async function termsFor(userId: string, kind: "customers" | "vendors", name: string | undefined) {
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), inArray(bookkeepingRecord.kind, [kind, "settings"])));
  const wanted = (name ?? "").trim().toLowerCase();
  const party = wanted ? rows.find((row) => row.kind === kind && (row.data.name ?? "").trim().toLowerCase() === wanted) : undefined;
  const fallback = kind === "vendors" ? rows.find((row) => row.kind === "settings")?.data.billTerms : "";
  return [party?.data.paymentTerms, fallback].find((terms): terms is string => Boolean(terms) && paymentTermOptions.includes(terms ?? "")) ?? "30 days";
}
