"use server";

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";

export interface ApplicationInput {
  jobId: string;
  name: string;
  email: string;
  phone?: string;
  linkedin?: string;
  message?: string;
  /** Left empty by people; filled by bots. */
  website?: string;
}

/** A job application from the public careers page, added to Recruitment as a New application. */
export async function applyForJob(token: string, input: ApplicationInput): Promise<void> {
  if (typeof token !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw new ActionError("This careers page is no longer available.");
  if (input?.website) return;
  const [settings] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "settings"), sql`${bookkeepingRecord.data}->>'careersToken' = ${token}`)).limit(1);
  if (!settings) throw new ActionError("This careers page is no longer available.");
  const userId = settings.userId;
  const [job] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.id, String(input.jobId ?? "")), eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-jobs"))).limit(1);
  if (!job || job.data.status === "Not recruiting" || job.data.status === "Closed") throw new ActionError("This job is no longer open.");
  const name = String(input.name ?? "").trim().slice(0, 120);
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 200);
  if (name.length < 2) throw new ActionError("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("Enter a valid email address.");
  const linkedin = String(input.linkedin ?? "").trim().slice(0, 300);
  if (linkedin && !/^https?:\/\//.test(linkedin)) throw new ActionError("Enter your LinkedIn profile as a full link, starting with https://.");
  // A little protection against floods: at most 30 web applications an hour per business.
  const recent = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-candidates"), gt(bookkeepingRecord.createdAt, new Date(Date.now() - 60 * 60 * 1000)), sql`${bookkeepingRecord.data}->>'source' = 'Website'`));
  if (recent.length >= 30) throw new ActionError("We’re receiving a lot of applications. Please try again in an hour.");
  const duplicate = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "hr-candidates"), sql`lower(${bookkeepingRecord.data}->>'email') = ${email}`, sql`${bookkeepingRecord.data}->>'job' = ${job.data.jobTitle ?? ""}`)).limit(1);
  if (duplicate.length) throw new ActionError("You have already applied for this job. We’ll be in touch.");
  await db.insert(bookkeepingRecord).values({
    userId,
    kind: "hr-candidates",
    data: {
      candidateName: name,
      email,
      phone: String(input.phone ?? "").trim().slice(0, 40),
      linkedin,
      job: job.data.jobTitle ?? "",
      jobId: job.id,
      owner: job.data.owner ?? "",
      stage: "New",
      source: "Website",
      notes: String(input.message ?? "").trim().slice(0, 4000),
      appliedOn: new Date().toISOString().slice(0, 10),
    },
  });
}
