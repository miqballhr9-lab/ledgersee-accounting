"use server";

import { and, desc, eq, gt, ne } from "drizzle-orm";

import { db } from "@/db";
import { account, bookkeepingRecord, session } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { getAuthSession, SIGN_IN_LOG_KIND } from "@/lib/auth";

export interface SignedInDevice {
  id: string;
  device: string;
  ipAddress: string;
  signedInAt: string;
  lastActive: string;
  current: boolean;
}

export interface SignInEntry {
  at: string;
  device: string;
  ipAddress: string;
}

export interface MySecurity {
  twoStep: boolean;
  hasPassword: boolean;
  devices: SignedInDevice[];
  signIns: SignInEntry[];
}

/** "Chrome on Windows" from a browser's user-agent string; good enough to recognise a device. */
function describeDevice(userAgent: string | null | undefined) {
  const agent = userAgent ?? "";
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\/|Opera/.test(agent) ? "Opera" : /SamsungBrowser/.test(agent) ? "Samsung Internet" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Mac OS X|Macintosh/.test(agent) ? "Mac" : /CrOS/.test(agent) ? "Chromebook" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

/** The person actually signed in (never the business they work in) and this browser's session. */
async function me() {
  const current = await getAuthSession();
  if (!current) throw new ActionError("Please sign in again.");
  return current;
}

/** The signed-in person's own security: two-step sign-in, devices signed in now, recent sign-ins. */
export async function mySecurity(): Promise<MySecurity> {
  const { user, session: current } = await me();
  const [devices, passwords, log] = await Promise.all([
    db.select().from(session).where(and(eq(session.userId, user.id), gt(session.expiresAt, new Date()))).orderBy(desc(session.updatedAt)),
    db.select({ id: account.id }).from(account).where(and(eq(account.userId, user.id), eq(account.providerId, "credential"))).limit(1),
    db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, user.id), eq(bookkeepingRecord.kind, SIGN_IN_LOG_KIND))).orderBy(desc(bookkeepingRecord.createdAt)).limit(15),
  ]);
  return {
    twoStep: Boolean(user.twoFactorEnabled),
    hasPassword: passwords.length > 0,
    devices: devices.map((row) => ({
      id: row.id,
      device: describeDevice(row.userAgent),
      ipAddress: row.ipAddress ?? "",
      signedInAt: row.createdAt.toISOString(),
      lastActive: row.updatedAt.toISOString(),
      current: row.id === current.id,
    })),
    signIns: log.map((row) => ({ at: row.data.at || row.createdAt.toISOString(), device: describeDevice(row.data.userAgent), ipAddress: row.data.ipAddress ?? "" })),
  };
}

/** Signs out one of the person's own devices. */
export async function signOutDevice(sessionId: string): Promise<void> {
  const { user, session: current } = await me();
  if (sessionId === current.id) throw new ActionError("That's this device. Use Sign out in the menu instead.");
  await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, user.id)));
}

/** Signs out every device except this one; returns how many were signed out. */
export async function signOutOtherDevices(): Promise<number> {
  const { user, session: current } = await me();
  const removed = await db.delete(session).where(and(eq(session.userId, user.id), ne(session.id, current.id))).returning({ id: session.id });
  return removed.length;
}
