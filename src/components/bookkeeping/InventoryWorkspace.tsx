"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, History, Package, Search } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MovementType = "Receipt" | "Delivery" | "Adjustment";

interface InventoryWorkspaceProps {
  products: BookkeepingRecord[];
  movements: BookkeepingRecord[];
  currency: string;
}

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

export default function InventoryWorkspace({ products: productRecords, movements, currency }: InventoryWorkspaceProps) {
  const router = useRouter();
  const products = useMemo(
    () => productRecords.filter((record) => record.data.itemType === "Product").sort((left, right) => (left.data.name || "").localeCompare(right.data.name || "")),
    [productRecords],
  );
  const [activeView, setActiveView] = useState<"products" | "movements">("products");
  const [stockFilter, setStockFilter] = useState<"all" | "low">("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [movementType, setMovementType] = useState<MovementType>("Receipt");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const stockDetails = useMemo(() => products.map((product) => {
    const stock = Number(product.data.stock || 0);
    const reorderPoint = Number(product.data.reorderPoint || 0);
    const cost = Number(product.data.cost || 0);
    return {
      product,
      stock: Number.isFinite(stock) ? stock : 0,
      reorderPoint: Number.isFinite(reorderPoint) ? reorderPoint : 0,
      value: Number.isFinite(cost) ? Math.max(0, stock) * Math.max(0, cost) : 0,
    };
  }), [products]);
  const lowStockCount = stockDetails.filter((row) => row.reorderPoint > 0 && row.stock <= row.reorderPoint).length;
  const totalUnits = stockDetails.reduce((total, row) => total + row.stock, 0);
  const totalValue = stockDetails.reduce((total, row) => total + row.value, 0);
  const visibleProducts = stockDetails.filter(({ product, stock, reorderPoint }) => {
    const matchesSearch = `${product.data.name || ""} ${product.data.sku || ""}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStock = stockFilter === "all" || (reorderPoint > 0 && stock <= reorderPoint);
    return matchesSearch && matchesStock;
  });
  const selectedProduct = products.find((product) => product.id === selectedItemId);
  const sortedMovements = [...movements].sort((left, right) => `${right.data.date || right.createdAt}`.localeCompare(`${left.data.date || left.createdAt}`));

  function openMovement(type: MovementType, itemId = "") {
    setMovementType(type);
    setSelectedItemId(itemId || products[0]?.id || "");
    setQuantity("");
    setMovementDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setNotes("");
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
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Inventory / Stock control</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Inventory</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Keep product quantities, receipts, deliveries, and counts in sync.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-[60%] lg:justify-end">
          <InventoryBulkCount products={products} />
          {movementActions.map(({ type, label, icon: Icon, variant }) => (
            <Button key={type} type="button" variant={variant} disabled={!products.length} onClick={() => openMovement(type)}>
              <Icon size={16} strokeWidth={1.8} />
              {label}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground"><Package size={18} /></span>
            <div><p className="text-xs text-muted-foreground">Products tracked</p><p className="mt-1 text-xl font-semibold tabular-nums">{products.length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground"><Boxes size={18} /></span>
            <div><p className="text-xs text-muted-foreground">Units on hand</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatQuantity(totalUnits)}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"><ClipboardCheck size={18} /></span>
            <div><p className="text-xs text-muted-foreground">At or below reorder point</p><p className="mt-1 text-xl font-semibold tabular-nums">{lowStockCount}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground"><History size={18} /></span>
            <div><p className="text-xs text-muted-foreground">Stock value at unit cost</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(totalValue, currency)}</p></div>
          </CardContent>
        </Card>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button type="button" variant={activeView === "products" ? "secondary" : "ghost"} aria-pressed={activeView === "products"} onClick={() => setActiveView("products")}>Products</Button>
            <Button type="button" variant={activeView === "movements" ? "secondary" : "ghost"} aria-pressed={activeView === "movements"} onClick={() => setActiveView("movements")}>Movement history <span className="ml-1 tabular-nums">{movements.length}</span></Button>
          </div>
          {activeView === "products" ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU" className="pl-9" aria-label="Search inventory products" />
              </div>
              <Button type="button" variant={stockFilter === "all" ? "outline" : "secondary"} aria-pressed={stockFilter === "all"} onClick={() => setStockFilter("all")}>All products</Button>
              <Button type="button" variant={stockFilter === "low" ? "outline" : "secondary"} aria-pressed={stockFilter === "low"} onClick={() => setStockFilter("low")}>Needs reorder</Button>
            </div>
          ) : null}
        </div>

        {activeView === "products" ? (
          products.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>On hand</TableHead><TableHead>Reorder point</TableHead><TableHead>Unit cost</TableHead><TableHead>Stock value</TableHead><TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visibleProducts.length ? visibleProducts.map(({ product, stock, reorderPoint, value }) => {
                    const needsReorder = reorderPoint > 0 && stock <= reorderPoint;
                    return (
                      <TableRow key={product.id}>
                        <TableCell className="min-w-48 font-medium">{product.data.name || "Unnamed product"}<div className="mt-1 text-xs font-normal text-muted-foreground">{product.data.unit || "Unit not set"}</div></TableCell>
                        <TableCell className="text-muted-foreground">{product.data.sku || "—"}</TableCell>
                        <TableCell className="font-medium tabular-nums">{formatQuantity(stock, product.data.unit)}</TableCell>
                        <TableCell className="tabular-nums">{reorderPoint > 0 ? formatQuantity(reorderPoint, product.data.unit) : "Not set"}</TableCell>
                        <TableCell className="tabular-nums">{formatMoney(Number(product.data.cost || 0) || 0, currency)}</TableCell>
                        <TableCell className="tabular-nums">{formatMoney(value, currency)}</TableCell>
                        <TableCell className="text-right">
                          {needsReorder ? <Badge variant="destructive" className="mr-2">Reorder</Badge> : null}
                          <Button type="button" variant="outline" size="sm" onClick={() => openMovement("Adjustment", product.id)}>Count</Button>
                        </TableCell>
                      </TableRow>
                    );
                  }) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No products match this view.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-lg bg-accent text-accent-foreground"><Package size={22} /></div>
              <h2 className="mt-4 font-semibold">Add products to start tracking stock</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Products from Items & services appear here. You can then receive stock, record deliveries, and set reorder points.</p>
              <Button nativeButton={false} render={<Link href="/app/items" />} className="mt-5">Open Items & services</Button>
            </div>
          )
        ) : (
          movements.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Movement</TableHead><TableHead>Quantity</TableHead><TableHead>Stock change</TableHead><TableHead>Balance after</TableHead><TableHead>Reference</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {sortedMovements.map((movement) => {
                    const change = Number(movement.data.change || 0);
                    return (
                      <TableRow key={movement.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(movement.data.date || movement.createdAt.slice(0, 10))}</TableCell>
                        <TableCell className="min-w-44 font-medium">{movement.data.itemName || "Product"}<div className="mt-1 text-xs font-normal text-muted-foreground">{movement.data.sku || "No SKU"}</div></TableCell>
                        <TableCell><Badge variant={movement.data.movementType === "Receipt" ? "secondary" : "outline"}>{movement.data.movementType || "Movement"}</Badge></TableCell>
                        <TableCell className="tabular-nums">{formatQuantity(Number(movement.data.quantity || 0), movement.data.unit)}</TableCell>
                        <TableCell className={`font-medium tabular-nums ${change > 0 ? "text-primary" : change < 0 ? "text-destructive" : "text-muted-foreground"}`}>{change > 0 ? "+" : ""}{formatQuantity(change, movement.data.unit)}</TableCell>
                        <TableCell className="tabular-nums">{formatQuantity(Number(movement.data.resultingStock || 0), movement.data.unit)}</TableCell>
                        <TableCell className="text-muted-foreground">{movement.data.reference || movement.data.notes || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground"><History size={22} /></div>
              <h2 className="mt-4 font-semibold">No stock movements yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">Receipts, deliveries, and physical counts will appear here.</p>
            </div>
          )
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{movementType === "Receipt" ? "Receive stock" : movementType === "Delivery" ? "Record delivery" : "Count stock"}</DialogTitle>
            <DialogDescription>{movementType === "Receipt" ? "Add delivered units to the product’s on-hand quantity." : movementType === "Delivery" ? "Record units leaving stock. The quantity cannot exceed what is on hand." : "Enter the physical count. The difference will be recorded in movement history."}</DialogDescription>
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
              {selectedProduct ? <p className="text-xs text-muted-foreground">Current on-hand: {formatQuantity(Number(selectedProduct.data.stock || 0), selectedProduct.data.unit)}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inventory-quantity">{movementType === "Adjustment" ? "Counted quantity" : "Quantity"}</Label>
                <Input id="inventory-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-date">Date</Label>
                <Input id="inventory-date" type="date" required value={movementDate} onChange={(event) => setMovementDate(event.target.value)} />
              </div>
            </div>
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
