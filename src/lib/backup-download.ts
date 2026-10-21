"use client";

import type { BusinessBackup } from "@/lib/backup";

/** Saves a backup in the browser: an Excel workbook with one sheet per kind of record, or the JSON copy. */
export async function downloadBackup(data: BusinessBackup, format: "xlsx" | "json", name = "mikledger-backup") {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}-${stamp}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["MIK LEDGER backup"], [], ["Business", data.business], ["Exported by", `${data.account.name} <${data.account.email}>`], ["Exported at", data.exportedAt], ["Records", data.records.length],
    [], ["Each sheet holds one kind of record. Line items are kept as text in their own column."],
  ]), "About");
  const byKind = new Map<string, BusinessBackup["records"]>();
  for (const record of data.records) byKind.set(record.kind, [...(byKind.get(record.kind) ?? []), record]);
  const used = new Set<string>(["About"]);
  for (const [kind, records] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = [...new Set(records.flatMap((record) => Object.keys(record.data)))];
    const rows = records.map((record) => [record.id, record.createdAt, record.updatedAt, ...keys.map((key) => String(record.data[key] ?? "").slice(0, 32000))]);
    let sheet = (kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, " ")).replace(/[\\/?*[\]:]/g, "").slice(0, 31);
    for (let n = 2; used.has(sheet); n += 1) sheet = `${sheet.slice(0, 28)} ${n}`;
    used.add(sheet);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Record id", "Created", "Updated", ...keys], ...rows]), sheet);
  }
  XLSX.writeFile(workbook, `${name}-${stamp}.xlsx`);
}
