"use server";

import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord, user } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { planByKey } from "@/lib/plans";
import { assertAdmin, getUser, requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { sendEmail } from "@/lib/email";
import { isRole, type Role } from "@/lib/permissions";
import { revalidatePath } from "@/lib/revalidate";
import { siteUrl } from "@/lib/site";

/**
 * Team members: invite people into this business, give each a role, and turn
 * access off again. A member is a "team-members" record in the owner's
 * workspace; once someone accepts the invite with an account under the invited
 * email, every page they open reads this business's records within their role.
 */

type StoredRow = typeof bookkeepingRecord.$inferSelect;

function toRecord(row: StoredRow): BookkeepingRecord {
  // The invite token is a password-like secret; it never leaves the server.
  const { inviteToken: _inviteToken, ...data } = row.data;
  return { id: row.id, kind: "team-members", data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function cleanEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new ActionError("Enter a valid email address.");
  return email;
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

async function members(ownerId: string) {
  return db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, "team-members")));
}

async function inviteLink(token: string) {
  return `${await siteUrl()}/invite/${token}`;
}

async function emailInvite(to: string, name: string, role: string, business: string, link: string) {
  return sendEmail({
    to,
    subject: `You're invited to ${business} on MIK LEDGER`,
    fromName: business,
    html: `<p>Hello ${escape(name || "there")},</p>
<p>${escape(business)} has invited you to join their business on MIK LEDGER as <strong>${escape(role)}</strong>.</p>
<p><a href="${link}">Accept the invitation</a></p>
<p>Use this email address (${escape(to)}) to create your account or sign in. The link works once.</p>
<p>If you weren't expecting this, you can ignore this email.</p>`,
  });
}

export interface TeamState {
  owner: { name: string; email: string };
  members: BookkeepingRecord[];
  me: { actorId: string; isOwner: boolean };
}

export async function getTeam(): Promise<TeamState> {
  const me = await requireUser();
  assertAdmin(me);
  const [owner] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, me.ownerId)).limit(1);
  const rows = await members(me.ownerId);
  return {
    owner: { name: owner?.name ?? "", email: owner?.email ?? "" },
    members: rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toRecord),
    me: { actorId: me.actorId, isOwner: me.isOwner },
  };
}

export interface InviteInput {
  name: string;
  email: string;
  role: string;
  department?: string;
}

/** Adds a member (or re-invites an existing one) and emails them a one-time link. */
export async function inviteMember(input: InviteInput): Promise<{ member: BookkeepingRecord; link: string; emailed: boolean }> {
  const me = await requireUser();
  assertAdmin(me);
  const email = cleanEmail(input.email);
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new ActionError("Enter the person’s name.");
  if (!isRole(input.role)) throw new ActionError("Choose a role.");
  const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, me.ownerId)).limit(1);
  if (owner?.email.toLowerCase() === email) throw new ActionError("That’s the business owner’s own email; the owner already has full access.");
  const rows = await members(me.ownerId);
  const existing = rows.find((row) => row.data.email?.trim().toLowerCase() === email);
  if (existing?.data.status === "Active") throw new ActionError(`${existing.data.name || email} is already a member. Change their role from the list.`);
  // The plan sets how many people can sign in, the owner included.
  if (me.access.locked) throw new ActionError("Your subscription isn’t active. Choose a plan in Billing before inviting people.");
  const seats = rows.filter((row) => row.id !== existing?.id && row.data.enabled !== "false" && ["Active", "Invited"].includes(row.data.status ?? "")).length + 1;
  if (seats + 1 > me.access.users) throw new ActionError(`Your ${planByKey(me.access.plan)?.name ?? ""} plan includes ${me.access.users} ${me.access.users === 1 ? "user" : "users"}. Upgrade in Billing to invite more people.`);
  const token = randomBytes(24).toString("base64url");
  const data: Record<string, string> = {
    ...(existing?.data ?? {}),
    name,
    email,
    role: input.role,
    department: input.department?.trim().slice(0, 80) ?? existing?.data.department ?? "",
    enabled: "true",
    status: "Invited",
    inviteToken: token,
    invitedAt: new Date().toISOString(),
    invitedBy: me.name,
  };
  const [saved] = existing
    ? await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, existing.id)).returning()
    : await db.insert(bookkeepingRecord).values({ userId: me.ownerId, kind: "team-members", data }).returning();
  const link = await inviteLink(token);
  const emailed = await emailInvite(email, name, input.role, me.workspaceName, link);
  revalidatePath("/app", "layout");
  return { member: toRecord(saved), link, emailed };
}

/** Makes a fresh link for a pending invite (the old one stops working) and emails it again. */
export async function resendInvite(id: string): Promise<{ link: string; emailed: boolean }> {
  const me = await requireUser();
  assertAdmin(me);
  const row = (await members(me.ownerId)).find((item) => item.id === id);
  if (!row) throw new ActionError("We couldn’t find that member. Refresh and try again.");
  if (row.data.status === "Active") throw new ActionError("This person has already joined.");
  const token = randomBytes(24).toString("base64url");
  await db.update(bookkeepingRecord).set({ data: { ...row.data, status: "Invited", inviteToken: token, invitedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
  const link = await inviteLink(token);
  const emailed = await emailInvite(row.data.email, row.data.name, row.data.role, me.workspaceName, link);
  revalidatePath("/app", "layout");
  return { link, emailed };
}

/** Changes a member's role, or turns their access off and on. */
export async function updateMember(id: string, changes: { role?: string; enabled?: boolean; department?: string }): Promise<BookkeepingRecord> {
  const me = await requireUser();
  assertAdmin(me);
  const row = (await members(me.ownerId)).find((item) => item.id === id);
  if (!row) throw new ActionError("We couldn’t find that member. Refresh and try again.");
  if (row.data.memberUserId === me.actorId && (changes.enabled === false || (changes.role && changes.role !== "Admin"))) {
    throw new ActionError("You can’t lower or turn off your own access. Ask another Admin.");
  }
  if (changes.role !== undefined && !isRole(changes.role)) throw new ActionError("Choose a role.");
  const data = {
    ...row.data,
    ...(changes.role ? { role: changes.role as Role } : {}),
    ...(changes.enabled !== undefined ? { enabled: changes.enabled ? "true" : "false" } : {}),
    ...(changes.department !== undefined ? { department: changes.department.trim().slice(0, 80) } : {}),
  };
  const [saved] = await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id)).returning();
  revalidatePath("/app", "layout");
  return toRecord(saved);
}

/** Removes a member. Their past work stays; they simply can't open this business any more. */
export async function removeMember(id: string): Promise<void> {
  const me = await requireUser();
  assertAdmin(me);
  const row = (await members(me.ownerId)).find((item) => item.id === id);
  if (!row) throw new ActionError("We couldn’t find that member. Refresh and try again.");
  if (row.data.memberUserId === me.actorId) throw new ActionError("You can’t remove yourself. Ask another Admin.");
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.id, row.id));
  revalidatePath("/app", "layout");
}

async function inviteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "team-members"), sql`${bookkeepingRecord.data}->>'inviteToken' = ${token}`, sql`${bookkeepingRecord.data}->>'status' = 'Invited'`))
    .limit(1);
  return row ?? null;
}

export interface InviteDetails {
  business: string;
  name: string;
  email: string;
  role: string;
}

/** What an invite link is for, shown on the public invite page. Null when the link is used or wrong. */
export async function getInvite(token: string): Promise<InviteDetails | null> {
  const row = await inviteByToken(token);
  if (!row) return null;
  const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, row.userId)).limit(1);
  return { business: owner?.name ?? "A business", name: row.data.name ?? "", email: row.data.email ?? "", role: row.data.role ?? "Viewer" };
}

/** Joins the business behind an invite link, with the account that is signed in now. */
export async function acceptInvite(token: string): Promise<void> {
  const signedIn = await getUser();
  if (!signedIn) throw new ActionError("Sign in or create your account first.");
  const row = await inviteByToken(token);
  if (!row) throw new ActionError("This invitation has already been used or replaced. Ask for a new one.");
  if (signedIn.email.trim().toLowerCase() !== row.data.email?.trim().toLowerCase()) {
    throw new ActionError(`This invitation is for ${row.data.email}. Sign in with that email address.`);
  }
  if (row.userId === signedIn.id) throw new ActionError("You already own this business.");
  const other = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "team-members"), sql`${bookkeepingRecord.data}->>'memberUserId' = ${signedIn.id}`, sql`${bookkeepingRecord.data}->>'status' = 'Active'`));
  // One business at a time: joining a new one ends membership of any other.
  for (const membership of other) {
    if (membership.id !== row.id) await db.update(bookkeepingRecord).set({ data: { ...membership.data, status: "Left" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, membership.id));
  }
  await db.update(bookkeepingRecord).set({
    data: { ...row.data, status: "Active", enabled: "true", memberUserId: signedIn.id, inviteToken: "", joinedAt: new Date().toISOString(), name: row.data.name || signedIn.name },
    updatedAt: new Date(),
  }).where(eq(bookkeepingRecord.id, row.id));
  revalidatePath("/app", "layout");
}

/** A member leaves the business they joined and goes back to their own workspace. */
export async function leaveBusiness(): Promise<void> {
  const me = await requireUser();
  if (me.isOwner) throw new ActionError("You’re the owner of this business, so there’s nothing to leave.");
  const rows = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, me.ownerId), eq(bookkeepingRecord.kind, "team-members"), sql`${bookkeepingRecord.data}->>'memberUserId' = ${me.actorId}`));
  for (const row of rows) await db.update(bookkeepingRecord).set({ data: { ...row.data, status: "Left" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
  revalidatePath("/app", "layout");
}
