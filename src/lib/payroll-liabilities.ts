/**
 * What payroll still owes onwards: tax and other deductions kept back from
 * salaries, the employer's contributions, and salary attachments kept back
 * for a creditor or court, less what has already been paid over.
 */
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { deductionLog, isGarnishment } from "@/lib/ledger";

export type PayrollLiabilityKind = "withheld" | "employer" | "attachments";

export const payrollLiabilityLabels: Record<PayrollLiabilityKind, string> = {
  withheld: "Tax and deductions withheld",
  employer: "Employer contributions",
  attachments: "Salary attachments (creditors, courts)",
};

const money = (value: string | undefined) => Number(value) || 0;

export function payrollLiabilitiesOwed(payrolls: BookkeepingRecord[], loans: BookkeepingRecord[], payments: BookkeepingRecord[]): Record<PayrollLiabilityKind, number> {
  const owed: Record<PayrollLiabilityKind, number> = { withheld: 0, employer: 0, attachments: 0 };
  for (const pay of payrolls) {
    const data = pay.data;
    if (!money(data.grossSalary) || /draft|cancel/i.test(data.status ?? "")) continue;
    owed.withheld += Math.max(0, money(data.grossSalary) - money(data.payableSalary) - money(data.loanDeduction) - money(data.advanceDeduction) - money(data.fineDeduction));
    owed.employer += money(data.employerContribution);
  }
  for (const loan of loans) {
    if (isGarnishment(loan.data.loanType)) owed.attachments += deductionLog(loan.data.deductionLog).reduce((sum, entry) => sum + entry.amount, 0);
  }
  for (const payment of payments) {
    const kind = payment.data.payrollLiability as PayrollLiabilityKind;
    if (kind in owed && !/void|cancel/i.test(payment.data.status ?? "")) owed[kind] -= money(payment.data.amount);
  }
  return { withheld: Math.round(owed.withheld * 100) / 100, employer: Math.round(owed.employer * 100) / 100, attachments: Math.round(owed.attachments * 100) / 100 };
}
