import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { Role } from "@/lib/permissions";

/**
 * Employee self-service saves a leave, loan or claim request through the HR
 * rules, which need HR rights. The self-service action checks it is the
 * employee's own request first, then runs just that save with HR's role.
 * Nothing a browser sends can set this.
 */
const roleOverride = new AsyncLocalStorage<Role>();

export function runWithRole<T>(role: Role, work: () => Promise<T>): Promise<T> {
  return roleOverride.run(role, work);
}

export function currentRoleOverride(): Role | undefined {
  return roleOverride.getStore();
}
