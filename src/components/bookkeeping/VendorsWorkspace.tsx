"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { deleteBookkeepingRecord } from "@/app/actions";
import RecordEditor from "@/components/bookkeeping/RecordEditor";
import RecordDetailPanel from "@/components/bookkeeping/RecordDetailPanel";
import { StatusBadge } from "@/components/crm/crm-shared";
import { useNewRecordParam, useOpenRecordParam } from "@/hooks/use-new-record-param";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moduleBySlug, type ModuleDefinition } from "@/lib/bookkeeping-config";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { homeRate } from "@/lib/invoice-utils";

interface VendorsWorkspaceProps {
  records: BookkeepingRecord[];
  bills: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
}

const pageSize = 10;

/** What is still owed on a bill, in the home currency. */
function billBalance(bill: BookkeepingRecord, currency: string) {
  if (["Paid", "Cancelled"].includes(bill.data.status || "")) return 0;
  return Math.max(0, Number(bill.data.amount || 0) - Number(bill.data.paidAmount || 0) - Number(bill.data.creditApplied || 0)) * homeRate(bill.data, currency);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function VendorsWorkspace({ records: initialRecords, bills, accounts, currency, asOfDate }: VendorsWorkspaceProps) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BookkeepingRecord | null>(null);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  const summaries = useMemo(() => records.map((vendor) => {
    const normalizedName = vendor.data.name?.trim().toLocaleLowerCase() || "";
    const vendorBills = bills.filter((bill) => bill.data.vendor?.trim().toLocaleLowerCase() === normalizedName);
    const openBills = vendorBills.filter((bill) => billBalance(bill, currency) > 0);
    const overdueBills = openBills.filter((bill) => Boolean(bill.data.dueDate && bill.data.dueDate < asOfDate));
    const openingBalance = Number(vendor.data.openingBalance || 0) || 0;
    const currentBalance = openingBalance + openBills.reduce((sum, bill) => sum + billBalance(bill, currency), 0);
    return { vendor, vendorBills, openBills, overdueBills, openingBalance, currentBalance };
  }), [asOfDate, bills, records, currency]);

  const filteredVendors = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return summaries.filter(({ vendor, currentBalance, overdueBills }) => {
      const matchesSearch = !normalizedSearch || [
        vendor.data.displayName,
        vendor.data.name,
        vendor.data.company,
        vendor.data.email,
        vendor.data.phone,
        vendor.data.mobile,
        vendor.data.address,
        vendor.data.city,
        vendor.data.state,
        vendor.data.businessId,
        vendor.data.taxId,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
      const hasBalance = currentBalance !== 0;
      const isOverdue = overdueBills.length > 0;
      const matchesBalance = balanceFilter === "all"
        || (balanceFilter === "open" && hasBalance)
        || (balanceFilter === "overdue" && isOverdue)
        || (balanceFilter === "clear" && !hasBalance);
      return matchesSearch && matchesBalance;
    }).sort((left, right) => {
      const leftName = left.vendor.data.displayName || left.vendor.data.company || left.vendor.data.name || "";
      const rightName = right.vendor.data.displayName || right.vendor.data.company || right.vendor.data.name || "";
      return leftName.localeCompare(rightName);
    });
  }, [balanceFilter, search, summaries]);

  const totalPayables = summaries.reduce((sum, summary) => sum + Math.max(0, summary.currentBalance), 0);
  const overduePayables = summaries.reduce((sum, summary) => sum + summary.overdueBills.reduce((billSum, bill) => billSum + billBalance(bill, currency), 0), 0);
  const vendorsWithOpenBills = summaries.filter((summary) => summary.openBills.length > 0).length;
  const pageCount = Math.max(1, Math.ceil(filteredVendors.length / pageSize));
  const visibleVendors = filteredVendors.slice((page - 1) * pageSize, page * pageSize);
  const detail = summaries.find((summary) => summary.vendor.id === detailId) ?? null;
  const editorModule = moduleBySlug("vendors");

  useEffect(() => setPage(1), [balanceFilter, search]);

  function openNewVendor() {
    setEditingRecord(null);
    setDefaults({ openingBalance: "0", openingBalanceDate: asOfDate });
    setActionMessage("");
    setEditorOpen(true);
  }

  useNewRecordParam(openNewVendor);
  useOpenRecordParam(setDetailId);

  function openEditVendor(vendor: BookkeepingRecord) {
    setEditingRecord(vendor);
    setDefaults({});
    setActionMessage("");
    setEditorOpen(true);
  }

  function handleSaved(record: BookkeepingRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    router.refresh();
  }

  async function handleDelete(vendor: BookkeepingRecord) {
    const displayName = vendor.data.displayName || vendor.data.company || vendor.data.name || "this supplier";
    if (!window.confirm(`Delete ${displayName}? Existing bills will remain in your records.`)) return;
    setPendingDelete(vendor.id);
    setActionMessage("");
    try {
      await deleteBookkeepingRecord("vendors", vendor.id);
      setRecords((current) => current.filter((record) => record.id !== vendor.id));
      setActionMessage("Supplier deleted. Existing bills were kept.");
    } catch (error) {
      setActionMessage(error instanceof Error ? readableError(error) : "We couldn’t delete that supplier.");
    } finally {
      setPendingDelete(null);
    }
  }

  function exportCsv() {
    const headers = ["Supplier", "Supplier name", "Company", "Email", "Phone", "Address", "Opening balance", "Open bills", "Current balance"];
    const rows = filteredVendors.map(({ vendor, openBills, currentBalance }) => [
      vendor.data.displayName || "",
      vendor.data.name || "",
      vendor.data.company || "",
      vendor.data.email || "",
      vendor.data.phone || "",
      vendor.data.address || "",
      vendor.data.openingBalance || "0",
      String(openBills.length),
      currentBalance.toFixed(2),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "mikledger-vendors.csv";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Purchases / Contacts</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Suppliers</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Keep supplier details and balances together in one place.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><ArrowDownToLine size={15} />Export CSV</Button>
          <Button className="gap-2" onClick={openNewVendor}><Plus size={16} />New supplier</Button>
        </div>
      </section>

      <section aria-label="Vendor summary" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "All suppliers", value: String(records.length), detail: "Saved suppliers and service providers", tone: "text-foreground" },
          { label: "Open payables", value: formatMoney(totalPayables, currency), detail: `${vendorsWithOpenBills} suppliers with unpaid bills`, tone: "text-foreground" },
          { label: "Overdue payables", value: formatMoney(overduePayables, currency), detail: `${summaries.filter((summary) => summary.overdueBills.length > 0).length} suppliers with overdue bills`, tone: "text-destructive" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3.5">
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${item.tone}`}>{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </section>

      {actionMessage ? <p role="status" className="mt-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{actionMessage}</p> : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Supplier directory</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{filteredVendors.length} {filteredVendors.length === 1 ? "supplier" : "suppliers"}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:w-64 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppliers, contacts, or tax IDs" className="pl-9" aria-label="Search suppliers" />
            </div>
            <Select value={balanceFilter} onValueChange={(value) => setBalanceFilter(value ?? "all")}>
              <SelectTrigger className="w-[170px]" aria-label="Filter suppliers by balance"><SelectValue placeholder="All suppliers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                <SelectItem value="open">With open balance</SelectItem>
                <SelectItem value="overdue">With overdue bills</SelectItem>
                <SelectItem value="clear">No open balance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {["Supplier", "Email", "Phone", "Open bills", "Balance", ""].map((heading) => (
                  <TableHead key={heading || "actions"} className="whitespace-nowrap text-xs font-medium text-muted-foreground">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleVendors.map(({ vendor, openBills, currentBalance }) => (
                <TableRow key={vendor.id} className="group cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, [role=menu]")) setDetailId(vendor.id); }}>
                  <TableCell className="max-w-[280px]">
                    <Button type="button" variant="link" className="block h-auto max-w-full justify-start p-0 text-left" onClick={() => setDetailId(vendor.id)}>
                      <span className="block truncate text-[13px] font-medium text-primary" title={vendor.data.displayName || vendor.data.company || vendor.data.name || ""}>{vendor.data.displayName || vendor.data.company || vendor.data.name || "Unnamed supplier"}</span>
                      {vendor.data.name && (vendor.data.displayName || vendor.data.company) && vendor.data.name !== (vendor.data.displayName || vendor.data.company) ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{vendor.data.name}</span> : null}
                    </Button>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-[13px] text-muted-foreground" title={vendor.data.email || ""}>{vendor.data.email || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">{vendor.data.phone || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] tabular-nums">{openBills.length}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-[13px] font-medium tabular-nums">{formatMoney(currentBalance, currency)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${vendor.data.displayName || vendor.data.name || "supplier"}`}><MoreHorizontal size={15} /></Button>} />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditVendor(vendor)}><Pencil size={14} />Edit supplier</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={pendingDelete === vendor.id} onClick={() => void handleDelete(vendor)}><Trash2 size={14} />Delete supplier</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {!visibleVendors.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-52 whitespace-normal text-center">
                    <div className="sticky left-0 w-[calc(100vw-4.5rem)] sm:static sm:mx-auto sm:w-auto sm:max-w-sm">
                      <p className="text-sm font-medium">{records.length ? "No suppliers match this search" : "No suppliers yet"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{records.length ? "Try another search or balance filter." : "Add a supplier to keep contact details and bills connected."}</p>
                      {!records.length ? <Button className="mt-4 gap-2" onClick={openNewVendor}><Plus size={15} />New supplier</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Showing {filteredVendors.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredVendors.length)} of {filteredVendors.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
          </div>
        </div>
      </section>

      {editorModule ? (
        <RecordDetailPanel
          module={editorModule as ModuleDefinition}
          record={detail ? { ...detail.vendor, data: { ...detail.vendor.data, defaultExpenseAccount: accounts.find((account) => account.id === detail.vendor.data.defaultExpenseAccount)?.data.name ?? detail.vendor.data.defaultExpenseAccount ?? "" } } : null}
          currency={currency}
          stats={detail ? [["Open bills", String(detail.openBills.length)], ["Overdue bills", String(detail.overdueBills.length)], ["Balance", formatMoney(detail.currentBalance, currency)]] : undefined}
          actions={detail ? [
            { key: "edit", label: "Edit", icon: Pencil, primary: true, run: () => { setDetailId(null); openEditVendor(detail.vendor); } },
            { key: "delete", label: "Delete", icon: Trash2, destructive: true, run: () => { setDetailId(null); void handleDelete(detail.vendor); } },
          ] : []}
          onClose={() => setDetailId(null)}
        >
          {detail ? (
            <section className="rounded-lg border border-border bg-card">
              <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Bills ({detail.vendorBills.length})</h3>
              {detail.vendorBills.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Bill no.</th><th className="px-4 py-2 font-medium">Due date</th><th className="px-4 py-2 text-right font-medium">Balance</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
                  <tbody>
                    {detail.vendorBills.map((bill) => {
                      const balance = billBalance(bill, currency);
                      const status = bill.data.status === "Cancelled" ? "Cancelled" : balance <= 0 ? "Paid" : bill.data.dueDate && bill.data.dueDate < asOfDate ? "Overdue" : "Open";
                      return (
                        <tr key={bill.id} className="border-t border-border">
                          <td className="px-4 py-2 font-medium">{bill.data.billNumber || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{bill.data.dueDate || "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMoney(balance, currency)}</td>
                          <td className="px-4 py-2"><StatusBadge value={status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="px-4 py-3 text-sm text-muted-foreground">No bills from this supplier yet.</p>}
            </section>
          ) : null}
        </RecordDetailPanel>
      ) : null}
      {editorModule ? (
        <RecordEditor
          defaultCurrency={currency}
          key={`vendors-${editingRecord?.id ?? "new"}`}
          module={editorModule as ModuleDefinition}
          record={editingRecord}
          customers={[]}
          vendors={[]}
          items={[]}
          accounts={accounts}
          defaults={defaults}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          onSaveComplete={async () => undefined}
        />
      ) : null}
    </div>
  );
}
