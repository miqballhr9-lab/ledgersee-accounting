"use client";

import { useState } from "react";
import { Eye, X } from "lucide-react";

import { stopViewAs } from "@/app/admin-actions";
import { Button } from "@/components/ui/button";

/** The strip shown while a Super Admin looks at someone else's business. */
export default function ViewAsBar({ business }: { business: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-950 sm:px-7 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100" role="status">
      <span className="flex items-center gap-2"><Eye size={15} />Viewing <strong className="font-semibold">{business}</strong> as Super Admin. Read-only: nothing can be changed.</span>
      <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-background" disabled={leaving} onClick={async () => {
        setLeaving(true);
        await stopViewAs().catch(() => undefined);
        window.location.assign("/admin");
      }}><X size={14} />{leaving ? "Closing…" : "Exit view"}</Button>
    </div>
  );
}
