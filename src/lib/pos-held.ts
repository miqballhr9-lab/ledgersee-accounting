"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Sales put on hold at the till: a customer goes back for one more thing while
 * the next one is served. Held sales live in this browser only (the till's own
 * device) and are not records yet: nothing reaches the books, stock or reports
 * until the sale is resumed and completed.
 */
export interface HeldLine {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  serials?: string[];
}

export interface HeldSale {
  id: string;
  at: string;
  customer: string;
  customerName: string;
  lines: HeldLine[];
  discount: string;
  taxId: string;
  warehouse: string;
}

const CHANGED = "mikledger-pos-held";
const keyFor = (businessId: string) => `mikledger-pos-held-${businessId}`;

function read(businessId: string) {
  try {
    return window.localStorage.getItem(keyFor(businessId)) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The held sales of this business on this device, and a way to change them. */
export function useHeldSales(businessId: string) {
  const raw = useSyncExternalStore(subscribe, () => read(businessId), () => "[]");
  const held = useMemo<HeldSale[]>(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as HeldSale[]) : [];
    } catch {
      return [];
    }
  }, [raw]);
  const save = (next: HeldSale[]) => {
    try {
      window.localStorage.setItem(keyFor(businessId), JSON.stringify(next));
    } catch {
      // Storage full or blocked: the sale simply isn't held.
      throw new Error("This browser couldn't keep the held sale. Finish it now instead.");
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return { held, save };
}
