"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, History, MoreHorizontal, Package, PackageX, Search } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { createInventoryMovement } from "@/app/actions";
import InventoryBulkCount from "@/components/bookkeeping/InventoryBulkCount";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { InventoryEvent } from "@/lib/inventory";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MovementType = "Receipt" | "Delivery" | "Adjustment";

export interface InventoryStock {
  onHand: number;
  value: number;
  averageCost: number;
}

interface InventoryWorkspaceProps {
  /** Inventory items, with stock set to the quantity on hand worked out from documents. */
  products: BookkeepingRecord[];
  stock: Record<string, InventoryStock>;
  /** Every stock movement: invoices, credit notes, bills, receipts and adjustments, newest first. */
  activity: (InventoryEvent & { itemName: string; unit: string })[];
  currency: string;
  /** Warehouse names; with more than one, stock shows by warehouse and movements ask where. */
  warehouses?: string[];
  /** Quantity on hand per warehouse, by item id. */
  byWarehouse?: Record<string, Record<string, number>>;
}

const sourceSlug: Record<string, string> = { invoices: "invoices", "credit-notes": "credit-notes", bills: "bills", expenses: "expenses", "supplier-credits": "supplier-credits", "purchase-orders": "purchase-orders", items: "items" };

const movementActions: { type: MovementType; label: string; icon: typeof ArrowDownToLine; variant: "default" | "outline" }[] = [
  { type: "Receipt", label: "Receive stock", icon: ArrowDownToLine, variant: "default" },
  { type: "Delivery", label: "Record delivery", icon: ArrowUpFromLine, variant: "outline" },
  { type: "Adjustment", label: "Count stock", icon: ClipboardCheck, variant: "outline" },
];

function formatQuantity(value: number, unit?: string) {
  const quantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  return unit ? `${quantity} ${unit}` : quantity;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export default function InventoryWorkspace({ products: productRecords, stock: stockById, activity, currency, warehouses = [], byWarehouse = {} }: InventoryWorkspaceProps) {
  const router = useRouter();
  const products = useMemo(
    () => [...productRecords].sort((left, right) => (left.data.name || "").localeCompare(right.data.name || "")),
    [productRecords],
  );
  const [activeView, setActiveView] = useState<"products" | "movements">("products");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [unitCost, setUnitCost] = useState("");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [movementType, setMovementType] = useState<MovementType>("Receipt");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [serials, setSerials] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const stockDetails = useMemo(() => products.map((product) => {
    const summary = stockById[product.id] ?? { onHand: 0, value: 0, averageCost: Number(product.data.cost || 0) || 0 };
    const reorderPoint = Number(product.data.reorderPoint || 0);
    return { product, stock: summary.onHand, reorderPoint: Number.isFinite(reorderPoint) ? reorderPoint : 0, value: summary.value, averageCost: summary.averageCost };
  }), [products, stockById]);
  const isOut = (row: { stock: number }) => row.stock <= 0;
  const isLow = (row: { stock: number; reorderPoint: number }) => row.stock > 0 && row.reorderPoint > 0 && row.stock <= row.reorderPoint;
  const lowStockCount = stockDetails.filter(isLow).length;
  const outOfStockCount = stockDetails.filter(isOut).length;
  const totalUnits = stockDetails.reduce((total, row) => total + row.stock, 0);
  const totalValue = stockDetails.reduce((total, row) => total + row.value, 0);
  const visibleProducts = stockDetails.filter((row) => {
    const matchesSearch = `${row.product.data.name || ""} ${row.product.data.sku || ""}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStock = stockFilter === "all" || (stockFilter === "low" ? isLow(row) : isOut(row));
    return matchesSearch && matchesStock;
  });
  const selectedProduct = products.find((product) => product.id === selectedItemId);

  function openMovement(type: MovementType, itemId = "") {
    setMovementType(type);
    setSelectedItemId(itemId || products[0]?.id || "");
    setQuantity("");
    setMovementDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setNotes("");
    setUnitCost("");
    setWarehouse(warehouses[0] ?? "");
    setSerials("");
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setIsSaving(true);
    try {
      await createInventoryMovement({
        itemId: selectedItemId,
        movementType,
        quantity,
        date: movementDate,
        reference,
        notes,
        unitCost: movementType === "Receipt" ? unitCost : undefined,
        warehouse,
        serials,
      });
      setDialogOpen(false);
      toast.success(movementType === "Receipt" ? "Stock received." : movementType === "Delivery" ? "Delivery recorded." : "Stock count saved.");
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? readableError(error) : "We couldn’t save this stock movement.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 xl:px-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Inventory / Stock control</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Inventory</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Stock goes down when you invoice and up when you enter bills or receive purchase orders. Cost of goods sold is worked out first-in, first-out.</p>
        </div>
        <div className="flex flex-wrap gap-2 xl:shrink-0 xl:flex-nowrap xl:justify-end">
          <InventoryBulkCount products={products} onHand={Object.fromEntries(Object.entries(stockById).map(([id, summary]) => [id, summary.onHand]))} />
          {[...movementActions].sort((a, b) => Number(a.variant === "default") - Number(b.variant === "default")).map(({ type, label, icon: Icon, variant }) => (
            <Button key={type} type="button" variant={variant} disabled={!products.length} onClick={() => openMovement(type)}>
              <Icon size={16} strokeWidth={1.8} />
              {label}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          { label: "Inventory items", value: String(products.length), icon: Package, tone: "bg-accent text-accent-foreground", filter: "all" as const },
          { label: "Units on hand", value: formatQuantity(totalUnits), icon: Boxes, tone: "bg-accent text-accent-foreground", filter: null },
          { label: "Low stock", value: String(lowStockCount), icon: AlertTriangle, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300", filter: "low" as const },
          { label: "Out of stock", value: String(outOfStockCount), icon: PackageX, tone: "bg-destructive/10 text-destructive", filter: "out" as const },
          { label: "Inventory value (FIFO)", value: formatMoney(totalValue, currency), icon: History, tone: "bg-accent text-accent-foreground", filter: null },
        ]).map((tile) => (
          <Card key={tile.label} className={tile.filter ? `cursor-pointer transition-colors hover:border-primary/40 ${stockFilter === tile.filter && activeView === "products" ? "border-primary/60" : ""}` : ""} onClick={tile.filter ? () => { setActiveView("products"); setStockFilter(tile.filter!); } : undefined}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className={`grid size-10 shrink-0 place-items-center rounded-md ${tile.tone}`}><tile.icon size={18} /></span>
              <div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{tile.label}</p><p className="mt-1 truncate text-xl font-semibold tabular-nums">{tile.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button type="button" variant={activeView === "products" ? "secondary" : "ghost"} aria-pressed={activeView === "products"} onClick={() => setActiveView("products")}>Products</Button>
            <Button type="button" variant={activeView === "movements" ? "secondary" : "ghost"} aria-pressed={activeView === "movements"} onClick={() => setActiveView("movements")}>Stock activity <span className="ml-1 tabular-nums">{activity.length}</span></Button>
          </div>
          {activeView === "products" ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU" className="pl-9" aria-label="Search inventory products" />
              </div>
              {([["all", "All"], ["low", "Low stock"], ["out", "Out of stock"]] as const).map(([value, label]) => (
                <Button key={value} type="button" variant={stockFilter === value ? "secondary" : "outline"} aria-pressed={stockFilter === value} onClick={() => setStockFilter(value)}>{label}</Button>
              ))}
            </div>
          ) : null}
        </div>

        {activeView === "products" ? (
          products.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qty on hand</TableHead><TableHead className="text-right">Reorder point</TableHead><TableHead className="text-right">Avg cost</TableHead><TableHead className="text-right">Asset value</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visibleProducts.length ? visibleProducts.map((row) => {
                    const { product, stock, reorderPoint, value, averageCost } = row;
                    return (
                      <TableRow key={product.id}>
                        <TableCell className="min-w-48 font-medium"><Link href={`/app/items?open=${product.id}`} className="text-primary hover:underline">{product.data.name || "Unnamed product"}</Link><div className="mt-1 text-xs font-normal text-muted-foreground">{product.data.unit || "Unit not set"}</div>{warehouses.length > 1 && byWarehouse[product.id] ? <div className="mt-1 text-xs font-normal text-muted-foreground">{Object.entries(byWarehouse[product.id]).filter(([, qty]) => qty).map(([place, qty]) => `${place}: ${formatQuantity(qty)}`).join(" · ") || "Nothing in any warehouse"}</div> : null}</TableCell>
                        <TableCell className="text-muted-foreground">{product.data.sku || "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatQuantity(stock, product.data.unit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{reorderPoint > 0 ? formatQuantity(reorderPoint) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(averageCost, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(value, currency)}</TableCell>
                        <TableCell>{isOut(row) ? <Badge variant="destructive">Out of stock</Badge> : isLow(row) ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Low stock</Badge> : <Badge variant="secondary">In stock</Badge>}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${product.data.name || "item"}`}><MoreHorizontal size={15} /></Button>} />
                            <DropdownMenuContent align="end" className="min-w-48">
                              <DropdownMenuItem onClick={() => openMovement("Adjustment", product.id)}><ClipboardCheck size={14} />Adjust quantity</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openMovement("Receipt", product.id)}><ArrowDownToLine size={14} />Receive stock</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openMovement("Delivery", product.id)}><ArrowUpFromLine size={14} />Record delivery</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => router.push("/app/purchase-orders?new=1")}><Package size={14} />Reorder (new purchase order)</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push("/app/reports/inventory-valuation-detail")}><History size={14} />Run valuation report</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  }) : <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No products match this view.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground"><Package size={22} /></div>
              <h2 className="mt-4 font-semibold">Add inventory items to start tracking stock</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Items with the type Inventory appear here, with their initial quantity. Invoices then take stock out and bills bring it in.</p>
              <Button nativeButton={false} render={<Link href="/app/items" />} className="mt-5">Open Items & services</Button>
            </div>
          )
        ) : (
          activity.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Transaction</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Qty on hand</TableHead><TableHead className="text-right">Asset value</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {activity.map((event, index) => {
                    const slug = sourceSlug[event.sourceKind];
                    const id = event.sourceId.split("#")[0];
                    return (
                      <TableRow key={`${event.sourceId}-${index}`} className={slug ? "cursor-pointer" : undefined} onClick={slug ? () => router.push(`/app/${slug}?open=${id}`) : undefined}>
                        <TableCell className="whitespace-nowrap">{formatDate(event.date)}</TableCell>
                        <TableCell className="min-w-40 font-medium">{event.itemName}</TableCell>
                        <TableCell><span className="text-primary">{event.type}</span>{event.number ? <span className="text-muted-foreground"> · {event.number}</span> : null}</TableCell>
                        <TableCell className="max-w-48 truncate text-muted-foreground">{event.name || "—"}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${event.quantity > 0 ? "text-primary" : "text-destructive"}`}>{event.quantity > 0 ? "+" : ""}{formatQuantity(event.quantity, event.unit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(Math.abs(event.value), currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQuantity(event.onHand)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(event.assetValue, currency)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground"><History size={22} /></div>
              <h2 className="mt-4 font-semibold">No stock activity yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">Invoices, bills, received purchase orders and adjustments will appear here.</p>
            </div>
          )
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{movementType === "Receipt" ? "Receive stock" : movementType === "Delivery" ? "Record delivery" : "Inventory quantity adjustment"}</DialogTitle>
            <DialogDescription>{movementType === "Receipt" ? "For stock that arrived without a bill or purchase order. Bought stock is better entered as a bill with the item on it." : movementType === "Delivery" ? "For stock that left without an invoice (samples, own use). Invoices take stock out on their own." : "Enter the quantity you counted. The difference is booked to Inventory Shrinkage."}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="inventory-product">Product</Label>
              <Select value={selectedItemId} onValueChange={(value) => setSelectedItemId(value || "")}>
                <SelectTrigger id="inventory-product" aria-label="Choose product"><SelectValue placeholder="Choose a product" /></SelectTrigger>
                <SelectContent>
                  {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.data.name || "Unnamed product"}{product.data.sku ? ` · ${product.data.sku}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedProduct ? <p className="text-xs text-muted-foreground">Quantity on hand: {formatQuantity(stockById[selectedProduct.id]?.onHand ?? 0, selectedProduct.data.unit)}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inventory-quantity">{movementType === "Adjustment" ? "Counted quantity" : "Quantity"}</Label>
                <Input id="inventory-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" />
              </div>
              {movementType === "Receipt" ? (
                <div className="space-y-2">
                  <Label htmlFor="inventory-cost">Cost per unit</Label>
                  <Input id="inventory-cost" type="number" min="0" step="any" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder={selectedProduct?.data.cost ? `Purchase cost ${selectedProduct.data.cost}` : "Item’s purchase cost"} />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="inventory-date">Date</Label>
                <Input id="inventory-date" type="date" required value={movementDate} onChange={(event) => setMovementDate(event.target.value)} />
              </div>
            </div>
            {warehouses.length ? (
              <div className="space-y-2">
                <Label htmlFor="inventory-warehouse">Warehouse</Label>
                <Select value={warehouse || null} onValueChange={(value) => setWarehouse(String(value ?? ""))}>
                  <SelectTrigger id="inventory-warehouse" className="w-full"><SelectValue placeholder="Choose a warehouse" /></SelectTrigger>
                  <SelectContent>{warehouses.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            {selectedProduct?.data.tracking === "Lot" || selectedProduct?.data.tracking === "Serial number" ? (
              <div className="space-y-2">
                <Label htmlFor="inventory-serials">{selectedProduct.data.tracking === "Lot" ? "Lot number" : "Serial numbers"}</Label>
                <Input id="inventory-serials" value={serials} onChange={(event) => setSerials(event.target.value)} placeholder={selectedProduct.data.tracking === "Lot" ? "e.g. LOT-2026-10" : "Comma separated, one per unit"} />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="inventory-reference">Reference</Label>
              <Input id="inventory-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder={movementType === "Receipt" ? "Supplier or purchase order" : movementType === "Delivery" ? "Customer or sales order" : "Count reference"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-notes">Notes</Label>
              <Input id="inventory-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional details" />
            </div>
            {formError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving || !products.length}>{isSaving ? "Saving…" : movementType === "Receipt" ? "Receive stock" : movementType === "Delivery" ? "Record delivery" : "Save count"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
