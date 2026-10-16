import "server-only";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

/** Every add, edit, delete and payment, for the Audit Log report. */
const unaudited = new Set(["audit-events", "automation-log", "automation-settings", "team-members"]);

function auditLabel(data: Record<string, string>) {
  return data.invoiceNumber || data.billNumber || data.creditNumber || data.estimateNumber || data.orderNumber || data.poNumber || data.reference || data.referenceNumber
    || data.rtName || data.employeeName || data.name || data.description || data.payee
    || data.fullName || data.dealName || data.subject || data.candidateName || data.jobTitle || data.employee || data.leaveName || data.departmentName || "";
}

export async function recordAudit(me: { id: string; name?: string | null; email?: string | null }, action: string, kind: string, id: string, data: Record<string, string>) {
  if (unaudited.has(kind)) return;
  try {
    await db.insert(bookkeepingRecord).values({
      userId: me.id,
      kind: "audit-events",
      data: {
        action,
        recordKind: kind,
        recordId: id,
        label: auditLabel(data).slice(0, 200),
        name: (data.customer || data.vendor || data.payee || data.employeeName || data.employee || data.account || "").slice(0, 200),
        amount: data.amount ?? "",
        actorName: me.name ?? "",
        actorEmail: me.email ?? "",
        at: new Date().toISOString(),
      },
    });
  } catch {
    // The audit trail never blocks the change itself.
  }
}
