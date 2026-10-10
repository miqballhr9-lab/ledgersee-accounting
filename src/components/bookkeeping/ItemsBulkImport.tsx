"use client";

import { useRef, useState } from "react";
import { ArrowDownToLine, FileSpreadsheet, FileUp } from "lucide-react";

import { importBookkeepingItems } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { MAX_ITEM_IMPORT_FILE_BYTES, MAX_ITEM_IMPORT_ROWS, type ItemImportData, type ItemImportRow } from "@/lib/item-import";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface ItemsBulkImportProps {
  onImported: (records: BookkeepingRecord[]) => void;
}

const templateHeaders = ["Name", "SKU", "Type", "Rate", "Unit", "Tax Rate (%)", "Unit Cost", "Reorder Point"];

const headerAliases: Record<keyof ItemImportData, string[]> = {
  name: ["name", "itemname", "productname", "servicename"],
  sku: ["sku", "itemsku", "productsku"],
  itemType: ["type", "itemtype"],
  rate: ["rate", "salesrate", "price"],
  unit: ["unit", "unitofmeasure"],
  taxRate: ["taxrate", "taxratepercent", "taxpercent"],
  cost: ["unitcost", "cost", "purchasecost"],
  reorderPoint: ["reorderpoint", "reorderlevel", "minimumstock"],
};

function cellText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function normalizedHeader(value: unknown) {
  return cellText(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function createTemplateWorkbook(XLSX: typeof import("xlsx")) {
  const workbook = XLSX.utils.book_new();
  const itemSheet = XLSX.utils.aoa_to_sheet([templateHeaders]);
  itemSheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }];
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["Items & services import"],
    ["Add one Product or Service per row on the Items sheet."],
    ["Name and Rate are required. Leave Type blank to import the row as a Product."],
    ["Type must be Product or Service. Rates, tax, unit cost, and reorder point must be zero or greater."],
    ["SKUs must be unique in this sheet and cannot already exist in your catalog."],
    [`Import up to ${MAX_ITEM_IMPORT_ROWS} rows per workbook. Keep the Items sheet column headers unchanged.`],
  ]);
  instructionsSheet["!cols"] = [{ wch: 112 }];
  XLSX.utils.book_append_sheet(workbook, itemSheet, "Items");
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");
  return workbook;
}

export default function ItemsBulkImport({ onImported }: ItemsBulkImportProps) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function downloadTemplate() {
    setErrors([]);
    try {
      const XLSX = await import("xlsx");
      XLSX.writeFile(createTemplateWorkbook(XLSX), "mikledger-items-template.xlsx");
    } catch {
      setErrors(["We couldn’t create the Excel template. Please try again."]);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setErrors([]);
    setIsBusy(true);

    try {
      if (file.size > MAX_ITEM_IMPORT_FILE_BYTES) throw new Error("Choose an Excel file smaller than 5 MB.");
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets.Items ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("This workbook doesn’t contain an Items sheet.");

      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", blankrows: true, raw: false });
      if (sheetRows.length < 2) throw new Error("Add at least one item below the column headers before importing.");

      const headerIndexes: Partial<Record<keyof ItemImportData, number>> = {};
      const firstRow = sheetRows[0] ?? [];
      for (const [index, value] of firstRow.entries()) {
        const normalized = normalizedHeader(value);
        for (const [key, aliases] of Object.entries(headerAliases) as [keyof ItemImportData, string[]][]) {
          if (aliases.includes(normalized)) headerIndexes[key] = index;
        }
      }
      if (headerIndexes.name === undefined || headerIndexes.rate === undefined) {
        throw new Error("The sheet needs Name and Rate columns. Download the template to get the correct format.");
      }

      const importedRows: ItemImportRow[] = [];
      const rowErrors: string[] = [];
      const uploadedSkus = new Set<string>();
      for (const [index, cells] of sheetRows.slice(1).entries()) {
        if (!cells.some((cell) => cellText(cell))) continue;
        const rowNumber = index + 2;
        const readField = (key: keyof ItemImportData) => {
          const column = headerIndexes[key];
          return column === undefined ? "" : cellText(cells[column]);
        };
        const rawType = readField("itemType");
        const itemType = rawType ? rawType.toLocaleLowerCase() : "Product";
        const data: ItemImportData = {
          name: readField("name"),
          sku: readField("sku"),
          itemType: itemType === "product" ? "Product" : itemType === "service" ? "Service" : rawType,
          rate: readField("rate"),
          unit: readField("unit"),
          taxRate: readField("taxRate"),
          cost: readField("cost"),
          reorderPoint: readField("reorderPoint"),
        };

        for (const key of Object.keys(data) as (keyof ItemImportData)[]) {
          if (data[key].length > 250) rowErrors.push(`Row ${rowNumber}: ${key} must be 250 characters or fewer.`);
        }
        if (!data.name) rowErrors.push(`Row ${rowNumber}: add a name.`);
        if (data.itemType !== "Product" && data.itemType !== "Service") rowErrors.push(`Row ${rowNumber}: Type must be Product or Service.`);
        for (const [key, label] of [["rate", "rate"], ["taxRate", "tax rate"], ["cost", "unit cost"], ["reorderPoint", "reorder point"]] as const) {
          const value = data[key];
          if (!value && key !== "rate") continue;
          const amount = Number(value);
          if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) rowErrors.push(`Row ${rowNumber}: enter a valid non-negative ${label}.`);
        }

        const skuKey = data.sku.toLocaleLowerCase();
        if (skuKey && uploadedSkus.has(skuKey)) rowErrors.push(`Row ${rowNumber}: SKU ${data.sku} is repeated in this sheet.`);
        if (skuKey) uploadedSkus.add(skuKey);
        importedRows.push({ rowNumber, data });
      }

      if (importedRows.length === 0) throw new Error("Add at least one item below the column headers before importing.");
      if (importedRows.length > MAX_ITEM_IMPORT_ROWS) throw new Error(`Import up to ${MAX_ITEM_IMPORT_ROWS} item rows at a time.`);
      if (rowErrors.length > 0) {
        const shownErrors = rowErrors.slice(0, 8);
        if (rowErrors.length > shownErrors.length) shownErrors.push(`And ${rowErrors.length - shownErrors.length} more issues.`);
        setErrors(shownErrors);
        return;
      }

      const created = await importBookkeepingItems(importedRows);
      onImported(created);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "We couldn’t import this Excel file. Check the template and try again."]);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input
        ref={uploadRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="sr-only"
        aria-label="Upload an Excel item template"
        onChange={(event) => {
          void importFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <Button type="button" variant="outline" className="gap-2" onClick={() => void downloadTemplate()} disabled={isBusy}>
        <ArrowDownToLine size={15} />Excel template
      </Button>
      <Button type="button" variant="outline" className="gap-2" onClick={() => uploadRef.current?.click()} disabled={isBusy}>
        {isBusy ? <FileSpreadsheet size={15} /> : <FileUp size={15} />}{isBusy ? "Importing…" : "Import Excel"}
      </Button>
      {errors.length > 0 ? (
        <div className="basis-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <p className="font-medium">The workbook needs a few changes:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
