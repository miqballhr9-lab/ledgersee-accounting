import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { revalidatePath as nextRevalidatePath } from "next/cache";

/**
 * Due automation rules run while the app layout renders, and Next.js throws if
 * revalidatePath is called during a render. Inside that run, saving a record
 * skips revalidation (the page being rendered already reads fresh data); every
 * other save revalidates exactly as before.
 */
const duringAutomation = new AsyncLocalStorage<true>();

export function withoutRevalidation<T>(work: () => Promise<T>): Promise<T> {
  return duringAutomation.run(true, work);
}

export function revalidatePath(...args: Parameters<typeof nextRevalidatePath>) {
  if (duringAutomation.getStore()) return;
  nextRevalidatePath(...args);
}
