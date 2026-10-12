export type TransactionStatus = 'posted' | 'pending';
export type TransactionKind = 'purchase' | 'payment' | 'transfer' | 'cash' | 'refund';
export type TransactionSource = 'manual' | 'import';

export type Transaction = {
  id: string;
  merchant: string;
  amountCents: number;
  category: string;
  status: TransactionStatus;
  kind: TransactionKind;
  date: string;
  source: TransactionSource;
  sourceId?: string;
  importedAt?: string;
};
