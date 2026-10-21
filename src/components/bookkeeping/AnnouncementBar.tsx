"use client";

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";

/** The platform's announcement across the top of the app; closing it hides this one for this browser. */
export default function AnnouncementBar({ id, message, tone }: { id: string; message: string; tone: "info" | "warning" }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let closed = false;
    try {
      closed = localStorage.getItem("mik-announcement-closed") === id;
    } catch {
      // Storage can be blocked; the strip then simply shows.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount, as storage isn't there on the server
    setHidden(closed);
  }, [id]);
  if (hidden) return null;
  return (
    <div role="status" className={`flex items-start justify-between gap-3 border-b px-4 py-2 text-sm sm:px-7 ${tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" : "border-primary/20 bg-primary/5 text-foreground"}`}>
      <span className="flex min-w-0 items-start gap-2"><Megaphone size={15} className="mt-0.5 shrink-0" /><span>{message}</span></span>
      <button type="button" aria-label="Close announcement" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => { setHidden(true); try { localStorage.setItem("mik-announcement-closed", id); } catch { /* not kept */ } }}><X size={15} /></button>
    </div>
  );
}
