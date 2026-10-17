"use server";

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";

export interface WebLeadInput {
  firstName?: string;
  lastName: string;
  company?: string;
  email: string;
  phone?: string;
  message?: string;
  /** One of the territories in Settings, when the form offers them. */
  territory?: string;
  /** Left empty by people; filled by bots. */
  website?: string;
}

/** Zoho's web-to-lead form: a public form that adds a Not Contacted lead. */
export async function submitWebLead(token: string, input: WebLeadInput): Promise<void> {
  if (typeof token !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw new ActionError("This form is no longer available.");
  if (input?.website) return;
  const [settings] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "settings"), sql`${bookkeepingRecord.data}->>'webFormToken' = ${token}`)).limit(1);
  if (!settings) throw new ActionError("This form is no longer available.");
  const userId = settings.userId;
  const lastName = String(input.lastName ?? "").trim().slice(0, 80);
  const firstName = String(input.firstName ?? "").trim().slice(0, 80);
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!lastName) throw new ActionError("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("Enter a valid email address.");
  const recent = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "crm-leads"), gt(bookkeepingRecord.createdAt, new Date(Date.now() - 60 * 60 * 1000)), sql`${bookkeepingRecord.data}->>'leadSource' = 'Web Form'`));
  if (recent.length >= 60) throw new ActionError("We’re receiving a lot of requests. Please try again in an hour.");
  const leads = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "crm-leads")));
  // Someone already a lead just gets a note on their lead.
  const existing = leads.find((row) => (row.data.email ?? "").trim().toLowerCase() === email);
  const message = String(input.message ?? "").trim().slice(0, 4000);
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  if (existing) {
    await db.insert(bookkeepingRecord).values({ userId, kind: "crm-notes", data: { parentKind: "crm-leads", parentId: existing.id, title: "Web form sent again", content: message || "(no message)", author: "Web form", createdOn: now } });
    return;
  }
  // The territory's people, else the assignment rule in Settings, decide the owner; else the business itself.
  const territoryLines = (settings.data.crmTerritories ?? "").split("\n").filter((line) => line.includes(":"));
  const territoryLine = territoryLines.find((line) => line.split(":")[0].trim().toLowerCase() === String(input.territory ?? "").trim().toLowerCase());
  const territory = territoryLine?.split(":")[0].trim() ?? "";
  const people = (territoryLine?.split(":")[1] ?? settings.data.leadAssignment ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const openCount = (name: string) => leads.filter((row) => row.data.owner === name && !["Converted", "Junk Lead", "Lost Lead", "Not Qualified"].includes(row.data.leadStatus ?? "")).length;
  const owner = people.length ? people.reduce((best, name) => (openCount(name) < openCount(best) ? name : best), people[0]) : settings.data.companyName || "";
  const phone = String(input.phone ?? "").trim().slice(0, 40);
  // The lead form needs a company; a person who gives none is filed under their own name.
  const givenCompany = String(input.company ?? "").trim().slice(0, 120);
  const company = givenCompany || [firstName, lastName].filter(Boolean).join(" ") || "Web form";
  const score = Math.min(100, 15 + (phone ? 15 : 0) + (givenCompany ? 10 : 0));
  await db.insert(bookkeepingRecord).values({
    userId,
    kind: "crm-leads",
    data: {
      firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" "), company, email, phone,
      leadSource: "Web Form", leadStatus: "Not Contacted", owner, ...(territory ? { territory } : {}), description: message, leadScore: String(score),
      history: JSON.stringify([{ at: now, by: "Web form", text: "Lead created from the web form" }]),
    },
  });
}
