import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { user } from "@/db/schema";

type UserRow = typeof user.$inferSelect;

/**
 * Lets the scheduled automation job act for one business owner at a time.
 *
 * Only the cron route (which checks CRON_SECRET) ever sets this. Inside it,
 * requireUser() returns that owner instead of reading a sign-in cookie; every
 * other request, including every server action called from a browser, runs with
 * nothing set and signs in exactly as before.
 */
const scheduledUser = new AsyncLocalStorage<UserRow>();

export function runAsUser<T>(owner: UserRow, work: () => Promise<T>): Promise<T> {
  return scheduledUser.run(owner, work);
}

export function currentScheduledUser(): UserRow | undefined {
  return scheduledUser.getStore();
}
