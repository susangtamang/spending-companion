import { describe, expect, it } from "vitest";
import type { Transaction } from "@spending-companion/contracts";
import {
  applyTransactionBatch,
  confirmReconciliation,
  createReconciliationState,
  suggestReconciliationCandidates,
} from "./index.js";

const NOW = "2026-10-09T12:00:00.000Z";

function transaction(overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    userId: "user-1",
    financialAccountId: "account-1",
    source: "plaid",
    sourceTransactionId: `source-${overrides.id}`,
    status: "pending",
    kind: "purchase",
    amountCents: 1_299,
    currencyCode: "USD",
    displayMerchant: "Coffee Shop",
    normalizedMerchant: "coffee shop",
    occurrenceDate: "2026-10-07",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("provider reconciliation", () => {
  it("uses an explicit pending source link and keeps posted canonical", () => {
    const pending = transaction({ id: "pending", sourceTransactionId: "provider-pending" });
    const posted = transaction({
      id: "posted",
      sourceTransactionId: "provider-posted",
      status: "posted",
      pendingTransactionId: "provider-pending",
      postedDate: "2026-10-09",
    });

    const result = applyTransactionBatch(createReconciliationState(), [pending, posted], NOW);

    expect(result.transactions.find(({ id }) => id === "pending")).toMatchObject({
      status: "removed",
      reconciledToTransactionId: "posted",
      audit: { removalReason: "replaced_by_posted_transaction" },
    });
    expect(result.transactions.find(({ id }) => id === "posted")).toEqual(posted);
    expect(result.decisions).toHaveLength(1);
    expect(result.audit).toHaveLength(1);
  });

  it("is idempotent when a sync page is retried", () => {
    const pending = transaction({ id: "pending", sourceTransactionId: "provider-pending" });
    const posted = transaction({
      id: "posted",
      status: "posted",
      pendingTransactionId: "provider-pending",
    });
    const first = applyTransactionBatch(createReconciliationState(), [pending, posted], NOW);
    const retry = applyTransactionBatch(first, [pending, posted], "2026-10-09T12:01:00.000Z");

    expect(retry.decisions).toEqual(first.decisions);
    expect(retry.audit).toEqual(first.audit);
    expect(retry.transactions.find(({ id }) => id === "pending")?.reconciledToTransactionId).toBe("posted");
  });

  it("reconciles when the posted and pending records arrive in either batch order", () => {
    const pending = transaction({ id: "pending", sourceTransactionId: "provider-pending" });
    const posted = transaction({
      id: "posted",
      status: "posted",
      pendingTransactionId: "provider-pending",
    });

    const postedFirst = applyTransactionBatch(createReconciliationState(), [posted], NOW);
    const completed = applyTransactionBatch(postedFirst, [pending], NOW);

    expect(completed.transactions.find(({ id }) => id === "pending")).toMatchObject({
      status: "removed",
      reconciledToTransactionId: "posted",
    });
  });

  it("rejects explicit links across users or accounts", () => {
    const pending = transaction({ id: "pending", sourceTransactionId: "provider-pending" });
    const wrongUser = transaction({
      id: "wrong-user",
      userId: "user-2",
      status: "posted",
      pendingTransactionId: "provider-pending",
    });
    const wrongAccount = transaction({
      id: "wrong-account",
      financialAccountId: "account-2",
      status: "posted",
      pendingTransactionId: "provider-pending",
    });

    const result = applyTransactionBatch(
      createReconciliationState(),
      [pending, wrongUser, wrongAccount],
      NOW,
    );

    expect(result.rejectedExplicitLinks).toHaveLength(2);
    expect(result.decisions).toHaveLength(0);
    expect(result.transactions.find(({ id }) => id === "pending")?.status).toBe("pending");
  });

  it("retains removed records and their source audit", () => {
    const removed = transaction({
      id: "removed",
      status: "removed",
      audit: { sourceRevision: "revision-3", removalReason: "provider_removed" },
    });

    const result = applyTransactionBatch(createReconciliationState(), [removed], NOW);

    expect(result.transactions).toContainEqual(removed);
    expect(result.audit).toContainEqual({
      action: "source_removed",
      transactionId: "removed",
      occurredAt: NOW,
    });
  });
});

describe("heuristic review", () => {
  it("returns ambiguous matches for review and never auto-confirms them", () => {
    const pending = transaction({
      id: "pending",
      displayMerchant: "ACME Coffee #123",
      normalizedMerchant: "acme coffee",
    });
    const postedA = transaction({ id: "posted-a", status: "posted", normalizedMerchant: "acme coffee" });
    const postedB = transaction({ id: "posted-b", status: "posted", normalizedMerchant: "acme coffee downtown" });
    const state = createReconciliationState([pending, postedA, postedB]);

    const candidates = suggestReconciliationCandidates(state.transactions);

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.requiresConfirmation)).toBe(true);
    expect(state.transactions.find(({ id }) => id === "pending")?.status).toBe("pending");
    expect(state.decisions).toHaveLength(0);
  });

  it("requires confirmation and rejects cross-user/account confirmation", () => {
    const pending = transaction({ id: "pending" });
    const posted = transaction({ id: "posted", status: "posted" });
    const confirmed = confirmReconciliation(
      createReconciliationState([pending, posted]),
      pending.id,
      posted.id,
      NOW,
    );
    expect(confirmed.transactions[0]).toMatchObject({
      status: "removed",
      reconciledToTransactionId: posted.id,
    });

    const crossAccount = transaction({ id: "cross", status: "posted", financialAccountId: "account-2" });
    expect(() =>
      confirmReconciliation(createReconciliationState([pending, crossAccount]), "pending", "cross", NOW),
    ).toThrow(/cannot cross user or financial-account/i);
  });
});
