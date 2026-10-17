"use server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { recordAudit } from "@/lib/audit";
import { assertCanWrite, requireUser } from "@/lib/auth";
import { saveBookkeepingRecord } from "@/app/actions";
import { assertBooksOpen } from "@/lib/closing";
import { sendEmailOrThrow } from "@/lib/email";
import { paymentAccountType } from "@/lib/payment-accounts";
import { revalidatePath } from "@/lib/revalidate";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

function balanceOf(data: Record<string, string>) {
  return Math.max(0, (Number(data.amount) || 0) - (Number(data.paidAmount) || 0) - (Number(data.creditApplied) || 0));
}

async function rows(userId: string, kind: string) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind)));
}

async function companyName(userId: string, fallback: string) {
  const [settings] = await rows(userId, "settings");
  return settings?.data.companyName || fallback;
}

function customerFor(customers: Awaited<ReturnType<typeof rows>>, data: Record<string, string>) {
  const name = (data.customer ?? "").trim().toLowerCase();
  return customers.find((row) => row.id === data.customerId || row.id === data.customer) ?? customers.find((row) => (row.data.name ?? "").trim().toLowerCase() === name);
}

/** QuickBooks' refund of a customer credit: the credit note is paid back to the customer from a bank or cash account. */
export async function refundCustomerCredit(id: string, refundDate: string, accountId: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "credit-notes");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refundDate ?? "")) throw new ActionError("Choose a refund date.");
  await assertBooksOpen(me.id, refundDate);
  const [credit] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "credit-notes"))).limit(1);
  if (!credit) throw new ActionError("We couldn’t find that credit note. Refresh and try again.");
  if (["Applied", "Refunded", "Void"].includes(credit.data.status ?? "")) throw new ActionError(`${credit.data.creditNumber || "This credit note"} is ${credit.data.status?.toLowerCase()}, so it can’t be refunded.`);
  const [account] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, accountId), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts"))).limit(1);
  const method = account ? paymentAccountType({ kind: "accounts", data: account.data }) : null;
  if (!account || !method) throw new ActionError("Choose the Cash, Bank or Credit card account the refund was paid from.");
  const data = { ...credit.data, status: "Refunded", refundDate, refundMethod: method, refundAccountId: account.id, refundAccountName: account.data.name || "Account" };
  await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, credit.id));
  await recordAudit(me, "Refunded", "credit-notes", credit.id, data);
  revalidatePath("/app", "layout");
}

/** Sends a payment reminder for one invoice now, as QuickBooks' "Send reminder". */
export async function sendInvoiceReminder(id: string): Promise<void> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  const [invoice] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices"))).limit(1);
  if (!invoice) throw new ActionError("We couldn’t find that invoice. Refresh and try again.");
  const balance = balanceOf(invoice.data);
  if (!balance || ["Paid", "Void", "Cancelled", "Draft"].includes(invoice.data.status ?? "")) throw new ActionError("Only an unpaid invoice that has been sent needs a reminder.");
  const customer = customerFor(await rows(me.id, "customers"), invoice.data);
  const email = customer?.data.email?.trim();
  if (!email) throw new ActionError("Add an email address to this customer to send a reminder.");
  const company = await companyName(me.id, me.workspaceName);
  const amount = `${invoice.data.currency || ""} ${balance.toFixed(2)}`.trim();
  const overdue = invoice.data.dueDate && invoice.data.dueDate < new Date().toISOString().slice(0, 10);
  await sendEmailOrThrow({
    to: email,
    subject: `Reminder: invoice ${invoice.data.invoiceNumber || ""} from ${company}`,
    html: `<p>Hello ${escape(customer?.data.name || invoice.data.customer || "there")},</p><p>Just a reminder that invoice ${escape(invoice.data.invoiceNumber || "")} ${overdue ? `was due on ${escape(invoice.data.dueDate)}` : `is due on ${escape(invoice.data.dueDate || "")}`} and ${escape(amount)} is still open.</p><p>If you have already paid, please ignore this message. Thank you.</p><p>${escape(company)}</p>`,
    fromName: company,
  });
  await db.update(bookkeepingRecord).set({ data: { ...invoice.data, reminderSentAt: new Date().toISOString().slice(0, 10) }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, invoice.id));
  await recordAudit(me, "Reminder sent", "invoices", invoice.id, invoice.data);
  revalidatePath("/app", "layout");
}

/** QuickBooks' customer statement: every open invoice with its balance, emailed to the customer. */
export async function sendCustomerStatement(customerId: string): Promise<{ invoices: number; balance: number }> {
  const me = await requireUser();
  assertCanWrite(me, "customers");
  const customers = await rows(me.id, "customers");
  const customer = customers.find((row) => row.id === customerId);
  if (!customer) throw new ActionError("We couldn’t find that customer. Refresh and try again.");
  const email = customer.data.email?.trim();
  if (!email) throw new ActionError("Add an email address to this customer to send a statement.");
  const today = new Date().toISOString().slice(0, 10);
  const open = (await rows(me.id, "invoices"))
    .filter((row) => customerFor([customer], row.data) && !["Draft", "Void", "Cancelled", "Paid"].includes(row.data.status ?? "") && balanceOf(row.data) > 0.004)
    .sort((a, b) => (a.data.issueDate ?? "").localeCompare(b.data.issueDate ?? ""));
  if (!open.length) throw new ActionError(`${customer.data.name || "This customer"} has nothing open, so there is no statement to send.`);
  const total = open.reduce((sum, row) => sum + balanceOf(row.data), 0);
  const company = await companyName(me.id, me.workspaceName);
  const cell = "padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:left";
  const lines = open.map((row) => `<tr><td style="${cell}">${escape(row.data.issueDate || "")}</td><td style="${cell}">${escape(row.data.invoiceNumber || "")}</td><td style="${cell}">${escape(row.data.dueDate || "")}</td><td style="${cell};text-align:right">${(Number(row.data.amount) || 0).toFixed(2)}</td><td style="${cell};text-align:right">${balanceOf(row.data).toFixed(2)}</td></tr>`).join("");
  await sendEmailOrThrow({
    to: email,
    subject: `Statement from ${company} as of ${today}`,
    html: `<p>Hello ${escape(customer.data.name || "there")},</p><p>Here is your statement as of ${today}.</p><table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="${cell}">Date</th><th style="${cell}">Invoice</th><th style="${cell}">Due</th><th style="${cell};text-align:right">Amount</th><th style="${cell};text-align:right">Open balance</th></tr></thead><tbody>${lines}</tbody><tfoot><tr><td colspan="4" style="${cell};font-weight:600">Amount due</td><td style="${cell};text-align:right;font-weight:600">${total.toFixed(2)}</td></tr></tfoot></table><p>Thank you for your business.</p><p>${escape(company)}</p>`,
    fromName: company,
  });
  await db.update(bookkeepingRecord).set({ data: { ...customer.data, statementSentAt: today }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, customer.id));
  await recordAudit(me, "Statement sent", "customers", customer.id, customer.data);
  revalidatePath("/app", "layout");
  return { invoices: open.length, balance: Math.round(total * 100) / 100 };
}

/** Open delayed charges and credits for one customer become one draft invoice: charges as lines, credits as its discount. */
export async function createInvoiceFromCharges(ids: string[]): Promise<{ id: string; number: string }> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  assertCanWrite(me, "delayed-charges");
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String).slice(0, 200));
  const entries = (await rows(me.id, "delayed-charges")).filter((row) => wanted.has(row.id));
  if (!entries.length) throw new ActionError("Select the charges to invoice.");
  if (entries.some((row) => row.data.status === "Closed")) throw new ActionError("Only open charges can be invoiced. Untick closed ones.");
  const customers = [...new Set(entries.map((row) => (row.data.customer ?? "").trim()))];
  if (customers.length !== 1 || !customers[0]) throw new ActionError("Choose charges for one customer at a time.");
  const charges = entries.filter((row) => row.data.chargeType !== "Credit");
  const credit = entries.filter((row) => row.data.chargeType === "Credit").reduce((sum, row) => sum + (Number(row.data.amount) || 0), 0);
  if (!charges.length) throw new ActionError("Add at least one charge; credits go on an invoice with charges.");
  const chargeTotal = charges.reduce((sum, row) => sum + (Number(row.data.amount) || 0), 0);
  if (credit > chargeTotal + 0.005) throw new ActionError("The credits are more than the charges. Pick more charges, or give the customer a credit note.");
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await rows(me.id, "invoices");
  const highest = invoices.reduce((max, row) => Math.max(max, Number(/^INV-(\d{1,6})$/.exec(row.data.invoiceNumber ?? "")?.[1] ?? 0)), 0);
  const number = `INV-${String(highest + 1).padStart(4, "0")}`;
  const lines = charges
    .sort((a, b) => (a.data.date ?? "").localeCompare(b.data.date ?? ""))
    .map((row) => ({ itemId: "", name: row.data.service || "Charge", description: [row.data.date, row.data.description].filter(Boolean).join(" · ").slice(0, 300), quantity: row.data.quantity || "1", rate: Number(row.data.rate).toFixed(2) }));
  const due = new Date(`${today}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const saved = await saveBookkeepingRecord("invoices", {
    customer: customers[0],
    invoiceNumber: number,
    issueDate: today,
    paymentTerms: "30 days",
    dueDate: due.toISOString().slice(0, 10),
    lineItems: JSON.stringify(lines),
    ...(credit > 0 ? { discount: credit.toFixed(2) } : {}),
    status: "Draft",
    paymentMethod: "Credit",
    memo: "Delayed charges",
  });
  for (const entry of entries) {
    await db.update(bookkeepingRecord).set({ data: { ...entry.data, status: "Closed", invoiceId: saved.id, invoiceNumber: saved.data.invoiceNumber || number }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, entry.id));
  }
  revalidatePath("/app", "layout");
  return { id: saved.id, number: saved.data.invoiceNumber || number };
}

/** QuickBooks' "Add billable time to an invoice": one draft invoice with a line per time entry, for one customer. */
export async function createInvoiceFromTime(ids: string[]): Promise<{ id: string; number: string }> {
  const me = await requireUser();
  assertCanWrite(me, "invoices");
  assertCanWrite(me, "time-activities");
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String).slice(0, 200));
  const entries = (await rows(me.id, "time-activities")).filter((row) => wanted.has(row.id));
  if (!entries.length) throw new ActionError("Select the time entries to invoice.");
  if (entries.some((row) => row.data.status !== "Unbilled")) throw new ActionError("Only billable time that hasn’t been invoiced can be added. Untick billed or non-billable entries.");
  const customers = [...new Set(entries.map((row) => (row.data.customer ?? "").trim()))];
  if (customers.length !== 1 || !customers[0]) throw new ActionError("Choose time for one customer at a time, and make sure each entry has a customer.");
  if (entries.some((row) => !(Number(row.data.rate) > 0))) throw new ActionError("Add a rate per hour to each entry before invoicing it.");
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await rows(me.id, "invoices");
  const highest = invoices.reduce((max, row) => Math.max(max, Number(/^INV-(\d{1,6})$/.exec(row.data.invoiceNumber ?? "")?.[1] ?? 0)), 0);
  const number = `INV-${String(highest + 1).padStart(4, "0")}`;
  const lines = entries
    .sort((a, b) => (a.data.date ?? "").localeCompare(b.data.date ?? ""))
    .map((row) => ({ itemId: "", name: row.data.service || "Services", description: [row.data.date, row.data.employee, row.data.description].filter(Boolean).join(" · ").slice(0, 300), quantity: String(Number(row.data.hours)), rate: Number(row.data.rate).toFixed(2) }));
  const due = new Date(`${today}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const saved = await saveBookkeepingRecord("invoices", {
    customer: customers[0],
    invoiceNumber: number,
    issueDate: today,
    paymentTerms: "30 days",
    dueDate: due.toISOString().slice(0, 10),
    lineItems: JSON.stringify(lines),
    status: "Draft",
    paymentMethod: "Credit",
    memo: "Billable time",
  });
  for (const entry of entries) {
    await db.update(bookkeepingRecord).set({ data: { ...entry.data, status: "Billed", invoiceId: saved.id, invoiceNumber: saved.data.invoiceNumber || number }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, entry.id));
  }
  revalidatePath("/app", "layout");
  return { id: saved.id, number: saved.data.invoiceNumber || number };
}
