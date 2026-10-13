/**
 * HR states use Odoo's names (To Approve, Refused, Running, Contract Signed…).
 * Records saved before the switch keep their old names in the database; these
 * helpers read either, and records are rewritten with the Odoo name when saved.
 */

const legacy: Record<string, Array<{ key: string; map: Record<string, string> }>> = {
  "hr-leaves": [{ key: "status", map: { Pending: "To Approve", Rejected: "Refused" } }],
  "hr-allocations": [{ key: "status", map: { Pending: "To Approve", Rejected: "Refused" } }],
  "hr-loans": [{ key: "status", map: { Requested: "To Approve", Approved: "Running", Repaid: "Completed", Rejected: "Cancelled" } }],
  "hr-claims": [{ key: "status", map: { Rejected: "Refused" } }],
  "hr-jobs": [{ key: "status", map: { Open: "Recruiting", "On hold": "Not recruiting", Closed: "Not recruiting" } }],
  "hr-candidates": [
    { key: "stage", map: { Applied: "New", Screening: "Initial Qualification", Interview: "First Interview", Offer: "Contract Proposal", Hired: "Contract Signed", Rejected: "Refused", Withdrawn: "Refused" } },
    { key: "rating", map: { "1": "Good", "2": "Good", "3": "Very Good", "4": "Excellent", "5": "Excellent" } },
  ],
  "hr-onboarding": [{ key: "status", map: { "Not Started": "To Do", "In Progress": "To Do" } }],
  "hr-appraisals": [{ key: "status", map: { Draft: "To Confirm", Submitted: "Confirmed", Completed: "Done" } }],
  "hr-settlements": [{ key: "reason", map: { Resignation: "Resigned", Termination: "Fired", Retirement: "Retired" } }],
};

/** The record's data with its states under the Odoo names. */
export function odooHrData(kind: string, data: Record<string, string>): Record<string, string> {
  let result = data;
  for (const rule of legacy[kind] ?? []) {
    const value = result[rule.key];
    if (value && value in rule.map) result = { ...result, [rule.key]: rule.map[value] };
  }
  return result;
}

/** A salary attachment still being deducted from pay ("Approved" before the switch). */
export const isRunningAttachment = (status: string | undefined) => status === "Running" || status === "Approved";
/** A salary attachment fully deducted ("Repaid" before the switch). */
export const isCompletedAttachment = (status: string | undefined) => status === "Completed" || status === "Repaid";
/** A time off or allocation request waiting for approval ("Pending" before the switch). */
export const isToApprove = (status: string | undefined) => status === "To Approve" || status === "Pending" || status === "Requested";
/** An application that led to a hire ("Hired" before the switch). */
export const isHiredStage = (stage: string | undefined) => stage === "Contract Signed" || stage === "Hired";
/** An application no longer in the pipeline. */
export const isClosedApplication = (stage: string | undefined) => ["Contract Signed", "Refused", "Hired", "Rejected", "Withdrawn"].includes(stage ?? "");
