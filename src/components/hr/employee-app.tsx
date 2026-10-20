"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Share } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The time now in the business's time zone, which check ins are recorded in. */
export function BusinessClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  if (!now) return <p className="h-[68px]" />;
  const zone = (options: Intl.DateTimeFormatOptions) => {
    try {
      return now.toLocaleString(undefined, { ...options, timeZone });
    } catch {
      return now.toLocaleString(undefined, options);
    }
  };
  return (
    <div>
      <p className="text-5xl font-light tabular-nums tracking-tight">{zone({ hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
      <p className="mt-1 text-sm text-muted-foreground">{zone({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    </div>
  );
}

/** Where the phone is, when the employee allows it; null if they don't or it takes too long. */
export function currentLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** Refreshes the page's data every so often while it is on screen, so changes made elsewhere show up. */
export function useAutoRefresh(seconds: number) {
  const router = useRouter();
  useEffect(() => {
    if (!seconds) return;
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router, seconds]);
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/**
 * "Install app": adds MIK LEDGER to the phone's home screen so it opens like
 * an app. Android and desktop Chrome install in one tap; on an iPhone it
 * explains Share → Add to Home Screen. Hidden once installed.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const timer = window.setTimeout(() => {
      setInstalled(standalone);
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    }, 0);
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.clearTimeout(timer); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!prompt && !ios)) return null;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { if (prompt) void prompt.prompt().then(() => setPrompt(null)); else setShowHelp((value) => !value); }}><Download size={14} />Install app</Button>
      {showHelp ? <p className="max-w-56 text-right text-xs text-muted-foreground">On iPhone: tap <Share size={12} className="inline" /> Share in Safari, then “Add to Home Screen”.</p> : null}
    </div>
  );
}
