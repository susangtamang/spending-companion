import { describe, expect, it } from 'vitest';

import { sampleTransactions } from '../data/sampleTransactions';
import { calculateSpendingSummary, formatUsd } from './spending';

describe('calculateSpendingSummary', () => {
  it('separates posted and pending purchases and subtracts both from the budget', () => {
    const summary = calculateSpendingSummary(sampleTransactions, 250_000);

    expect(summary).toEqual({
      budgetCents: 250_000,
      postedCents: 4_900,
      pendingCents: 2_999,
      spentCents: 7_899,
      availableCents: 242_101,
    });
  });

  it('returns the full budget when there are no transactions', () => {
    expect(calculateSpendingSummary([], 170_000)).toEqual({
      budgetCents: 170_000,
      postedCents: 0,
      pendingCents: 0,
      spentCents: 0,
      availableCents: 170_000,
    });
  });

  it('rejects fractional cent amounts', () => {
    expect(() =>
      calculateSpendingSummary(
        [{ ...sampleTransactions[0]!, amountCents: 42.5 }],
        250_000,
      ),
    ).toThrow('tx-1.amountCents must be a safe integer number of cents.');
  });

  it('rejects an unsafe budget value', () => {
    expect(() =>
      calculateSpendingSummary([], Number.MAX_SAFE_INTEGER + 1),
    ).toThrow('budgetCents must be a safe integer number of cents.');
  });

  it('excludes non-purchases and transactions outside the selected month', () => {
    const transactions = [
      ...sampleTransactions,
      { ...sampleTransactions[0]!, id: 'refund', kind: 'refund' as const },
      { ...sampleTransactions[0]!, id: 'old', date: '2026-09-30' },
    ];
    expect(calculateSpendingSummary(transactions, 250_000, '2026-10').spentCents).toBe(7_899);
  });

  it('supports the budget view that excludes utilities', () => {
    const utilities = [{ ...sampleTransactions[0]!, category: 'Utilities', amountCents: 10_000 }];
    expect(calculateSpendingSummary(utilities, 170_000, '2026-10', true).spentCents).toBe(0);
  });
});

describe('formatUsd', () => {
  it('formats integer cents as US dollars', () => {
    expect(formatUsd(7_899)).toBe('$78.99');
  });
});
