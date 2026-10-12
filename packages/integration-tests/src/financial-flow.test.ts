import { describe, expect, it } from "vitest";
import type {
  Budget,
  Category,
  FinancialAccount,
  MonthlySummary,
  Transaction,
} from "../../contracts/src/index.js";
import { calculateMonthlySummary } from "../../domain/src/index.js";
import { planCommit, planUndo, previewCsv } from "../../imports/src/index.js";
import {
  applyTransactionBatch,
  createReconciliationState,
} from "../../reconciliation/src/index.js";

const NOW = "2026-10-09T18:00:00.000Z";
const USER_ID = "user-integration";
const ACCOUNT_ID = "account-integration";
const CSV = [
  "sourceId,date,merchant,amount,status,category,kind",
  "csv-grocery,2026-10-03,Fresh Market,42.50,posted,groceries,purchase",
  "csv-coffee-pending,2026-10-07,Coffee House,12.99,pending,dining,purchase",
].join("\n");

const categories: readonly Category[] = [
  category("groceries", "Groceries"),
  category("dining", "Dining"),
];

const account: FinancialAccount = {
  id: ACCOUNT_ID,
  userId: USER_ID,
  connectionId: "connection-integration",
  sourceAccountId: "source-account-integration",
  name: "Checking",
  type: "checking",
  includeInSpending: true,
  currencyCode: "USD",
  createdAt: NOW,
  updatedAt: NOW,
};

const budget: Budget = {
  id: "budget-integration",
  userId: USER_ID,
  mode: "including_utilities",
  month: "2026-10",
  amountCents: 100_000,
  createdAt: NOW,
  updatedAt: NOW,
};

const unrelated = transaction({
  id: "manual-unrelated",
  source: "manual",
  status: "posted",
  amountCents: 700,
  displayMerchant: "Book Store",
  normalizedMerchant: "book store",
  sourceCategoryId: "dining",
  occurrenceDate: "2026-10-01",
  postedDate: "2026-10-01",
});

describe("cross-package financial workflow", () => {
  it("previews, commits, summarizes, replaces pending, and remains stable on retry", () => {
    const preview = previewCsv(CSV, importOptions());
    expect(preview.rows.map((row) => row.disposition)).toEqual(["valid", "valid"]);

    const commit = planCommit(preview, NOW);
    const committedTransactions = [unrelated, ...commit.transactions];
    const beforeReplacement = summarize(committedTransactions);

    expect(beforeReplacement).toMatchObject({
      postedCents: 4_950,
      pendingCents: 1_299,
      spentCents: 6_249,
      transactionCount: 3,
    });
    expectReconciledBreakdowns(beforeReplacement);

    const replacement = transaction({
      id: "posted-coffee-replacement",
      source: "csv",
      sourceTransactionId: "csv-coffee-posted",
      pendingTransactionId: "csv-coffee-pending",
      status: "posted",
      amountCents: 1_299,
      displayMerchant: "Coffee House",
      normalizedMerchant: "coffee house",
      sourceCategoryId: "dining",
      occurrenceDate: "2026-10-07",
      postedDate: "2026-10-09",
    });
    const reconciled = applyTransactionBatch(
      createReconciliationState(committedTransactions),
      [replacement],
      NOW,
    );
    const afterReplacement = summarize(reconciled.transactions);

    expect(afterReplacement).toMatchObject({
      postedCents: 6_249,
      pendingCents: 0,
      spentCents: 6_249,
      transactionCount: 3,
    });
    expectReconciledBreakdowns(afterReplacement);
    expect(reconciled.transactions.find(({ id }) => id === "csv-row-3-csv-coffee-pending"))
      .toMatchObject({ status: "removed", reconciledToTransactionId: replacement.id });

    const retry = applyTransactionBatch(reconciled, [replacement], "2026-10-09T18:01:00.000Z");
    const afterRetry = summarize(retry.transactions);
    expect(afterRetry.spentCents).toBe(afterReplacement.spentCents);
    expect(afterRetry.postedCents).toBe(afterReplacement.postedCents);
    expect(afterRetry.transactionCount).toBe(afterReplacement.transactionCount);
    expect(retry.decisions).toHaveLength(1);
    expect(retry.audit).toHaveLength(1);

    const replayedCommit = planCommit(preview, "2026-10-09T18:02:00.000Z", {
      batchId: commit.batch.id,
      fingerprint: commit.fingerprint,
      committedAt: commit.batch.committedAt!,
    });
    expect(replayedCommit.replay).toBe(true);
    expect(replayedCommit.transactions).toEqual(commit.transactions);
  });

  it("plans undo for only the imported transactions and preserves unrelated records", () => {
    const commit = planCommit(previewCsv(CSV, importOptions()), NOW);
    const stored = [unrelated, ...commit.transactions];
    const undo = planUndo(
      commit.batch,
      commit.transactions.map(({ id }) => id),
      "2026-10-10T12:00:00.000Z",
    );
    const undoIds = new Set(undo.transactionIds);
    const remaining = stored.filter((transaction) => !undoIds.has(transaction.id));

    expect(undo.replay).toBe(false);
    expect(undo.transactionIds).toEqual([
      "csv-row-2-csv-grocery",
      "csv-row-3-csv-coffee-pending",
    ]);
    expect(remaining).toEqual([unrelated]);
    const summary = summarize(remaining);
    expect(summary.spentCents).toBe(700);
    expect(summary.transactionCount).toBe(1);
    expectReconciledBreakdowns(summary);
  });
});

function importOptions() {
  return {
    userId: USER_ID,
    financialAccountId: ACCOUNT_ID,
    importContext: "checking-statement",
    batchId: "batch-integration",
    fileName: "october.csv",
    now: NOW,
    existing: [],
    transactionIdForRow: (rowNumber: number, sourceId: string) =>
      `csv-row-${rowNumber}-${sourceId}`,
  };
}

function summarize(transactions: readonly Transaction[]): MonthlySummary {
  return calculateMonthlySummary({
    month: "2026-10",
    budget,
    transactions,
    categories,
    accounts: [account],
    policy: {
      timezone: "America/Chicago",
      calculatedAt: NOW,
      dataFreshAsOf: NOW,
    },
  });
}

function expectReconciledBreakdowns(summary: MonthlySummary): void {
  const categoryTotal = summary.categoryBreakdown.reduce((sum, row) => sum + row.amountCents, 0);
  const merchantTotal = summary.merchantBreakdown.reduce((sum, row) => sum + row.amountCents, 0);
  expect(categoryTotal).toBe(summary.spentCents);
  expect(merchantTotal).toBe(summary.spentCents);
}

function category(id: string, name: string): Category {
  return {
    id,
    name,
    isUtility: false,
    isSystem: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function transaction(overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    userId: USER_ID,
    financialAccountId: ACCOUNT_ID,
    source: "manual",
    status: "pending",
    kind: "purchase",
    amountCents: 0,
    currencyCode: "USD",
    displayMerchant: "Unknown",
    normalizedMerchant: "unknown",
    occurrenceDate: "2026-10-01",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
