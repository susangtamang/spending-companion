import type { Transaction } from '../domain/transaction';

export const sampleTransactions: readonly Transaction[] = [
  { id: 'tx-1', merchant: 'Walmart', amountCents: 4_250, category: 'groceries', status: 'posted', kind: 'purchase', date: '2026-10-03', source: 'manual' },
  { id: 'tx-2', merchant: 'Starbucks', amountCents: 650, category: 'dining', status: 'posted', kind: 'purchase', date: '2026-10-06', source: 'manual' },
  { id: 'tx-3', merchant: 'Amazon', amountCents: 2_999, category: 'shopping', status: 'pending', kind: 'purchase', date: '2026-10-08', source: 'manual' },
];
