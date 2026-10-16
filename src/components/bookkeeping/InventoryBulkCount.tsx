"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, FileSpreadsheet, FileUp } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { saveBulkInventoryCount } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_INVENTORY_COUNT_FILE_BYTES, MAX_INVENTORY_COUNT_ROWS, type InventoryCountRow } from "@/lib/inventory-import";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface InventoryBulkCountProps {
  products: BookkeepingRecord[];
  /** Quantity on hand by item id, from the inventory ledger. */
  onHand?: Record<string, number>;
}

interface PreviewCount extends InventoryCountRow {
  rowNumber: number;
  name: string;
  sku: string;
  currentStock: number;
  unit: string;
}

const templateHeaders = ["Product ID", "SKU", "Product", "Current stock", "Counted stock", "Unit"];
const itemIdAliases = ["productid", "itemid", "id"];
const countAliases = ["countedstock", "countedquantity", "countedqty", "quantitycounted", "physicalcount", "physicalcountquantity", "actualquantity", "stockcount", "count"];

function normalizeHeader(value: unknown) {
  return String(value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryBulkCount({ products, onHand = {} }: InventoryBulkCountProps) {
  // Quantity on hand worked out from every sale, purchase and movement, not the item's saved figure.
  const stockOf = (product: BookkeepingRecord) => onHand[product.id] ?? Number(product.data.stock || 0);
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewCount[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [countDate, setCountDate] = useState("");
  const [reference, setReference] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const adjustmentCount = preview.filter((row) => Number(row.quantity) !== row.currentStock).length;

  async function downloadTemplate() {
    try {
      const XLSX = await import("xlsx");
      const rows = [
        templateHeaders,
        ...products.map((product) => [
          product.id,
          product.data.sku || "",
          product.data.name || "Unnamed product",
          stockOf(product),
          "",
          product.data.unit || "",
        ]),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!cols"] = [{ wch: 38 }, { wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Count");
      XLSX.writeFile(workbook, "mikledger-stock-count.xlsx");
    } catch {
      toast.error("We couldn’t prepare the stock count sheet. Please try again.");
    }
  }

  async function parseFile(file: File) {
    setIsBusy(true);
    setErrors([]);
    setPreview([]);
    setFileName(file.name);
    setReference("");
    setCountDate(today());

    try {
      if (file.size > MAX_INVENTORY_COUNT_FILE_BYTES) throw new Error("Choose an Excel file smaller than 5 MB.");
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets["Stock Count"] ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("This workbook doesn’t contain a stock count sheet.");

      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", blankrows: false, raw: false });
      if (sheetRows.length < 2) throw new Error("Fill in at least one counted quantity below the column headers.");

      const headers = sheetRows[0] ?? [];
      const itemIdColumn = headers.findIndex((value) => itemIdAliases.includes(normalizeHeader(value)));
      const countColumn = headers.findIndex((value) => countAliases.includes(normalizeHeader(value)));
      if (itemIdColumn < 0 || countColumn < 0) {
        throw new Error("Keep the Product ID column and a Counted stock column in the worksheet.");
      }

      const productsById = new Map(products.map((product) => [product.id, product]));
      const imported: PreviewCount[] = [];
      const rowErrors: string[] = [];
      const seenIds = new Set<string>();

      for (const [index, cells] of sheetRows.slice(1).entries()) {
        const rowNumber = index + 2;
        const itemId = cellText(cells[itemIdColumn]);
        const quantityText = cellText(cells[countColumn]);
        if (!itemId && !quantityText) continue;
        if (!quantityText) continue;
        if (!itemId) {
          rowErrors.push(`Row ${rowNumber}: Product ID is missing.`);
          continue;
        }
        const product = productsById.get(itemId);
        if (!product) {
          rowErrors.push(`Row ${rowNumber}: this Product ID isn’t in the current inventory. Download a fresh template.`);
          continue;
        }
        const quantity = Number(quantityText);
        if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000_000_000) {
          rowErrors.push(`Row ${rowNumber}: enter a valid non-negative counted stock quantity.`);
          continue;
        }
        if (seenIds.has(itemId)) {
          rowErrors.push(`Row ${rowNumber}: ${product.data.name || "This product"} appears more than once.`);
          continue;
        }
        seenIds.add(itemId);
        imported.push({
          itemId,
          quantity: String(quantity),
          rowNumber,
          name: product.data.name || "Unnamed product",
          sku: product.data.sku || "—",
          currentStock: stockOf(product),
          unit: product.data.unit || "",
        });
      }

      if (imported.length > MAX_INVENTORY_COUNT_ROWS) {
        rowErrors.push(`Import up to ${MAX_INVENTORY_COUNT_ROWS} counted products at a time.`);
      }
      if (imported.length === 0 && rowErrors.length === 0) {
        rowErrors.push("Add at least one counted quantity to the worksheet before importing.");
      }
      setPreview(imported.slice(0, MAX_INVENTORY_COUNT_ROWS));
      setErrors(rowErrors.length > 8 ? [...rowErrors.slice(0, 8), `And ${rowErrors.length - 8} more issues.`] : rowErrors);
      setDialogOpen(true);
    } catch (error) {
      setErrors([error instanceof Error ? readableError(error) : "We couldn’t read this Excel file. Check the template and try again."]);
      setDialogOpen(true);
    } finally {
      setIsBusy(false);
    }
  }

  async function applyCount() {
    if (preview.length === 0 || errors.length > 0) return;
    setIsBusy(true);
    setErrors([]);
    try {
      const result = await saveBulkInventoryCount({
        rows: preview.map(({ itemId, quantity }) => ({ itemId, quantity })),
        date: countDate,
        reference,
      });
      setDialogOpen(false);
      toast.success(result.adjustedCount === 0
        ? `${result.checkedCount} products checked; stock already matched.`
        : `${result.checkedCount} products checked; ${result.adjustedCount} stock adjustments saved.`);
      router.refresh();
    } catch (error) {
      setErrors([error instanceof Error ? readableError(error) : "We couldn’t save this stock count."]);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      <input
        ref={uploadRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="sr-only"
        aria-label="Upload a completed stock count spreadsheet"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void parseFile(file);
          event.currentTarget.value = "";
        }}
      />
      <Button type="button" variant="outline" className="gap-2" disabled={isBusy || products.length === 0} onClick={() => void downloadTemplate()}>
        <ArrowDownToLine size={15} />Count template
      </Button>
      <Button type="button" variant="outline" className="gap-2" disabled={isBusy || products.length === 0} onClick={() => uploadRef.current?.click()}>
        {isBusy ? <FileSpreadsheet size={15} /> : <FileUp size={15} />}{isBusy ? "Reading…" : "Upload count"}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isBusy) setDialogOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review stock count</DialogTitle>
            <DialogDescription>
              {fileName ? `${fileName} · ` : ""}Fill the Counted stock column in the downloaded sheet. Leave uncounted products blank; keep Product IDs unchanged.
            </DialogDescription>
          </DialogHeader>

          {preview.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bulk-count-date">Count date</Label>
                  <Input id="bulk-count-date" type="date" value={countDate} onChange={(event) => setCountDate(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-count-reference">Reference</Label>
                  <Input id="bulk-count-reference" value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} placeholder="Optional count reference" />
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium tabular-nums">{preview.length}</span> products ready to check; <span className="font-medium tabular-nums">{adjustmentCount}</span> quantities will change. Only changed quantities create a history entry.
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Saved</TableHead><TableHead>Counted</TableHead><TableHead>Change</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {preview.slice(0, 8).map((row) => (
                      <TableRow key={row.itemId}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-muted-foreground">{row.sku}</TableCell>
                        <TableCell className="tabular-nums">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(row.currentStock)}{row.unit ? ` ${row.unit}` : ""}</TableCell>
                        <TableCell className="tabular-nums">{row.quantity}{row.unit ? ` ${row.unit}` : ""}</TableCell>
                        <TableCell className={`font-medium tabular-nums ${Number(row.quantity) > row.currentStock ? "text-primary" : Number(row.quantity) < row.currentStock ? "text-destructive" : "text-muted-foreground"}`}>
                          {Number(row.quantity) > row.currentStock ? "+" : ""}{new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(row.quantity) - row.currentStock)}{row.unit ? ` ${row.unit}` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.length > 8 ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">And {preview.length - 8} more counted products.</p> : null}
              </div>
            </>
          ) : null}

          {errors.length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">Fix these spreadsheet issues before saving:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isBusy} onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="button" disabled={isBusy || preview.length === 0 || errors.length > 0 || !countDate} onClick={() => void applyCount()}>
              {isBusy ? "Saving…" : `Save ${preview.length} product counts`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
