import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { isClosedStage } from "@/lib/crm-config";
import { buildInventory } from "@/lib/inventory";
import { currencyAmount } from "@/lib/invoice-utils";
import { accountOf, buildLedger } from "@/lib/ledger";
import { paymentAccountLabel, paymentAccountType } from "@/lib/payment-accounts";

/**
 * The assistant's view of the business: a few lines of insight for the panel,
 * ready answers to the common questions (these work without any AI), and a
 * plain-text brief of the numbers that the AI answers free questions from.
 * Everything comes from records the person may already read.
 */

export interface AssistantQuestion {
  key: string;
  label: string;
}

export interface AssistantBrief {
  currency: string;
  insights: { text: string; question: AssistantQuestion }[];
  questions: AssistantQuestion[];
  /** Ready answers by question key, written from the books. */
  answers: Record<string, string>;
  /** Facts for the AI, as short labelled lines. */
  facts: string;
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthKey(date: string) {
  return date.slice(0, 7);
}

function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${monthNames[m - 1]} ${y}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const num = (value: string | undefined) => Number(value) || 0;

export function buildAssistantBrief(records: BookkeepingRecord[], today: string, workspaceName = ""): AssistantBrief {
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  const currency = settings.currency || "USD";
  const money = (value: number) => currencyAmount(Math.round(value * 100) / 100, currency);
  const byKind = (kind: string) => records.filter((record) => record.kind === kind);
  const lines: string[] = [`Business: ${settings.companyName || workspaceName || "this business"}`, `Home currency: ${currency}`, `Today: ${today}`];
  const answers: Record<string, string> = {};
  const insights: AssistantBrief["insights"] = [];
  const questions: AssistantQuestion[] = [];
  const hasBooks = records.some((record) => ["invoices", "bills", "expenses", "journals", "accounts"].includes(record.kind));

  if (hasBooks) {
    const ledger = buildLedger(records, settings.accountingMethod === "Cash" ? "cash" : "accrual");
    const thisMonth = monthKey(today);
    const lastMonth = shiftMonth(thisMonth, -1);
    const months = Array.from({ length: 12 }, (_, index) => shiftMonth(thisMonth, index - 11));
    const totals = new Map(months.map((key) => [key, { income: 0, expenses: 0 }]));
    const expenseHeads = new Map<string, Map<string, number>>();
    const incomeHeads = new Map<string, number>();
    const yearStart = `${today.slice(0, 4)}-01-01`;
    for (const posting of ledger.postings) {
      if (posting.date > today) continue;
      const category = accountOf(ledger, posting.account).category;
      if (category !== "Income" && category !== "Expense") continue;
      const bucket = totals.get(monthKey(posting.date));
      if (bucket) {
        if (category === "Income") bucket.income -= posting.amount;
        else bucket.expenses += posting.amount;
      }
      if (category === "Expense") {
        const heads = expenseHeads.get(monthKey(posting.date)) ?? new Map<string, number>();
        heads.set(posting.account, (heads.get(posting.account) ?? 0) + posting.amount);
        expenseHeads.set(monthKey(posting.date), heads);
      }
      if (category === "Income" && posting.date >= yearStart) incomeHeads.set(posting.account, (incomeHeads.get(posting.account) ?? 0) - posting.amount);
    }
    const net = (key: string) => (totals.get(key)?.income ?? 0) - (totals.get(key)?.expenses ?? 0);
    const year = months.filter((key) => key >= yearStart.slice(0, 7));
    const ytd = year.reduce((sum, key) => ({ income: sum.income + (totals.get(key)?.income ?? 0), expenses: sum.expenses + (totals.get(key)?.expenses ?? 0) }), { income: 0, expenses: 0 });
    const topHeads = (keys: string[], count: number) => {
      const merged = new Map<string, number>();
      for (const key of keys) for (const [name, amount] of expenseHeads.get(key) ?? []) merged.set(name, (merged.get(name) ?? 0) + amount);
      return [...merged].filter(([, amount]) => amount > 0.005).sort((a, b) => b[1] - a[1]).slice(0, count);
    };

    lines.push("", "Profit and loss by month (income, expenses, net):");
    for (const key of months) {
      const bucket = totals.get(key)!;
      if (Math.abs(bucket.income) > 0.005 || Math.abs(bucket.expenses) > 0.005) lines.push(`- ${monthLabel(key)}: income ${money(bucket.income)}, expenses ${money(bucket.expenses)}, net ${money(net(key))}`);
    }
    lines.push(`Year to date ${today.slice(0, 4)}: income ${money(ytd.income)}, expenses ${money(ytd.expenses)}, net ${money(ytd.income - ytd.expenses)}`);
    const lastHeads = topHeads([lastMonth], 6);
    if (lastHeads.length) lines.push(`Biggest expenses in ${monthLabel(lastMonth)}: ${lastHeads.map(([name, amount]) => `${name} ${money(amount)}`).join("; ")}`);
    const yearHeads = topHeads(year, 8);
    if (yearHeads.length) lines.push(`Biggest expenses this year: ${yearHeads.map(([name, amount]) => `${name} ${money(amount)}`).join("; ")}`);
    const incomeTop = [...incomeHeads].filter(([, amount]) => amount > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (incomeTop.length) lines.push(`Income this year by account: ${incomeTop.map(([name, amount]) => `${name} ${money(amount)}`).join("; ")}`);

    const last = totals.get(lastMonth)!;
    const now = totals.get(thisMonth)!;
    answers.pnl = [
      `**${monthLabel(lastMonth)}:** income ${money(last.income)}, expenses ${money(last.expenses)}, net ${net(lastMonth) >= 0 ? "profit" : "loss"} of ${money(Math.abs(net(lastMonth)))}.`,
      `**${monthLabel(thisMonth)} so far:** income ${money(now.income)}, expenses ${money(now.expenses)}, net ${money(net(thisMonth))}.`,
      `**This year so far:** income ${money(ytd.income)}, expenses ${money(ytd.expenses)}, net ${money(ytd.income - ytd.expenses)}.`,
      lastHeads.length ? `Biggest expenses last month: ${lastHeads.slice(0, 3).map(([name, amount]) => `${name} (${money(amount)})`).join(", ")}.` : "",
    ].filter(Boolean).join("\n");
    questions.push({ key: "pnl", label: "Summarise my profit and loss" });
    // Early in a business's life last month can be empty; this month's figures say more then.
    const quietLastMonth = Math.abs(last.income) < 0.005 && Math.abs(last.expenses) < 0.005;
    insights.push({ text: quietLastMonth ? `Your net income so far this month is ${money(net(thisMonth))}.` : `Your net income last month was ${money(net(lastMonth))}.`, question: { key: "pnl", label: "Summarise my profit and loss" } });

    const recent = Array.from({ length: 6 }, (_, index) => shiftMonth(thisMonth, index - 6));
    const withSpend = recent.filter((key) => (totals.get(key)?.expenses ?? 0) > 0.005);
    const average = withSpend.length ? withSpend.reduce((sum, key) => sum + totals.get(key)!.expenses, 0) / withSpend.length : 0;
    answers.expenses = withSpend.length
      ? [`Your average monthly expenses over the last ${withSpend.length} ${withSpend.length === 1 ? "month" : "months"} with spending were **${money(average)}**.`, `Last month you spent ${money(last.expenses)}${average ? ` (${last.expenses >= average ? `${Math.round(((last.expenses - average) / average) * 100)}% above` : `${Math.round(((average - last.expenses) / average) * 100)}% below`} the average)` : ""}.`, ...recent.filter((key) => totals.get(key)!.expenses > 0.005).map((key) => `- ${monthLabel(key)}: ${money(totals.get(key)!.expenses)}`), topHeads(recent, 3).length ? `Biggest heads: ${topHeads(recent, 3).map(([name, amount]) => `${name} (${money(amount)})`).join(", ")}.` : ""].filter(Boolean).join("\n")
      : "No expenses are recorded in the last six months yet.";
    questions.push({ key: "expenses", label: "What are my average monthly expenses?" });
    insights.push({ text: quietLastMonth ? `Your expenses so far this month are ${money(now.expenses)}.` : `Your expenses last month were ${money(last.expenses)}.`, question: { key: "expenses", label: "What are my average monthly expenses?" } });

    // Money in the bank, card and cash accounts today.
    const banks = byKind("accounts").filter((account) => paymentAccountType(account));
    const balances = banks.map((account) => {
      const name = (account.data.name ?? "").trim().toLowerCase();
      const balance = ledger.postings.filter((posting) => posting.date <= today && posting.account.trim().toLowerCase() === name).reduce((sum, posting) => sum + posting.amount, 0);
      return { name: paymentAccountLabel(account), balance, card: paymentAccountType(account) === "Credit card" };
    }).filter((row) => Math.abs(row.balance) > 0.005);
    if (balances.length) {
      lines.push("", "Bank, cash and card balances today:", ...balances.map((row) => `- ${row.name}: ${money(row.card ? -row.balance : row.balance)}${row.card ? " owed on the card" : ""}`));
      const cash = balances.filter((row) => !row.card).reduce((sum, row) => sum + row.balance, 0);
      answers.cash = [`You have **${money(cash)}** across your bank and cash accounts.`, ...balances.map((row) => `- ${row.name}: ${money(row.card ? -row.balance : row.balance)}${row.card ? " owed" : ""}`)].join("\n");
      questions.push({ key: "cash", label: "How much money is in my bank accounts?" });
    }

    // Who owes the business.
    const openInvoices = byKind("invoices").filter((invoice) => invoice.data.docType !== "Sales receipt" && !["Draft", "Void", "Cancelled"].includes(invoice.data.status ?? ""))
      .map((invoice) => ({ invoice, balance: Math.max(0, num(invoice.data.amount) - num(invoice.data.paidAmount) - num(invoice.data.creditApplied)) }))
      .filter((row) => row.balance > 0.005);
    const owed = openInvoices.reduce((sum, row) => sum + row.balance, 0);
    const overdueInvoices = openInvoices.filter((row) => row.invoice.data.dueDate && row.invoice.data.dueDate < today).sort((a, b) => (a.invoice.data.dueDate ?? "").localeCompare(b.invoice.data.dueDate ?? ""));
    const overdue = overdueInvoices.reduce((sum, row) => sum + row.balance, 0);
    const byCustomer = new Map<string, number>();
    for (const row of openInvoices) byCustomer.set(row.invoice.data.customer || "Unnamed", (byCustomer.get(row.invoice.data.customer || "Unnamed") ?? 0) + row.balance);
    const topCustomers = [...byCustomer].sort((a, b) => b[1] - a[1]).slice(0, 8);
    lines.push("", `Customers owe ${money(owed)} on ${openInvoices.length} open invoices; ${money(overdue)} of it is overdue.`);
    if (topCustomers.length) lines.push(`Biggest balances: ${topCustomers.map(([name, amount]) => `${name} ${money(amount)}`).join("; ")}`);
    if (overdueInvoices.length) lines.push("Overdue invoices:", ...overdueInvoices.slice(0, 15).map((row) => `- ${row.invoice.data.invoiceNumber || "Invoice"} · ${row.invoice.data.customer} · due ${row.invoice.data.dueDate} · ${money(row.balance)}`));
    answers.receivables = openInvoices.length
      ? [`Customers owe you **${money(owed)}** on ${openInvoices.length} open ${openInvoices.length === 1 ? "invoice" : "invoices"}; **${money(overdue)}** is overdue.`, ...topCustomers.slice(0, 5).map(([name, amount]) => `- ${name}: ${money(amount)}`), overdueInvoices.length ? `Oldest overdue: ${overdueInvoices[0].invoice.data.invoiceNumber || "an invoice"} for ${overdueInvoices[0].invoice.data.customer}, due ${overdueInvoices[0].invoice.data.dueDate}.` : ""].filter(Boolean).join("\n")
      : "Nobody owes you anything right now. Every invoice is paid.";
    questions.push({ key: "receivables", label: "Who owes me money?" });
    if (owed > 0.005) insights.push({ text: `Customers owe you ${money(owed)}${overdue > 0.005 ? `, ${money(overdue)} of it overdue` : ""}.`, question: { key: "receivables", label: "Who owes me money?" } });

    // What the business owes.
    const openBills = byKind("bills").filter((bill) => !["Draft", "Void", "Cancelled", "Pending approval", "Paid"].includes(bill.data.status ?? ""))
      .map((bill) => ({ bill, balance: Math.max(0, num(bill.data.amount) - num(bill.data.paidAmount) - num(bill.data.creditApplied)) }))
      .filter((row) => row.balance > 0.005)
      .sort((a, b) => (a.bill.data.dueDate ?? "9999").localeCompare(b.bill.data.dueDate ?? "9999"));
    const weekAhead = addDays(today, 7);
    const lateBills = openBills.filter((row) => row.bill.data.dueDate && row.bill.data.dueDate < today);
    const soonBills = openBills.filter((row) => row.bill.data.dueDate && row.bill.data.dueDate >= today && row.bill.data.dueDate <= weekAhead);
    const owing = openBills.reduce((sum, row) => sum + row.balance, 0);
    lines.push("", `You owe suppliers ${money(owing)} on ${openBills.length} open bills.`);
    if (openBills.length) lines.push("Open bills by due date:", ...openBills.slice(0, 15).map((row) => `- ${row.bill.data.billNumber || "Bill"} · ${row.bill.data.vendor} · due ${row.bill.data.dueDate || "—"} · ${money(row.balance)}`));
    const billLine = (row: (typeof openBills)[number]) => `- ${row.bill.data.vendor || "Supplier"} · ${row.bill.data.billNumber || "bill"} · due ${row.bill.data.dueDate} · ${money(row.balance)}`;
    answers.bills = openBills.length
      ? [`You owe suppliers **${money(owing)}** on ${openBills.length} open ${openBills.length === 1 ? "bill" : "bills"}.`, lateBills.length ? `**Overdue (${lateBills.length}):**` : "", ...lateBills.slice(0, 6).map(billLine), soonBills.length ? `**Due in the next 7 days (${soonBills.length}):**` : "No bills fall due in the next 7 days.", ...soonBills.slice(0, 6).map(billLine)].filter(Boolean).join("\n")
      : "You have no unpaid bills.";
    questions.push({ key: "bills", label: "Which bills are due soon?" });
  }

  // Stock that needs reordering.
  const items = byKind("items");
  if (items.length) {
    const stock = buildInventory(records);
    const low = items.filter((item) => stock.has(item.id) && num(item.data.reorderPoint) > 0 && stock.get(item.id)!.onHand <= num(item.data.reorderPoint));
    if (low.length) {
      lines.push("", "Items at or below their reorder point:", ...low.slice(0, 15).map((item) => `- ${item.data.name}: ${stock.get(item.id)!.onHand} on hand, reorder at ${item.data.reorderPoint}`));
      answers.stock = [`**${low.length} ${low.length === 1 ? "item is" : "items are"}** at or below the reorder point:`, ...low.slice(0, 10).map((item) => `- ${item.data.name}: ${stock.get(item.id)!.onHand} left (reorder at ${item.data.reorderPoint})`)].join("\n");
      questions.push({ key: "stock", label: "What stock do I need to reorder?" });
    }
  }

  // CRM, when the person can see it.
  const deals = byKind("crm-deals");
  if (deals.length || byKind("crm-leads").length) {
    const open = deals.filter((deal) => !isClosedStage(deal.data.stage));
    const thisMonth = monthKey(today);
    const won = deals.filter((deal) => deal.data.stage === "Closed Won" && (deal.data.closedOn || deal.data.closingDate || "").startsWith(thisMonth));
    lines.push("", `CRM: ${open.length} open deals worth ${money(open.reduce((sum, deal) => sum + num(deal.data.amount), 0))} (expected ${money(open.reduce((sum, deal) => sum + num(deal.data.expectedRevenue), 0))}); won this month ${money(won.reduce((sum, deal) => sum + num(deal.data.amount), 0))}; ${byKind("crm-leads").filter((lead) => lead.createdAt.startsWith(thisMonth)).length} new leads this month; ${byKind("crm-tasks").filter((task) => task.data.status !== "Completed" && task.data.dueDate && task.data.dueDate < today).length} overdue tasks.`);
    const closing = open.filter((deal) => (deal.data.closingDate || "").startsWith(thisMonth)).slice(0, 10);
    if (closing.length) lines.push("Deals closing this month:", ...closing.map((deal) => `- ${deal.data.dealName} · ${deal.data.account} · ${deal.data.stage} · ${money(num(deal.data.amount))}`));
  }

  // HR, when the person can see it.
  const employees = byKind("employees").filter((employee) => !["Archived", "Inactive", "Terminated"].includes(employee.data.status ?? "") && employee.data.archived !== "true");
  if (employees.length) {
    const onLeave = byKind("hr-leaves").filter((leave) => leave.data.status === "Approved" && (leave.data.fromDate ?? "") <= today && (leave.data.toDate ?? "") >= today);
    const pending = byKind("hr-leaves").filter((leave) => ["To Approve", "Second Approval"].includes(leave.data.status ?? ""));
    lines.push("", `People: ${employees.length} employees; ${onLeave.length} on leave today; ${pending.length} leave requests waiting for approval.`);
  }

  return { currency, insights: insights.slice(0, 3), questions, answers, facts: lines.join("\n") };
}
