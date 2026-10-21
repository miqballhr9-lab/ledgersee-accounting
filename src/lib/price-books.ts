import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

/**
 * Zoho's price books: a named list of special prices for some items, given to
 * a customer. A flat book has one price per item; a differential book has a
 * price for each quantity range (1–9 at 100, 10 or more at 90).
 */
export interface PriceBookEntry {
  itemId: string;
  item: string;
  /** Differential books only: the range this price is for. Empty means open-ended. */
  fromQuantity: string;
  toQuantity: string;
  listPrice: string;
}

export function readPriceBookEntries(value: string | undefined): PriceBookEntry[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : typeof row[key] === "number" ? String(row[key]) : "");
      return [{ itemId: text("itemId"), item: text("item"), fromQuantity: text("fromQuantity"), toQuantity: text("toQuantity"), listPrice: text("listPrice") }];
    });
  } catch {
    return [];
  }
}

/** The customer's active price book, picked on the customer by name. */
export function customerPriceBook(customer: BookkeepingRecord | undefined, books: BookkeepingRecord[]) {
  const name = customer?.data.priceBook?.trim().toLowerCase();
  if (!name) return undefined;
  return books.find((book) => book.data.priceBookName?.trim().toLowerCase() === name && book.data.status !== "Inactive");
}

/** The price a book sets for an item at a quantity, or undefined when the book doesn't list it. */
export function priceBookPrice(book: BookkeepingRecord | undefined, itemId: string, quantity: number): number | undefined {
  if (!book || !itemId) return undefined;
  const entries = readPriceBookEntries(book.data.entries).filter((entry) => entry.itemId === itemId && entry.listPrice !== "");
  if (!entries.length) return undefined;
  if (book.data.pricingModel !== "Differential") return Number(entries[0].listPrice) || 0;
  const qty = quantity > 0 ? quantity : 1;
  const match = entries.find((entry) => (entry.fromQuantity === "" || qty >= Number(entry.fromQuantity)) && (entry.toQuantity === "" || qty <= Number(entry.toQuantity)));
  return match ? Number(match.listPrice) || 0 : undefined;
}

/** Names of the active price books, for the customer's Price book field. */
export function activePriceBookNames(books: BookkeepingRecord[] | undefined) {
  return (books ?? []).filter((book) => book.data.status !== "Inactive").map((book) => book.data.priceBookName?.trim() ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b));
}
