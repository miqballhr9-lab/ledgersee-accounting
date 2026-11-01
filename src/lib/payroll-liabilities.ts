/**
 * What payroll still owes onwards: tax and other deductions kept back from
 * salaries, the employer's contributions, and salary attachments kept back
 * for a creditor or court, less what has already been paid over.
 */
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { deductionLog, isGarnishment } from "@/lib/ledger";

export type PayrollLiabilityKind = "incomeTax" | "social" | "withheld" | "employer" | "attachments";

export const payrollLiabilityLabels: Record<PayrollLiabilityKind, string> = {
  incomeTax: "Income tax withheld from salaries",
  social: "EOBI / social security withheld",
  withheld: "Other deductions withheld",
  employer: "Employer contributions",
  attachments: "Salary attachments (creditors, courts)",
};

const money = (value: string | undefined) => Number(value) || 0;

export function payrollLiabilitiesOwed(payrolls: BookkeepingRecord[], loans: BookkeepingRecord[], payments: BookkeepingRecord[]): Record<PayrollLiabilityKind, number> {
  const owed: Record<PayrollLiabilityKind, number> = { incomeTax: 0, social: 0, withheld: 0, employer: 0, attachments: 0 };
  for (const pay of payrolls) {
    const data = pay.data;
    if (!money(data.grossSalary) || /draft|cancel/i.test(data.status ?? "")) continue;
    const kept = Math.max(0, money(data.grossSalary) + money(data.reimbursement) - money(data.payableSalary) - money(data.loanDeduction) - money(data.advanceDeduction) - money(data.fineDeduction));
    const tax = Math.min(Math.max(0, money(data.taxDeduction)), kept);
    const social = Math.min(Math.max(0, money(data.socialDeduction)), kept - tax);
    owed.incomeTax += tax;
    owed.social += social;
    owed.withheld += kept - tax - social;
    owed.employer += money(data.employerContribution);
  }
  for (const loan of loans) {
    if (isGarnishment(loan.data.loanType)) owed.attachments += deductionLog(loan.data.deductionLog).reduce((sum, entry) => sum + entry.amount, 0);
  }
  for (const payment of payments) {
    const kind = payment.data.payrollLiability as PayrollLiabilityKind;
    if (kind in owed && !/void|cancel/i.test(payment.data.status ?? "")) owed[kind] -= money(payment.data.amount);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return { incomeTax: round(owed.incomeTax), social: round(owed.social), withheld: round(owed.withheld), employer: round(owed.employer), attachments: round(owed.attachments) };
}
