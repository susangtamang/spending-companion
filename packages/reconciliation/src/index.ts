import type {
  IsoDateTime,
  ReconciliationCandidate,
  ReconciliationDecision,
  Transaction,
} from "@spending-companion/contracts";

export interface ReconciliationAuditEvent {
  readonly action: "provider_reconciled" | "user_reconciled" | "source_removed";
  readonly transactionId: string;
  readonly relatedTransactionId?: string;
  readonly occurredAt: IsoDateTime;
}

export interface ReconciliationState {
  readonly transactions: readonly Transaction[];
  readonly decisions: readonly ReconciliationDecision[];
  readonly audit: readonly ReconciliationAuditEvent[];
}

export interface ApplyBatchResult extends ReconciliationState {
  /** Explicit provider links rejected because ownership or account scope did not match. */
  readonly rejectedExplicitLinks: readonly ReconciliationCandidate[];
}

export interface CandidateOptions {
  readonly maxDateDistanceDays?: number;
  readonly minimumMerchantSimilarity?: number;
}

const DAY_MS = 86_400_000;

export function createReconciliationState(
  transactions: readonly Transaction[] = [],
): ReconciliationState {
  return { transactions: [...transactions], decisions: [], audit: [] };
}

/**
 * Upserts a provider batch, retains removed records, and applies only explicit
 * provider pending links. Calling this function again with the same batch is
 * idempotent, including decisions and audit events.
 */
export function applyTransactionBatch(
  state: ReconciliationState,
  incoming: readonly Transaction[],
  occurredAt: IsoDateTime,
): ApplyBatchResult {
  const byId = new Map(state.transactions.map((transaction) => [transaction.id, transaction]));
  const audit = [...state.audit];

  for (const transaction of incoming) {
    const previous = byId.get(transaction.id);
    byId.set(transaction.id, preserveReconciliation(previous, transaction));

    if (
      transaction.status === "removed" &&
      previous?.status !== "removed" &&
      !hasAudit(audit, "source_removed", transaction.id)
    ) {
      audit.push({ action: "source_removed", transactionId: transaction.id, occurredAt });
    }
  }

  const decisions = [...state.decisions];
  const rejectedExplicitLinks: ReconciliationCandidate[] = [];
  const postedWithLinks = [...byId.values()].filter(
    (transaction) => transaction.status === "posted" && transaction.pendingTransactionId,
  );

  for (const posted of postedWithLinks) {
    const pending = findPendingBySourceId(byId.values(), posted);
    if (!pending) continue;

    const candidate = providerCandidate(pending, posted);
    if (!sameOwnerAndAccount(pending, posted)) {
      rejectedExplicitLinks.push(candidate);
      continue;
    }

    const decisionId = decisionKey(pending.id, posted.id, "provider");
    if (!decisions.some((decision) => decision.id === decisionId)) {
      decisions.push({
        id: decisionId,
        userId: posted.userId,
        pendingTransactionId: pending.id,
        postedTransactionId: posted.id,
        decision: "confirmed",
        decidedBy: "provider",
        decidedAt: occurredAt,
      });
    }

    byId.set(pending.id, markPendingReplaced(pending, posted.id, occurredAt));
    if (!hasAudit(audit, "provider_reconciled", pending.id, posted.id)) {
      audit.push({
        action: "provider_reconciled",
        transactionId: pending.id,
        relatedTransactionId: posted.id,
        occurredAt,
      });
    }
  }

  return {
    transactions: [...byId.values()],
    decisions,
    audit,
    rejectedExplicitLinks,
  };
}

/** Returns review-only candidates. This function never mutates or reconciles transactions. */
export function suggestReconciliationCandidates(
  transactions: readonly Transaction[],
  options: CandidateOptions = {},
): readonly ReconciliationCandidate[] {
  const maxDays = options.maxDateDistanceDays ?? 7;
  const minimumMerchantSimilarity = options.minimumMerchantSimilarity ?? 0.5;
  const pending = transactions.filter(
    (transaction) => transaction.status === "pending" && !transaction.reconciledToTransactionId,
  );
  const posted = transactions.filter((transaction) => transaction.status === "posted");
  const candidates: ReconciliationCandidate[] = [];

  for (const pendingTransaction of pending) {
    for (const postedTransaction of posted) {
      if (!sameOwnerAndAccount(pendingTransaction, postedTransaction)) continue;
      if (pendingTransaction.amountCents !== postedTransaction.amountCents) continue;

      const dateDistance = dateDistanceDays(pendingTransaction, postedTransaction);
      if (dateDistance > maxDays) continue;

      const merchantScore = merchantSimilarity(
        pendingTransaction.normalizedMerchant,
        postedTransaction.normalizedMerchant,
      );
      if (merchantScore < minimumMerchantSimilarity) continue;

      const dateScore = 1 - dateDistance / (maxDays + 1);
      const score = roundScore(0.3 + 0.3 + merchantScore * 0.25 + dateScore * 0.15);
      candidates.push({
        pendingTransactionId: pendingTransaction.id,
        postedTransactionId: postedTransaction.id,
        reason: "heuristic",
        score,
        factors: ["account", "amount", "merchant", "date"],
        requiresConfirmation: true,
      });
    }
  }

  return candidates.sort(
    (left, right) =>
      (right.score ?? 0) - (left.score ?? 0) ||
      left.pendingTransactionId.localeCompare(right.pendingTransactionId) ||
      left.postedTransactionId.localeCompare(right.postedTransactionId),
  );
}

/** Applies an explicit user confirmation for a previously reviewed heuristic pair. */
export function confirmReconciliation(
  state: ReconciliationState,
  pendingTransactionId: string,
  postedTransactionId: string,
  decidedAt: IsoDateTime,
): ReconciliationState {
  const pending = state.transactions.find((transaction) => transaction.id === pendingTransactionId);
  const posted = state.transactions.find((transaction) => transaction.id === postedTransactionId);
  if (!pending || !posted) throw new Error("Both reconciliation transactions must exist.");
  if (posted.status !== "posted") throw new Error("The canonical transaction must be posted.");
  if (!sameOwnerAndAccount(pending, posted)) {
    throw new Error("Reconciliation cannot cross user or financial-account boundaries.");
  }
  if (pending.reconciledToTransactionId && pending.reconciledToTransactionId !== posted.id) {
    throw new Error("The pending transaction is already reconciled to another transaction.");
  }

  const decisionId = decisionKey(pending.id, posted.id, "user");
  const decisions = state.decisions.some((decision) => decision.id === decisionId)
    ? state.decisions
    : [
        ...state.decisions,
        {
          id: decisionId,
          userId: posted.userId,
          pendingTransactionId: pending.id,
          postedTransactionId: posted.id,
          decision: "confirmed" as const,
          decidedBy: "user" as const,
          decidedAt,
        },
      ];
  const audit = hasAudit(state.audit, "user_reconciled", pending.id, posted.id)
    ? state.audit
    : [
        ...state.audit,
        {
          action: "user_reconciled" as const,
          transactionId: pending.id,
          relatedTransactionId: posted.id,
          occurredAt: decidedAt,
        },
      ];

  return {
    transactions: state.transactions.map((transaction) =>
      transaction.id === pending.id ? markPendingReplaced(transaction, posted.id, decidedAt) : transaction,
    ),
    decisions,
    audit,
  };
}

export function normalizeMerchant(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:store|shop|purchase|payment|debit|credit)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function merchantSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeMerchant(left);
  const normalizedRight = normalizeMerchant(right);
  if (normalizedLeft === normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;

  const leftTokens = new Set(normalizedLeft.split(" "));
  const rightTokens = new Set(normalizedRight.split(" "));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function preserveReconciliation(
  previous: Transaction | undefined,
  incoming: Transaction,
): Transaction {
  if (!previous?.reconciledToTransactionId || incoming.reconciledToTransactionId) return incoming;
  const preserved: Transaction = {
    ...incoming,
    status: "removed",
    reconciledToTransactionId: previous.reconciledToTransactionId,
  };
  return previous.audit ? { ...preserved, audit: previous.audit } : preserved;
}

function findPendingBySourceId(
  transactions: Iterable<Transaction>,
  posted: Transaction,
): Transaction | undefined {
  for (const transaction of transactions) {
    if (
      transaction.source === posted.source &&
      transaction.sourceTransactionId === posted.pendingTransactionId
    ) {
      return transaction;
    }
  }
  return undefined;
}

function sameOwnerAndAccount(left: Transaction, right: Transaction): boolean {
  return (
    left.userId === right.userId &&
    left.financialAccountId !== undefined &&
    left.financialAccountId === right.financialAccountId
  );
}

function providerCandidate(pending: Transaction, posted: Transaction): ReconciliationCandidate {
  return {
    pendingTransactionId: pending.id,
    postedTransactionId: posted.id,
    reason: "provider_link",
    factors: ["account"],
    requiresConfirmation: false,
  };
}

function markPendingReplaced(
  pending: Transaction,
  postedId: string,
  occurredAt: IsoDateTime,
): Transaction {
  if (pending.reconciledToTransactionId === postedId && pending.status === "removed") return pending;
  return {
    ...pending,
    status: "removed",
    reconciledToTransactionId: postedId,
    audit: {
      ...pending.audit,
      removedAt: pending.audit?.removedAt ?? occurredAt,
      removalReason: pending.audit?.removalReason ?? "replaced_by_posted_transaction",
    },
    updatedAt: occurredAt,
  };
}

function dateDistanceDays(left: Transaction, right: Transaction): number {
  const leftDate = Date.parse(`${left.occurrenceDate}T00:00:00Z`);
  const rightDate = Date.parse(`${right.postedDate ?? right.occurrenceDate}T00:00:00Z`);
  return Math.abs(rightDate - leftDate) / DAY_MS;
}

function decisionKey(pendingId: string, postedId: string, actor: "provider" | "user"): string {
  return `${actor}:${pendingId}:${postedId}`;
}

function hasAudit(
  audit: readonly ReconciliationAuditEvent[],
  action: ReconciliationAuditEvent["action"],
  transactionId: string,
  relatedTransactionId?: string,
): boolean {
  return audit.some(
    (event) =>
      event.action === action &&
      event.transactionId === transactionId &&
      event.relatedTransactionId === relatedTransactionId,
  );
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
