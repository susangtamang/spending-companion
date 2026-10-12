import type { PlaidTransactionRecord } from "../../plaid/src/index.js";
import { normalizeMerchant } from "@spending-companion/reconciliation";

import type { NormalizedSyncTransaction } from "./types.js";

export function normalizePlaidTransaction(record: PlaidTransactionRecord): NormalizedSyncTransaction {
  if (record.isoCurrencyCode !== undefined && record.isoCurrencyCode !== "USD") {
    throw new Error(`Transaction ${record.transactionId} is not USD.`);
  }
  if (!Number.isSafeInteger(record.signedAmountCents)) {
    throw new Error(`Transaction ${record.transactionId} amount is not safe integer cents.`);
  }
  const displayMerchant = (record.merchantName ?? record.name).trim();
  if (!displayMerchant) throw new Error(`Transaction ${record.transactionId} merchant is required.`);
  const occurrence = record.authorizedDate ?? record.date;
  assertDate(occurrence);
  assertDate(record.date);
  const common = {
    providerTransactionId: record.transactionId,
    providerAccountId: record.accountId,
    ...(record.pendingTransactionId === undefined ? {} : { pendingProviderTransactionId: record.pendingTransactionId }),
    status: record.pending ? "PENDING" as const : "POSTED" as const,
    kind: record.signedAmountCents < 0 ? "REFUND" as const : "PURCHASE" as const,
    amountCents: BigInt(Math.abs(record.signedAmountCents)),
    ...(record.merchantName === undefined ? {} : { rawMerchant: record.merchantName }),
    displayMerchant,
    normalizedMerchant: normalizeMerchant(displayMerchant),
    occurrenceDate: dateOnly(occurrence),
    raw: record.raw,
  };
  return record.pending ? common : { ...common, postedDate: dateOnly(record.date) };
}

function assertDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Plaid date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid Plaid date: ${value}`);
}

function dateOnly(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
