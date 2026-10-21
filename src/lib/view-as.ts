import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Super Admin support view: a platform admin opens one business read-only to see
 * what its people see. The cookie names the business and is signed together with
 * the admin's own user id, so it is useless to anyone else and can't be forged or
 * pointed at another business. It lasts an hour.
 */
export const VIEW_AS_COOKIE = "mik_view_as";
export const VIEW_AS_SECONDS = 60 * 60;

function signature(adminId: string, ownerId: string, expires: number) {
  const secret = process.env.BETTER_AUTH_SECRET || "";
  return createHmac("sha256", secret).update(`view-as:${adminId}:${ownerId}:${expires}`).digest("base64url");
}

export function signViewAs(adminId: string, ownerId: string) {
  const expires = Date.now() + VIEW_AS_SECONDS * 1000;
  return `${ownerId}.${expires}.${signature(adminId, ownerId, expires)}`;
}

/** The business id in a valid, unexpired cookie for this admin, else null. */
export function readViewAs(value: string | undefined, adminId: string): string | null {
  if (!value || !process.env.BETTER_AUTH_SECRET) return null;
  const [ownerId, expiresText, sig] = value.split(".");
  const expires = Number(expiresText);
  if (!ownerId || !sig || !Number.isFinite(expires) || expires < Date.now()) return null;
  const wanted = Buffer.from(signature(adminId, ownerId, expires));
  const given = Buffer.from(sig);
  return wanted.length === given.length && timingSafeEqual(wanted, given) ? ownerId : null;
}
