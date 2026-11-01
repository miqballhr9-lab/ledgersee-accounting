"use server";

import { requireUser } from "@/lib/auth";

/**
 * Today's market rate: how many of the home currency one unit of `from` buys, for a new
 * foreign-currency document to start from. Cached for six hours; "" when it can't be fetched,
 * and the person types the rate their bank gave them.
 */
export async function marketExchangeRate(from: string, to: string): Promise<string> {
  await requireUser();
  const pair = [from, to].map((code) => code.trim().toUpperCase());
  if (pair.some((code) => !/^[A-Z]{3}$/.test(code)) || pair[0] === pair[1]) return "";
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${pair[0]}`, { next: { revalidate: 6 * 60 * 60 }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return "";
    const body = (await response.json()) as { result?: string; rates?: Record<string, number> };
    const rate = body.result === "success" ? body.rates?.[pair[1]] : undefined;
    return rate && Number.isFinite(rate) && rate > 0 ? String(Math.round(rate * 10000) / 10000) : "";
  } catch {
    return "";
  }
}
