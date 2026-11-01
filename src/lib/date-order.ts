import { ActionError } from "@/lib/action-error";

/** Pairs of dates where the second can't come before the first: an end before its start, an expiry before its date. */
const pairs: Array<[from: string, to: string, message: string]> = [
  ["startDate", "endDate", "The end date can’t be before the start date."],
  ["fromDate", "toDate", "The end date can’t be before the start date."],
  ["date", "expiryDate", "The expiry date can’t be before the estimate’s date."],
  ["issueDate", "dueDate", "The due date can’t be before the invoice date."],
  ["billDate", "dueDate", "The due date can’t be before the bill date."],
  ["rtStart", "rtEndDate", "The schedule can’t end before it starts."],
];

/** Kinds where a document's expiry is checked: an HR document may well have expired already. */
const expiryKinds = new Set(["estimates"]);

export function assertDateOrder(kind: string, data: Record<string, string>) {
  for (const [from, to, message] of pairs) {
    if (to === "expiryDate" && !expiryKinds.has(kind)) continue;
    const start = data[from]?.trim();
    const end = data[to]?.trim();
    if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < start) throw new ActionError(message);
  }
}
