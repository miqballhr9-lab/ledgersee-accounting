"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpDown, ChevronDown, Copy, Ellipsis, ExternalLink, FileSpreadsheet, FileText, FileUp, GripVertical, ListChecks, Pencil, Plus, Printer, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { readableError } from "@/lib/action-error";

import { deleteBookkeepingRecord, saveBudgetPlan, sendBudgetSummary } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { budgetActual, budgetActualRecords, budgetExpectedTotal, budgetPresetRange, budgetVariance, csvCell, parseBudgetLines, payrollBudgetHeads, parseCsv, recordsWithinBudgetDates, type BudgetCategory, type BudgetLine, type BudgetPeriod } from "@/lib/budget-utils";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface BudgetPlannerWorkspaceProps {
  budgets: BookkeepingRecord[];
  financialRecords: BookkeepingRecord[];
  accounts: BookkeepingRecord[];
  currency: string;
  asOfDate: string;
}

interface BudgetHeadOption {
  value: string;
  label: string;
  budgetHead: string;
  category: BudgetCategory;
  type: "Income" | "Expense";
}

const periodOptions: BudgetPeriod[] = ["Monthly", "Quarterly", "Annual", "Custom"];

function savedBudgetHeadKey(type: BudgetHeadOption["type"], budgetHead: string) {
  return `saved:${type}:${budgetHead.trim().toLocaleLowerCase()}`;
}

function accountHeadReference(value: string, accountHeads: BudgetHeadOption[]) {
  const trimmed = value.trim();
  const accountValue = trimmed.startsWith("account:")
    ? trimmed
    : /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(trimmed)
      ? `account:${trimmed}`
      : "";
  return accountHeads.find((option) => option.value === accountValue);
}

function resolveBudgetLine(line: BudgetLine, accountHeads: BudgetHeadOption[]): BudgetLine {
  const accountHead = accountHeadReference(line.headKey ?? "", accountHeads)
    ?? accountHeadReference(line.budgetHead, accountHeads);
  return accountHead ? {
    ...line,
    category: accountHead.category,
    type: accountHead.type,
    budgetHead: accountHead.budgetHead,
    headKey: accountHead.value,
  } : line;
}

function isAccountReference(value: string) {
  return value.startsWith("account:") || /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.trim());
}

function emptyBudgetLine(): BudgetLine {
  return { category: "Expenses", budgetHead: "", headKey: "", type: "Expense", expected: "", description: "" };
}

/** The sheet always shows at least five lines, like a ledger page; empty ones are left out when saving. */
function sheetLines(lines: BudgetLine[]) {
  return [...lines, ...Array.from({ length: Math.max(0, 5 - lines.length) }, emptyBudgetLine)];
}

// Spreadsheet-style cells, matching the journal and payroll sheets: no box until a cell is focused.
const cellInput = "h-11 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:bg-transparent";
const cellBorder = "border-r border-dashed border-border";

function validPeriod(value: string | undefined): value is BudgetPeriod {
  return periodOptions.some((option) => option === value);
}

function formatAmount(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function sourceRecordDate(record: BookkeepingRecord) {
  if (record.kind === "payroll") return record.data.month || "";
  return record.data.issueDate || record.data.date || record.data.expenseDate || record.data.billDate || record.data.paymentDate || record.createdAt.slice(0, 10);
}

function sourceRecordLabel(record: BookkeepingRecord) {
  if (record.kind === "payroll") return `${record.data.employeeName || "Employee"} · ${record.data.employeeId || "Payroll"}`;
  if (record.kind === "invoices") return `${record.data.invoiceNumber || "Invoice"} · ${record.data.customer || "Customer"}`;
  if (record.kind === "bills") return `${record.data.billNumber || "Bill"} · ${record.data.vendor || record.data.description || "Purchase"}`;
  return record.data.description || record.data.payee || record.data.category || "Expense";
}

function sourceRecordAmount(record: BookkeepingRecord) {
  if (record.kind === "payroll") return Number(record.data.grossSalary) || 0;
  if (record.kind === "invoices") return Math.max(0, (Number(record.data.amount) || 0) - (Number(record.data.creditApplied) || 0));
  return Number(record.data.amount) || 0;
}

function saveCsv(filename: string, rows: (string | number)[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? readableError(error) : "We couldn’t save that budget. Please try again.";
}

export default function BudgetPlannerWorkspace({ budgets, financialRecords, accounts, currency, asOfDate }: BudgetPlannerWorkspaceProps) {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [savedBudgets, setSavedBudgets] = useState(budgets);
  const [selectedBudgetId, setSelectedBudgetId] = useState(budgets[0]?.id ?? "");
  const [name, setName] = useState(budgets[0]?.data.name ?? "Operating budget");
  const [description, setDescription] = useState(budgets[0]?.data.description ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>(validPeriod(budgets[0]?.data.period) ? budgets[0].data.period as BudgetPeriod : "Monthly");
  const [dateRange, setDateRange] = useState(() => {
    const initialRange = budgetPresetRange("Monthly", asOfDate);
    return { startDate: budgets[0]?.data.startDate || initialRange.startDate, endDate: budgets[0]?.data.endDate || initialRange.endDate };
  });
  const [lines, setLines] = useState<BudgetLine[]>(() => {
    const initialLines = budgets[0] ? parseBudgetLines(budgets[0].data.lines) : [];
    return sheetLines(initialLines);
  });
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeActualLine, setActiveActualLine] = useState<BudgetLine | null>(null);
  const [draggedLine, setDraggedLine] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const accountHeads: BudgetHeadOption[] = accounts
    .filter((account) => (account.data.type === "Income" || account.data.type === "Expense") && account.data.name?.trim())
    .map((account) => ({
      value: `account:${account.id}`,
      label: account.data.name.trim(),
      budgetHead: account.data.name.trim(),
      category: account.data.type === "Income" ? "Sales" : "Expenses",
      type: account.data.type as BudgetHeadOption["type"],
    }));
  const salesHeads: BudgetHeadOption[] = [{
    value: "sales:revenue-invoices",
    label: "Revenue · invoices",
    budgetHead: "Revenue · invoices",
    category: "Sales",
    type: "Income",
  }];
  const payrollHeads: BudgetHeadOption[] = payrollBudgetHeads.map((item) => ({
    value: `payroll:${item.head.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: item.head,
    budgetHead: item.head,
    category: "Payroll",
    type: "Expense",
  }));
  const knownHeadSignatures = new Set([...accountHeads, ...salesHeads, ...payrollHeads].map((option) => `${option.category}:${option.budgetHead.toLocaleLowerCase()}`));
  const savedHeadMap = new Map<string, BudgetHeadOption>();
  savedBudgets.flatMap((budget) => parseBudgetLines(budget.data.lines)).forEach((line) => {
    const resolvedLine = resolveBudgetLine(line, accountHeads);
    if (isAccountReference(line.budgetHead) && resolvedLine.budgetHead === line.budgetHead) return;
    if (isAccountReference(line.headKey ?? "") && resolvedLine.budgetHead === line.budgetHead) return;
    if (!resolvedLine.budgetHead.trim() || knownHeadSignatures.has(`${resolvedLine.category}:${resolvedLine.budgetHead.toLocaleLowerCase()}`)) return;
    const value = savedBudgetHeadKey(resolvedLine.type, resolvedLine.budgetHead);
    savedHeadMap.set(value, { value, label: resolvedLine.budgetHead, budgetHead: resolvedLine.budgetHead, category: resolvedLine.category, type: resolvedLine.type });
  });
  const savedHeadOptions = Array.from(savedHeadMap.values());
  const budgetHeadOptions = [...accountHeads, ...salesHeads, ...payrollHeads, ...savedHeadOptions];

  const periodRecords = useMemo(
    () => recordsWithinBudgetDates(financialRecords, dateRange.startDate, dateRange.endDate),
    [dateRange.endDate, dateRange.startDate, financialRecords],
  );
  const actuals = useMemo(() => lines.map((line) => budgetActual(resolveBudgetLine(line, accountHeads), periodRecords)), [accountHeads, lines, periodRecords]);
  const activeActualRecords = activeActualLine ? budgetActualRecords(resolveBudgetLine(activeActualLine, accountHeads), periodRecords) : [];
  const expectedTotal = budgetExpectedTotal(lines);
  const actualTotal = actuals.reduce((sum, amount) => sum + amount, 0);
  const varianceTotal = lines.reduce((sum, line, index) => sum + budgetVariance(line, actuals[index] ?? 0), 0);

  const budgetSummaries = useMemo(() => savedBudgets.map((record) => {
    const budgetLines = parseBudgetLines(record.data.lines).map((line) => resolveBudgetLine(line, accountHeads));
    const records = recordsWithinBudgetDates(financialRecords, record.data.startDate || "", record.data.endDate || "");
    const lineActuals = budgetLines.map((line) => budgetActual(line, records));
    return {
      record,
      lineCount: budgetLines.length,
      expected: budgetExpectedTotal(budgetLines),
      actual: lineActuals.reduce((sum, amount) => sum + amount, 0),
      variance: budgetLines.reduce((sum, line, index) => sum + budgetVariance(line, lineActuals[index] ?? 0), 0),
    };
  }), [accountHeads, financialRecords, savedBudgets]);
  const selectedBudgets = savedBudgets.filter((record) => selectedIds.has(record.id));
  const filteredBudgets = budgetSummaries.filter(({ record }) => !search.trim() || `${record.data.name} ${record.data.description} ${record.data.period}`.toLowerCase().includes(search.trim().toLowerCase()));

  function loadBudgetRecord(budget: BookkeepingRecord) {
    setSelectedBudgetId(budget.id);
    setName(budget.data.name || "Operating budget");
    setDescription(budget.data.description || "");
    setPeriod(validPeriod(budget.data.period) ? budget.data.period : "Custom");
    setDateRange({ startDate: budget.data.startDate || "", endDate: budget.data.endDate || "" });
    const budgetLines = parseBudgetLines(budget.data.lines);
    setLines(sheetLines(budgetLines));
  }

  function startNewBudget() {
    const defaultRange = budgetPresetRange("Monthly", asOfDate);
    setSelectedBudgetId("");
    setName("New budget");
    setDescription("");
    setPeriod("Monthly");
    setDateRange(defaultRange);
    setLines(sheetLines([]));
    setRecipientEmail("");
  }

  function openBudget(budget: BookkeepingRecord) {
    loadBudgetRecord(budget);
    setRecipientEmail("");
    setEditorOpen(true);
  }

  function newBudget() {
    startNewBudget();
    setEditorOpen(true);
  }

  function copyBudget(budget: BookkeepingRecord) {
    loadBudgetRecord(budget);
    setSelectedBudgetId("");
    setName(`${budget.data.name?.trim() || "Budget"} copy`);
    setRecipientEmail("");
    setEditorOpen(true);
    toast.success("Budget copied. Update its dates and save the new version.");
  }

  function moveLine(from: number, to: number) {
    if (from === to) return;
    setLines((current) => {
      const next = [...current];
      const [moving] = next.splice(from, 1);
      next.splice(to, 0, moving);
      return next;
    });
  }

  function updateLine(index: number, field: keyof BudgetLine, value: string) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function setSavedBudget(record: BookkeepingRecord) {
    setSavedBudgets((current) => [record, ...current.filter((budget) => budget.id !== record.id)]);
    setSelectedBudgetId(record.id);
  }

  function saveInput() {
    return {
      name,
      description,
      period,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      currency,
      lines: lines.filter((line) => line.budgetHead.trim()).map((line) => resolveBudgetLine(line, accountHeads)),
    };
  }

  function sourceHref(kind: BookkeepingRecord["kind"], line: BudgetLine) {
    const query = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate, budgetHead: line.budgetHead });
    return `/app/${kind}?${query.toString()}`;
  }

  async function saveBudget() {
    setIsSaving(true);
    try {
      const saved = await saveBudgetPlan(saveInput(), selectedBudgetId || undefined);
      setSavedBudget(saved);
      router.refresh();
      setEditorOpen(false);
      toast.success("Budget saved.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAndSend() {
    if (!recipientEmail.trim()) {
      toast.error("Enter an email address to send this budget.");
      return;
    }
    setIsSending(true);
    let budgetWasSaved = false;
    try {
      const saved = await saveBudgetPlan(saveInput(), selectedBudgetId || undefined);
      setSavedBudget(saved);
      router.refresh();
      budgetWasSaved = true;
      await sendBudgetSummary(saved.id, recipientEmail);
      setEditorOpen(false);
      toast.success(`Budget saved and sent to ${recipientEmail.trim()}.`);
    } catch (error) {
      toast.error(budgetWasSaved ? `Budget saved, but email wasn’t sent: ${errorMessage(error)}` : errorMessage(error));
    } finally {
      setIsSending(false);
    }
  }

  function downloadTemplate() {
    saveCsv("mikledger-budget-template.csv", [["name", "period", "startDate", "endDate", "category", "budgetHead", "expected", "description"]]);
  }

  function budgetExportRows(budget: BookkeepingRecord) {
    const budgetLines = parseBudgetLines(budget.data.lines).map((line) => resolveBudgetLine(line, accountHeads));
    const records = recordsWithinBudgetDates(financialRecords, budget.data.startDate || "", budget.data.endDate || "");
    const rows: (string | number)[][] = [["name", "period", "startDate", "endDate", "category", "budgetHead", "expected", "actual", "variance", "description"]];
    budgetLines.forEach((line) => {
      const actual = budgetActual(line, records);
      rows.push([budget.data.name || "", budget.data.period || "", budget.data.startDate || "", budget.data.endDate || "", line.category, line.budgetHead, Number(line.expected) || 0, actual, budgetVariance(line, actual), line.description]);
    });
    return rows;
  }

  function budgetFileName(budget: BookkeepingRecord) {
    return (budget.data.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "budget";
  }

  function exportBudget(budget: BookkeepingRecord) {
    saveCsv(`${budgetFileName(budget)}.csv`, budgetExportRows(budget));
  }

  async function exportBudgetExcel(budget: BookkeepingRecord) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(budgetExportRows(budget)), "Budget");
      XLSX.writeFile(workbook, `${budgetFileName(budget)}.xlsx`);
    } catch {
      toast.error("We couldn’t create the Excel file. Please try again.");
    }
  }

  function exportSelected(format: "csv" | "xlsx") {
    const rows = selectedBudgets.flatMap((budget, index) => budgetExportRows(budget).slice(index === 0 ? 0 : 1));
    if (format === "csv") {
      saveCsv("budgets.csv", rows);
      return;
    }
    void import("xlsx").then((XLSX) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Budgets");
      XLSX.writeFile(workbook, "budgets.xlsx");
    }).catch(() => toast.error("We couldn’t create the Excel file. Please try again."));
  }

  async function deleteSelected() {
    const count = selectedBudgets.length;
    if (!count || !window.confirm(`Delete ${count} ${count === 1 ? "budget" : "budgets"}? This can’t be undone.`)) return;
    const deleted: string[] = [];
    for (const budget of selectedBudgets) {
      try {
        await deleteBookkeepingRecord("budgets", budget.id);
        deleted.push(budget.id);
      } catch (error) {
        toast.error(`${budget.data.name || "Budget"}: ${errorMessage(error)}`);
      }
    }
    setSavedBudgets((current) => current.filter((record) => !deleted.includes(record.id)));
    setSelectedIds(new Set());
    if (deleted.length) toast.success(`Deleted ${deleted.length} ${deleted.length === 1 ? "budget" : "budgets"}.`);
    router.refresh();
  }

  async function deleteBudget(budget: BookkeepingRecord) {
    if (!window.confirm(`Delete the budget “${budget.data.name || "Untitled budget"}”? This can’t be undone.`)) return;
    try {
      await deleteBookkeepingRecord("budgets", budget.id);
      setSavedBudgets((current) => current.filter((record) => record.id !== budget.id));
      if (selectedBudgetId === budget.id) setSelectedBudgetId("");
      toast.success("Budget deleted.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }


  async function importBudgetFile(file: File) {
    if (file.size > 4_000_000) {
      toast.error("Choose a CSV file smaller than 4 MB.");
      return;
    }
    setIsImporting(true);
    try {
      const csvRows = parseCsv(await file.text());
      if (csvRows.length < 2) throw new Error("Add at least one budget row to the template before importing it.");
      const headers = csvRows[0].map((header) => header.trim().replace(/^\uFEFF/, "").toLowerCase().replaceAll(" ", ""));
      const column = (key: string) => headers.indexOf(key);
      const categoryColumn = column("category");
      const budgetHeadColumn = column("budgethead") >= 0 ? column("budgethead") : categoryColumn;
      const expectedColumn = column("expected");
      if (budgetHeadColumn < 0 || expectedColumn < 0) throw new Error("The CSV needs budgetHead and expected columns. Download the blank template to get the right format.");
      const importedLines = csvRows.slice(1).flatMap((row, rowIndex) => {
        const budgetHead = (row[budgetHeadColumn] ?? "").trim();
        if (!budgetHead) return [];
        const expectedText = (row[expectedColumn] ?? "").replaceAll(",", "").trim();
        const expected = Number(expectedText || 0);
        if (!Number.isFinite(expected) || expected < 0) throw new Error(`Check the expected amount on CSV row ${rowIndex + 2}.`);
        const suppliedType = row[column("type")]?.trim().toLowerCase();
        if (suppliedType && suppliedType !== "income" && suppliedType !== "expense") throw new Error(`Choose Income or Expense on CSV row ${rowIndex + 2}.`);
        const categoryText = budgetHeadColumn === categoryColumn ? "" : (row[categoryColumn] ?? "").trim();
        if (categoryText && categoryText !== "Sales" && categoryText !== "Expenses" && categoryText !== "Payroll") throw new Error(`Choose Sales, Expenses, or Payroll on CSV row ${rowIndex + 2}.`);
        const matchingHead = accountHeadReference(budgetHead, accountHeads)
          ?? budgetHeadOptions.find((option) => option.budgetHead.toLocaleLowerCase() === budgetHead.toLocaleLowerCase() && (!categoryText || option.category === categoryText) && (!suppliedType || option.type.toLowerCase() === suppliedType));
        const category: BudgetCategory = categoryText === "Sales" || categoryText === "Expenses" || categoryText === "Payroll"
          ? categoryText
          : matchingHead?.category ?? (suppliedType ? suppliedType === "income" ? "Sales" : "Expenses" : "Expenses");
        const type: BudgetHeadOption["type"] = category === "Sales" ? "Income" : "Expense";
        const categoryMatchedHead = matchingHead?.category === category ? matchingHead : budgetHeadOptions.find((option) => option.budgetHead.toLocaleLowerCase() === budgetHead.toLocaleLowerCase() && option.category === category);
        return [{
          category,
          budgetHead: categoryMatchedHead?.budgetHead ?? budgetHead,
          headKey: categoryMatchedHead?.value ?? savedBudgetHeadKey(type, budgetHead),
          type,
          expected: String(expected),
          description: row[column("description")]?.trim() ?? "",
        }];
      });
      if (!importedLines.length) throw new Error("Add at least one budget head and expected amount before importing the template.");

      const firstDataRow = csvRows[1];
      const fileName = firstDataRow[column("name")]?.trim();
      const filePeriod = firstDataRow[column("period")]?.trim();
      const fileStart = firstDataRow[column("startdate")]?.trim();
      const fileEnd = firstDataRow[column("enddate")]?.trim();
      const importedPeriod = validPeriod(filePeriod) ? filePeriod : period;
      const importedStart = fileStart || dateRange.startDate;
      const importedEnd = fileEnd || dateRange.endDate;
      const importedName = fileName || name.trim() || "Imported budget";
      const saved = await saveBudgetPlan({
        name: importedName,
        description,
        period: importedPeriod,
        startDate: importedStart,
        endDate: importedEnd,
        currency,
        lines: importedLines,
      });
      setSavedBudget(saved);
      setName(importedName);
      setPeriod(importedPeriod);
      setDateRange({ startDate: importedStart, endDate: importedEnd });
      setLines(importedLines);
      router.refresh();
      toast.success(`Imported and saved ${importedLines.length} budget lines.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Accounting / Planning</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Budgets</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Set expected income and costs, then compare them with your recorded activity.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2 print:hidden" disabled={isImporting}><ArrowUpDown size={15} />{isImporting ? "Importing…" : "Import / Export"}<ChevronDown size={14} /></Button>} />
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem onClick={() => uploadRef.current?.click()}><FileUp size={15} />Import CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={downloadTemplate}><FileText size={15} />Blank template</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.print()}><Printer size={15} />Print or save as PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" className="gap-2 print:hidden" onClick={newBudget}><Plus size={15} />New budget</Button>
          <input ref={uploadRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import budget CSV file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importBudgetFile(file); event.currentTarget.value = ""; }} />
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Budget summary">
        {[
          { label: "Saved budgets", value: String(savedBudgets.length) },
          { label: "Expected (all budgets)", value: formatAmount(budgetSummaries.reduce((sum, item) => sum + item.expected, 0), currency) },
          { label: "Actual (all budgets)", value: formatAmount(budgetSummaries.reduce((sum, item) => sum + item.actual, 0), currency) },
          { label: "Favorable variance", value: formatAmount(budgetSummaries.reduce((sum, item) => sum + item.variance, 0), currency) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-semibold">Budget register</h2>
            <p className="mt-1 text-xs text-muted-foreground">{filteredBudgets.length} {filteredBudgets.length === 1 ? "budget" : "budgets"} · {currency}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Input aria-label="Search budgets" placeholder="Search budgets…" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:w-64" />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className="gap-2" disabled={!selectedBudgets.length} title={selectedBudgets.length ? undefined : "Select budgets with the checkboxes first"}><ListChecks size={15} />Actions{selectedBudgets.length ? ` (${selectedBudgets.length})` : ""}<ChevronDown size={14} /></Button>} />
              <DropdownMenuContent align="end" className="min-w-48">
                {selectedBudgets.length === 1 ? <DropdownMenuItem onClick={() => openBudget(selectedBudgets[0])}><Pencil size={14} />Open / edit</DropdownMenuItem> : null}
                {selectedBudgets.length === 1 ? <DropdownMenuItem onClick={() => copyBudget(selectedBudgets[0])}><Copy size={14} />Copy budget</DropdownMenuItem> : null}
                <DropdownMenuItem onClick={() => exportSelected("csv")}><ArrowDownToLine size={14} />Download CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportSelected("xlsx")}><FileSpreadsheet size={14} />Download Excel</DropdownMenuItem>
                {selectedBudgets.length === 1 ? <DropdownMenuItem onClick={() => window.open(`/app/budgets/${selectedBudgets[0].id}/print`, "_blank", "noopener")}><FileText size={14} />Download PDF</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void deleteSelected()}><Trash2 size={14} />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {filteredBudgets.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="w-10 pl-4 print:hidden">
                    <Checkbox
                      aria-label="Select all budgets shown"
                      checked={filteredBudgets.length > 0 && filteredBudgets.every(({ record }) => selectedIds.has(record.id))}
                      indeterminate={filteredBudgets.some(({ record }) => selectedIds.has(record.id)) && !filteredBudgets.every(({ record }) => selectedIds.has(record.id))}
                      onCheckedChange={(checked) => setSelectedIds(checked ? new Set(filteredBudgets.map(({ record }) => record.id)) : new Set())}
                    />
                  </th>
                  <th className="px-4 py-3">Budget name</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3 text-right">Lines</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="w-12 print:hidden"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredBudgets.map(({ record, lineCount, expected, actual, variance }) => (
                  <tr key={record.id} className={`cursor-pointer border-b border-border last:border-0 hover:bg-muted/30 ${selectedIds.has(record.id) ? "bg-muted/50" : ""}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, [role=menuitem], [role=checkbox], label")) openBudget(record); }}>
                    <td className="w-10 pl-4 print:hidden" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${record.data.name || "budget"}`}
                        checked={selectedIds.has(record.id)}
                        onCheckedChange={(checked) => setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(record.id);
                          else next.delete(record.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{record.data.name || "Untitled budget"}</td>
                    <td className="px-4 py-3">{record.data.period || "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{record.data.startDate || "…"} – {record.data.endDate || "…"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{lineCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(expected, currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(actual, currency)}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${variance < 0 ? "text-destructive" : "text-primary"}`}>{formatAmount(variance, currency)}</td>
                    <td className="max-w-56 truncate px-4 py-3 text-muted-foreground">{record.data.description || "—"}</td>
                    <td className="px-2 print:hidden" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${record.data.name || "budget"}`}><Ellipsis size={16} /></Button>} />
                        <DropdownMenuContent align="end" className="min-w-48">
                          <DropdownMenuItem onClick={() => openBudget(record)}><Pencil size={14} />Open / edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyBudget(record)}><Copy size={14} />Copy budget</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => exportBudget(record)}><ArrowDownToLine size={14} />Download CSV</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void exportBudgetExcel(record)}><FileSpreadsheet size={14} />Download Excel</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.open(`/app/budgets/${record.id}/print`, "_blank", "noopener")}><FileText size={14} />Download PDF</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => void deleteBudget(record)}><Trash2 size={14} />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <h3 className="font-semibold">{search ? "No matching budgets" : "No budgets yet"}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{search ? "Try another budget name." : "Create a budget to plan expected income and costs, then compare them with what you record."}</p>
            {!search ? <Button className="mt-4 gap-2" onClick={newBudget}><Plus size={15} />New budget</Button> : null}
          </div>
        )}
      </section>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!isSaving && !isSending) setEditorOpen(open); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(1200px,calc(100vw-3rem))]">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-lg">{selectedBudgetId ? "Edit budget" : "New budget"}</DialogTitle>
            <DialogDescription>Set the budget’s dates and expected amounts; actuals and variance update from your records.</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Expected budget</p><p className="mt-1 font-semibold tabular-nums">{formatAmount(expectedTotal, currency)}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Actual</p><p className="mt-1 font-semibold tabular-nums">{formatAmount(actualTotal, currency)}</p></div>
              <div className="rounded-md bg-accent/70 p-3"><p className="text-xs text-muted-foreground">Favorable variance</p><p className={`mt-1 font-semibold tabular-nums ${varianceTotal < 0 ? "text-destructive" : "text-primary"}`}>{formatAmount(varianceTotal, currency)}</p></div>
            </div>

          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><label className="text-xs font-medium" htmlFor="budget-name">Budget name</label><Input id="budget-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. 2026 operating plan" /></div>
              <div className="space-y-2"><label className="text-xs font-medium" htmlFor="budget-period">Budget period</label><Select value={period} onValueChange={(value) => {
                if (!value || !validPeriod(value)) return;
                setPeriod(value);
                if (value !== "Custom") setDateRange(budgetPresetRange(value, asOfDate));
              }}><SelectTrigger id="budget-period" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{periodOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><label className="text-xs font-medium" htmlFor="budget-start">Start date</label><Input id="budget-start" type="date" value={dateRange.startDate} onChange={(event) => { setDateRange((current) => ({ ...current, startDate: event.target.value })); setPeriod("Custom"); }} /></div>
              <div className="space-y-2"><label className="text-xs font-medium" htmlFor="budget-end">End date</label><Input id="budget-end" type="date" value={dateRange.endDate} onChange={(event) => { setDateRange((current) => ({ ...current, endDate: event.target.value })); setPeriod("Custom"); }} /></div>
              <div className="space-y-2 sm:col-span-2"><label className="text-xs font-medium" htmlFor="budget-description">Description</label><Textarea id="budget-description" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder="What this budget covers" className="min-h-20" /></div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div><h2 className="text-sm font-semibold">Budget lines</h2><p className="mt-1 text-xs text-muted-foreground">Choose expense heads from your Chart of Accounts; sales and Payroll keep their matching actuals for the selected dates.</p></div>
            </div>
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-border text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    <th className="w-8" aria-label="Reorder" />
                    <th className={`w-9 py-2.5 pr-2 text-right ${cellBorder}`}>#</th>
                    <th className={`w-[300px] px-2.5 py-2.5 text-left ${cellBorder}`}>Budget head</th>
                    <th className={`w-[150px] px-2.5 py-2.5 text-right ${cellBorder}`}>Expected budget</th>
                    <th className={`w-[150px] px-2.5 py-2.5 text-right ${cellBorder}`}>Actual</th>
                    <th className={`w-[150px] px-2.5 py-2.5 text-right ${cellBorder}`}>Variance</th>
                    <th className={`px-2.5 py-2.5 text-left ${cellBorder}`}>Description</th>
                    <th className="w-20"><span className="sr-only">Line actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const actual = actuals[index] ?? 0;
                    const resolvedLine = resolveBudgetLine(line, accountHeads);
                    const directSourceKind: BookkeepingRecord["kind"] | null = resolvedLine.category === "Payroll"
                      ? "payroll"
                      : resolvedLine.category === "Sales"
                        ? "invoices"
                        : null;
                    const variance = budgetVariance(line, actual);
                    const selectedHead = budgetHeadOptions.find((option) => option.value === resolvedLine.headKey)
                      ?? budgetHeadOptions.find((option) => option.budgetHead.toLocaleLowerCase() === resolvedLine.budgetHead.toLocaleLowerCase() && option.category === resolvedLine.category && option.type === resolvedLine.type);
                    const unresolvedAccountHead = !selectedHead && (isAccountReference(line.budgetHead) || isAccountReference(line.headKey ?? ""));
                    const hasHead = Boolean(line.budgetHead.trim());
                    return (
                      <tr
                        key={index}
                        className={`group border-b border-border hover:bg-muted/30 ${draggedLine === index ? "opacity-50" : ""}`}
                        onDragOver={(event) => { if (draggedLine !== null) event.preventDefault(); }}
                        onDrop={(event) => { event.preventDefault(); if (draggedLine !== null) moveLine(draggedLine, index); setDraggedLine(null); }}
                      >
                        <td className="text-center">
                          <span draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedLine(index); }} onDragEnd={() => setDraggedLine(null)} className="inline-flex cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing" aria-label={`Drag line ${index + 1} to reorder`} title="Drag to reorder"><GripVertical size={15} /></span>
                        </td>
                        <td className={`pr-2 text-right text-[13px] text-muted-foreground ${cellBorder}`}>{index + 1}</td>
                        <td className={`p-0 ${cellBorder}`}>
                          <Select
                            value={selectedHead?.value ?? null}
                            onValueChange={(value) => {
                              const option = budgetHeadOptions.find((item) => item.value === value);
                              if (option) setLines((current) => current.map((item, lineIndex) => lineIndex === index ? { ...item, category: option.category, budgetHead: option.budgetHead, headKey: option.value, type: option.type } : item));
                            }}
                          >
                            <SelectTrigger aria-label={`Budget Head on line ${index + 1}`} className={`${cellInput} !h-11 justify-between [&_svg]:opacity-0 group-hover:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100`}><span className="min-w-0 flex-1 truncate text-left">{selectedHead?.label ?? (unresolvedAccountHead ? "Account unavailable" : "")}</span></SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Sales and income</SelectLabel>
                                {[...salesHeads, ...accountHeads.filter((option) => option.category === "Sales")].map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                              </SelectGroup>
                              <SelectSeparator />
                              <SelectGroup>
                                <SelectLabel>Expenses · Chart of Accounts</SelectLabel>
                                {accountHeads.filter((option) => option.category === "Expenses").length ? accountHeads.filter((option) => option.category === "Expenses").map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>) : <SelectItem value="no-expense-accounts" disabled>Add expense heads in Chart of Accounts first</SelectItem>}
                              </SelectGroup>
                              <SelectSeparator />
                              <SelectGroup>
                                <SelectLabel>Payroll</SelectLabel>
                                {payrollHeads.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                              </SelectGroup>
                              {savedHeadOptions.length ? <><SelectSeparator /><SelectGroup><SelectLabel>Previously used heads</SelectLabel>{savedHeadOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></> : null}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className={`p-0 ${cellBorder}`}><Input aria-label={`Expected budget on line ${index + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={line.expected} onChange={(event) => updateLine(index, "expected", event.target.value)} className={`${cellInput} text-right tabular-nums`} /></td>
                        <td className={`px-2.5 text-right tabular-nums ${cellBorder}`}>{hasHead ? (directSourceKind ? <Button type="button" variant="link" className="h-auto p-0 text-sm tabular-nums" aria-label={`Open records behind ${formatAmount(actual, currency)} actual for ${resolvedLine.budgetHead || `line ${index + 1}`}`} nativeButton={false} render={<Link href={sourceHref(directSourceKind, resolvedLine)} />}>{formatAmount(actual, currency)}</Button> : <Button type="button" variant="link" className="h-auto p-0 text-sm tabular-nums" aria-label={`View records behind ${formatAmount(actual, currency)} actual for ${resolvedLine.budgetHead || `line ${index + 1}`}`} onClick={() => setActiveActualLine(resolvedLine)}>{formatAmount(actual, currency)}</Button>) : null}</td>
                        <td className={`px-2.5 text-right font-medium tabular-nums ${cellBorder} ${variance < 0 ? "text-destructive" : "text-primary"}`}>{hasHead ? formatAmount(variance, currency) : null}</td>
                        <td className={`p-0 ${cellBorder}`}><Input aria-label={`Description on line ${index + 1}`} value={line.description} maxLength={300} onChange={(event) => updateLine(index, "description", event.target.value)} className={cellInput} /></td>
                        <td className="px-1">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy budget line ${index + 1}`} title="Copy line" onClick={() => setLines((current) => current.flatMap((item, lineIndex) => lineIndex === index ? [item, { ...item }] : [item]))}><Copy size={14} /></Button>
                            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove budget line ${index + 1}`} title="Remove line" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, lineIndex) => lineIndex !== index) : [emptyBudgetLine()])}><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td />
                    <td className={cellBorder} />
                    <td className={`px-2.5 py-3 text-right ${cellBorder}`}>Total</td>
                    <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{formatAmount(expectedTotal, currency)}</td>
                    <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder}`}>{formatAmount(actualTotal, currency)}</td>
                    <td className={`px-2.5 py-3 text-right tabular-nums ${cellBorder} ${varianceTotal < 0 ? "text-destructive" : "text-primary"}`}>{formatAmount(varianceTotal, currency)}</td>
                    <td className={cellBorder} />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-2 border-t border-border px-4 py-3 sm:px-5">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, ...Array.from({ length: 5 }, emptyBudgetLine)])}><Plus size={14} />Add lines</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines(sheetLines([]))}>Clear all lines</Button>
            </div>
            <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <div className="w-full space-y-2 sm:max-w-sm"><label className="text-xs font-medium" htmlFor="budget-recipient">Send budget to</label><Input id="budget-recipient" type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="name@company.com" /></div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button type="button" variant="outline" className="gap-2" onClick={() => void saveBudget()} disabled={isSaving || isSending}><Save size={15} />{isSaving ? "Saving…" : "Save budget"}</Button>
                <Button type="button" className="gap-2" onClick={() => void saveAndSend()} disabled={isSaving || isSending}><Send size={15} />{isSending ? "Saving & sending…" : "Save & send"}</Button>
              </div>
            </div>
          </section>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(activeActualLine)} onOpenChange={(open) => { if (!open) setActiveActualLine(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{activeActualLine ? `${activeActualLine.budgetHead} actual` : "Actual details"}</DialogTitle>
            <DialogDescription>Records included from {dateRange.startDate || "the beginning"} to {dateRange.endDate || "today"}.</DialogDescription>
          </DialogHeader>
          {activeActualRecords.length ? <div className="divide-y divide-border rounded-md border border-border">
            {activeActualLine ? activeActualRecords.map((record) => (
              <div key={record.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{sourceRecordLabel(record)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{record.kind === "payroll" ? "Payroll" : record.kind === "invoices" ? "Sales invoice" : record.kind === "bills" ? "Bill" : "Expense"} · {sourceRecordDate(record)}</p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <span className="text-sm font-medium tabular-nums">{formatAmount(sourceRecordAmount(record), currency)}</span>
                  <Button type="button" variant="outline" size="sm" nativeButton={false} render={<Link href={sourceHref(record.kind, activeActualLine)} />}>
                    Open <ExternalLink size={14} />
                  </Button>
                </div>
              </div>
            )) : null}
          </div> : <p className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No saved records match this budget head and date range yet.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
