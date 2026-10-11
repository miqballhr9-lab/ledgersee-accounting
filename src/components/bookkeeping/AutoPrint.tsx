"use client";

import { useEffect } from "react";

/** Opens the browser's print dialog once the page has rendered, for print-preview links. */
export default function AutoPrint() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
