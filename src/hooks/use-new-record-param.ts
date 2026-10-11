"use client";

import { useEffect, useEffectEvent } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Opens a workspace's "new record" form when the page is reached with `?new=1`
 * (dashboard shortcuts and quick search link there), then removes the flag so a
 * refresh or the back button does not reopen the form.
 */
export function useNewRecordParam(openNew: () => void) {
  const router = useRouter();
  const pathname = usePathname();
  const onNew = useEffectEvent(openNew);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    params.delete("new");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    onNew();
  }, [pathname, router]);
}
