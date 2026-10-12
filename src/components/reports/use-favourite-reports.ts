"use client";

import { useCallback, useSyncExternalStore } from "react";

import { defaultFavourites } from "@/lib/report-catalog";

const storageKey = "mik-ledger:favourite-reports";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cache = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : defaultFavourites;
  } catch {
    cache = defaultFavourites;
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starred reports, kept in this browser. */
export function useFavouriteReports() {
  const favourites = useSyncExternalStore(subscribe, read, () => defaultFavourites);
  const toggle = useCallback((key: string) => {
    const current = read();
    cache = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // Favourites still work for this visit when storage is blocked.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { favourites, toggle };
}
