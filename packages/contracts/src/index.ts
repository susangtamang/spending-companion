/** ISO-8601 UTC timestamp, e.g. `2026-10-09T18:00:00.000Z`. */
export type IsoDateTime = string;

/** Calendar date independent of UTC, e.g. `2026-10-09`. */
export type LocalDate = string;

/** Calendar month independent of UTC, e.g. `2026-10`. */
export type YearMonth = string;

/** Non-negative, safe integer US cents. Enforced at API and persistence boundaries. */
export type UsdCents = number;

/**
 * IDs are opaque strings. Clients must not parse them or assume UUID formatting;
 * OpenAPI schemas intentionally omit a `format` constraint.
 */
export type OpaqueId = string;

export type TransactionSource = "plaid" | "csv" | "manual";
export type TransactionStatus = "pending" | "posted" | "removed";
export type TransactionKind = "purchase" | "refund" | "payment" | "transfer" | "cash";

export interface AuditMetadata {
  /** Source payload with secrets removed. Retained until account deletion unless policy changes. */
  readonly sanitizedSource?: Readonly<Record<string, unknown>>;
  readonly sourceRevision?: string;
  readonly removedAt?: IsoDateTime;
  readonly removalReason?: string;
}

export interface Transaction {
  readonly id: OpaqueId;
  readonly userId: OpaqueId;
  readonly financialAccountId?: OpaqueId;
  readonly source: TransactionSource;
  /** Stable within user + source + financial account (or import scope). */
  readonly sourceTransactionId?: string;
  readonly status: TransactionStatus;
  readonly kind: TransactionKind;
  readonly amountCents: UsdCents;
  readonly currencyCode: "USD";
  readonly rawMerchant?: string;
  readonly displayMerchant: string;
  readonly normalizedMerchant: string;
  readonly sourceCategoryId?: string;
  readonly categoryOverrideId?: string;
  readonly occurrenceDate: LocalDate;
  readonly postedDate?: LocalDate;
  readonly pendingTransactionId?: string;
  readonly reconciledToTransactionId?: string;
  readonly importBatchId?: string;
  readonly note?: string;
  readonly audit?: AuditMetadata;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Mobile/API representation; tenant ownership and source audit payloads stay server-side. */
export type TransactionDto = Omit<Transaction, "userId" | "audit">;

export interface Category {
  readonly id: OpaqueId;
  /** Absent for system categories; required for user-created categories. */
  readonly userId?: OpaqueId;
  readonly name: string;
  readonly isUtility: boolean;
  /** System categories are shared, immutable to users, and cannot be archived. */
  readonly isSystem: boolean;
  /** User categories are archived rather than deleted when referenced. */
  readonly archivedAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}


export type CategoryDto = Omit<Category, "userId">;

export interface Budget {
  readonly id: OpaqueId;
  readonly userId: OpaqueId;
  readonly mode: "including_utilities" | "excluding_utilities";
  /** Omitted for the user's default; present for a monthly override. */
  readonly month?: YearMonth;
  readonly amountCents: UsdCents;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export type BudgetDto = Omit<Budget, "userId">;

export type FinancialAccountType = "checking" | "credit" | "savings" | "other";

export interface FinancialAccount {
  readonly id: OpaqueId;
  readonly userId: OpaqueId;
  readonly connectionId: OpaqueId;
  readonly sourceAccountId: string;
  readonly name: string;
  readonly officialName?: string;
  readonly mask?: string;
  readonly type: FinancialAccountType;
  readonly includeInSpending: boolean;
  readonly currencyCode: "USD";
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export type FinancialAccountDto = Omit<FinancialAccount, "userId" | "sourceAccountId">;

export type ConnectionHealth = "healthy" | "syncing" | "requires_update" | "error" | "disconnected";

export interface BankConnection {
  readonly id: OpaqueId;
  readonly userId: OpaqueId;
  readonly provider: "plaid";
  readonly institutionId?: string;
  readonly institutionName: string;
  readonly health: ConnectionHealth;
  /** Version of the financial-data disclosure accepted for this connection. */
  readonly consentVersion: string;
  readonly consentedAt: IsoDateTime;
  readonly lastSuccessfulSyncAt?: IsoDateTime;
  readonly lastSyncErrorCode?: string;
  readonly disconnectedAt?: IsoDateTime;
  /** Explicit user choice made when disconnecting the Item. */
  readonly disconnectHistoryPolicy?: "retain" | "delete";
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Public connection fields returned to authenticated mobile clients. */
export type BankConnectionDto = Omit<BankConnection, "userId">;

/** Provider identity and encrypted-token reference never cross the backend boundary. */
export interface InternalBankConnection extends BankConnection {
  readonly providerItemId: string;
  readonly encryptedAccessTokenReference: string;
}

export interface ConnectionSyncState {
  readonly connectionId: string;
  /** Opaque provider cursor; backend-only and never accepted from clients. */
  readonly cursor?: string;
  readonly status: "idle" | "queued" | "syncing" | "failed";
  readonly lastAttemptAt?: IsoDateTime;
  readonly lastCompletedAt?: IsoDateTime;
  readonly lastErrorCode?: string;
}

export interface MoneyBreakdown {
  readonly id: string;
  readonly label: string;
  readonly amountCents: UsdCents;
  readonly transactionCount: number;
}

export interface MonthlySummary {
  readonly month: YearMonth;
  readonly timezone: string;
  readonly budgetMode: Budget["mode"];
  readonly budgetCents: UsdCents;
  readonly postedCents: UsdCents;
  readonly pendingCents: UsdCents;
  readonly spentCents: UsdCents;
  /** May be negative when spending exceeds the budget. */
  readonly availableCents: number;
  readonly overspentCents: UsdCents;
  readonly transactionCount: number;
  readonly categoryBreakdown: readonly MoneyBreakdown[];
  readonly merchantBreakdown: readonly MoneyBreakdown[];
  readonly calculatedAt: IsoDateTime;
  readonly dataFreshAsOf?: IsoDateTime;
  readonly isStale: boolean;
}

export interface ImportRowError {
  readonly rowNumber: number;
  readonly field?: string;
  readonly code: string;
  readonly message: string;
}

export interface ImportPreviewRow {
  readonly rowNumber: number;
  readonly disposition: "valid" | "invalid" | "duplicate";
  readonly transaction?: Transaction;
  readonly errors: readonly ImportRowError[];
  readonly suggestedCategoryId?: string;
}

export interface ImportBatch {
  readonly id: string;
  readonly userId: string;
  readonly fileName: string;
  readonly status: "previewed" | "committed" | "undone";
  readonly totalRows: number;
  readonly importedRows: number;
  readonly duplicateRows: number;
  readonly invalidRows: number;
  readonly createdAt: IsoDateTime;
  readonly committedAt?: IsoDateTime;
  readonly undoneAt?: IsoDateTime;
}

export interface ImportHistoryItem {
  readonly id: OpaqueId;
  readonly fileName: string;
  readonly status: ImportBatch["status"];
  readonly totalRows: number;
  readonly importedRows: number;
  readonly duplicateRows: number;
  readonly invalidRows: number;
  readonly createdAt: IsoDateTime;
  readonly committedAt?: IsoDateTime;
  readonly undoneAt?: IsoDateTime;
}

export interface ImportBatchDetail extends ImportHistoryItem {
  readonly rows: readonly ImportPreviewRow[];
}

export interface ImportHistoryResponse extends Page<ImportHistoryItem> {}

export interface ReconciliationCandidate {
  readonly pendingTransactionId: string;
  readonly postedTransactionId: string;
  readonly reason: "provider_link" | "heuristic";
  readonly score?: number;
  readonly factors: readonly ("account" | "amount" | "merchant" | "date")[];
  readonly requiresConfirmation: boolean;
}

export interface ReconciliationDecision {
  readonly id: string;
  readonly userId: string;
  readonly pendingTransactionId: string;
  readonly postedTransactionId: string;
  readonly decision: "confirmed" | "rejected";
  readonly decidedBy: "provider" | "user";
  readonly decidedAt: IsoDateTime;
}

export type ReconciliationListResponse = readonly ReconciliationCandidate[];

export interface ConfirmReconciliationRequest extends IdempotentMutationRequest {
  readonly pendingTransactionId: OpaqueId;
  readonly postedTransactionId: OpaqueId;
}

export interface RejectReconciliationRequest extends IdempotentMutationRequest {
  readonly pendingTransactionId: OpaqueId;
  readonly postedTransactionId: OpaqueId;
}

export interface ReconciliationDecisionDto {
  readonly id: OpaqueId;
  readonly pendingTransactionId: OpaqueId;
  readonly postedTransactionId: OpaqueId;
  readonly decision: ReconciliationDecision["decision"];
  readonly decidedBy: ReconciliationDecision["decidedBy"];
  readonly decidedAt: IsoDateTime;
}

/** Public authenticated-user representation. */
export interface User {
  readonly id: OpaqueId;
  readonly email?: string;
  readonly displayName?: string;
  readonly timezone: string;
  readonly currencyCode: "USD";
}

/** Server-side identity linkage and persistence timestamps. */
export interface InternalUser extends User {
  readonly identityProviderSubject: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** @deprecated Use `InternalUser` for persistence or `User` for API responses. */
export type AuthenticatedUser = InternalUser;

export interface FinancialDataConsent {
  readonly consentVersion: string;
  readonly consentedAt: IsoDateTime;
}

export interface RecordFinancialDataConsentRequest extends FinancialDataConsent {}

export interface IdempotentMutationRequest {
  /** Unique opaque key generated by the client for one logical mutation. */
  readonly idempotencyKey: string;
}

export interface MutationResult<T> {
  readonly data: T;
  readonly idempotencyKey: string;
  readonly replayed: boolean;
}

export type AccountDeletionStatus = "pending" | "processing" | "blocked" | "completed" | "failed";

export interface AccountDeletionRequest extends IdempotentMutationRequest {
  readonly confirmation: "DELETE";
}

export interface AccountDeletion {
  readonly id: OpaqueId;
  readonly status: AccountDeletionStatus;
  readonly requestedAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly processingStartedAt?: IsoDateTime;
  readonly blockedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly failedAt?: IsoDateTime;
  readonly failureCode?: string;
  readonly retryable?: boolean;
}

export type DataExportStatus = "queued" | "running" | "ready" | "failed" | "expired";

export interface DataExportJob {
  readonly id: OpaqueId;
  readonly status: DataExportStatus;
  readonly format: "json" | "csv";
  /** Authenticated relative route; never a public object-store URL in Version 1. */
  readonly downloadUrl?: string;
  readonly expiresAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

/** Minimal non-financial record retained after deletion for audit/idempotency. */
export interface AccountDeletionTombstone {
  readonly deletionId: OpaqueId;
  readonly identityHash: string;
  readonly requestedAt: IsoDateTime;
  readonly completedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor?: string;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
}
