import type { Transaction } from './transaction';

export type SpendingSummary = {
  budgetCents: number;
  postedCents: number;
  pendingCents: number;
  spentCents: number;
  availableCents: number;
};

export type CategoryTotal = { category: string; amountCents: number };

export function calculateSpendingSummary(
  transactions: readonly Transaction[],
  budgetCents: number,
  month?: string,
  excludeUtilities = false,
): SpendingSummary {
  assertIntegerCents(budgetCents, 'budgetCents');
  let postedCents = 0;
  let pendingCents = 0;

  for (const transaction of transactions) {
    assertIntegerCents(transaction.amountCents, `${transaction.id}.amountCents`);
    if (transaction.kind !== 'purchase') continue;
    if (month && !transaction.date.startsWith(`${month}-`)) continue;
    if (excludeUtilities && transaction.category.toLowerCase() === 'utilities') continue;
    if (transaction.status === 'posted') postedCents += transaction.amountCents;
    else pendingCents += transaction.amountCents;
  }

  const spentCents = postedCents + pendingCents;
  return { budgetCents, postedCents, pendingCents, spentCents, availableCents: budgetCents - spentCents };
}

export function calculateCategoryTotals(
  transactions: readonly Transaction[],
  month?: string,
): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.kind !== 'purchase') continue;
    if (month && !transaction.date.startsWith(`${month}-`)) continue;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amountCents);
  }
  return [...totals.entries()]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

export function formatUsd(amountCents: number): string {
  assertIntegerCents(amountCents, 'amountCents');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100);
}

function assertIntegerCents(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${fieldName} must be a safe integer number of cents.`);
}
