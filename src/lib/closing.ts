import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";

/** The date a record counts in the books, for the closing date check. */
export function documentDate(kind: string, data: Record<string, string> | undefined): string {
  if (!data) return "";
  switch (kind) {
    case "invoices": return data.issueDate ?? "";
    case "bills": return data.billDate ?? "";
    case "expenses": return data.expenseDate ?? "";
    case "payroll": return /^\d{4}-\d{2}$/.test(data.month ?? "") ? `${data.month}-28` : "";
    case "payments": return data.paymentDate ?? "";
    case "credit-notes":
    case "supplier-credits":
    case "journals":
    case "transactions":
    case "deposits":
    case "inventory-movements":
      return data.date ?? "";
    default:
      return "";
  }
}

/** The closing date from Settings: nothing dated on or before it can change (QuickBooks' Close the books). */
export async function assertBooksOpen(userId: string, ...dates: Array<string | undefined>) {
  const [settings] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  const closed = settings?.data.booksClosedThrough;
  if (!closed) return;
  const inClosed = dates.find((date) => date && date <= closed);
  if (inClosed) throw new ActionError(`The books are closed up to ${closed}. Change the closing date in Settings to change anything dated ${inClosed}.`);
}
