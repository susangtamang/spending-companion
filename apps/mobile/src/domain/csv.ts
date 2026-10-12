import { parseUsdToCents } from './money';
import type { Transaction, TransactionKind, TransactionStatus } from './transaction';

export const CSV_HEADER = 'sourceId,date,merchant,amount,status,category,kind';

export type CsvPreview = {
  transactions: Transaction[];
  errors: string[];
  duplicates: string[];
};

export function previewCsv(csv: string, existing: readonly Transaction[], now: string): CsvPreview {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0 || lines[0]?.trim() !== CSV_HEADER) {
    return { transactions: [], duplicates: [], errors: [`Header must be: ${CSV_HEADER}`] };
  }

  const knownIds = new Set(existing.map((transaction) => transaction.sourceId).filter(Boolean));
  const batchIds = new Set<string>();
  const transactions: Transaction[] = [];
  const duplicates: string[] = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const fields = parseCsvLine(line);
    if (fields.length !== 7) {
      errors.push(`Row ${rowNumber}: expected 7 columns.`);
      return;
    }
    const [sourceId, date, merchant, amount, status, category, kind] = fields.map((field) => field.trim());
    if (!sourceId || !merchant || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      errors.push(`Row ${rowNumber}: sourceId, valid date, merchant, and category are required.`);
      return;
    }
    if (knownIds.has(sourceId) || batchIds.has(sourceId)) {
      duplicates.push(sourceId);
      return;
    }
    if (status !== 'posted' && status !== 'pending') {
      errors.push(`Row ${rowNumber}: status must be posted or pending.`);
      return;
    }
    if (!isTransactionKind(kind)) {
      errors.push(`Row ${rowNumber}: invalid kind.`);
      return;
    }
    try {
      batchIds.add(sourceId);
      transactions.push({
        id: `import-${sourceId}`,
        sourceId,
        date,
        merchant,
        amountCents: parseUsdToCents(amount ?? ''),
        status: status as TransactionStatus,
        category,
        kind,
        source: 'import',
        importedAt: now,
      });
    } catch (error) {
      errors.push(`Row ${rowNumber}: ${error instanceof Error ? error.message : 'invalid amount.'}`);
    }
  });

  return { transactions, duplicates, errors };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += character;
  }
  fields.push(current);
  return fields;
}

function isTransactionKind(value: string | undefined): value is TransactionKind {
  return ['purchase', 'payment', 'transfer', 'cash', 'refund'].includes(value ?? '');
}
