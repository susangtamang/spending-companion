import { describe, expect, it } from 'vitest';

import { CSV_HEADER, previewCsv } from './csv';
import type { Transaction } from './transaction';

const existing: Transaction[] = [{
  id: 'existing', sourceId: 'bank-1', merchant: 'Store', amountCents: 100,
  category: 'shopping', status: 'posted', kind: 'purchase', date: '2026-10-01', source: 'import',
}];

describe('previewCsv', () => {
  it('parses the documented format and quoted commas', () => {
    const result = previewCsv(
      `${CSV_HEADER}\nbank-2,2026-10-09,"Market, Inc.",12.34,pending,groceries,purchase`,
      existing,
      '2026-10-09T12:00:00.000Z',
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions[0]).toMatchObject({ sourceId: 'bank-2', merchant: 'Market, Inc.', amountCents: 1_234 });
  });

  it('skips source IDs already imported', () => {
    const result = previewCsv(`${CSV_HEADER}\nbank-1,2026-10-09,Store,1.00,posted,shopping,purchase`, existing, '2026-10-09T12:00:00.000Z');
    expect(result.transactions).toEqual([]);
    expect(result.duplicates).toEqual(['bank-1']);
  });

  it('reports invalid rows without importing them', () => {
    const result = previewCsv(`${CSV_HEADER}\nbank-3,bad-date,Store,1.001,unknown,shopping,purchase`, existing, '2026-10-09T12:00:00.000Z');
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
