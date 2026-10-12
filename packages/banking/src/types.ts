import type { TenantContext } from "@spending-companion/persistence";
import type {
  EncryptedSecret,
  LinkTokenRequest,
  LinkTokenResult,
  PlaidProvider,
  PlaidAccountRecord,
  PlaidTransactionRecord,
  RemovedTransaction,
} from "../../plaid/src/index.js";

export type { TenantContext };

export type ProviderAccount = PlaidAccountRecord;

export interface BankingPlaidProvider extends PlaidProvider {
  getAccounts(accessToken: string): Promise<readonly ProviderAccount[]>;
}

export interface ConsentInput {
  readonly consentVersion: string;
  readonly consentedAt: string;
}

export interface CreateLinkInput extends ConsentInput {
  readonly clientName: string;
  readonly webhookUrl: string;
  readonly redirectUri?: string;
  readonly androidPackageName?: string;
}

export interface CreatedLink extends LinkTokenResult { readonly linkSessionId: string }

export interface ExchangeInput {
  readonly linkSessionId: string;
  readonly publicToken: string;
  readonly institutionId?: string;
  readonly institutionName: string;
}

export interface StoredItem {
  readonly id: string;
  readonly userId: string;
  readonly providerItemId: string;
  readonly institutionId?: string;
  readonly institutionName: string;
  readonly encryptedAccessToken: EncryptedSecret;
  readonly syncCursor?: string;
  readonly health: "HEALTHY" | "SYNCING" | "REQUIRES_UPDATE" | "ERROR" | "DISCONNECTED";
  readonly consentVersion: string;
  readonly consentedAt: Date;
  readonly disconnectedAt?: Date;
  readonly disconnectHistoryPolicy?: "retain" | "delete";
  readonly lastSuccessfulSyncAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredAccount {
  readonly id: string;
  readonly userId: string;
  readonly plaidItemId: string;
  readonly providerAccountId: string;
}

export interface SyncJob { readonly id: string; readonly itemId: string }

export interface NormalizedSyncTransaction {
  readonly providerTransactionId: string;
  readonly providerAccountId: string;
  readonly pendingProviderTransactionId?: string;
  readonly status: "PENDING" | "POSTED";
  readonly kind: "PURCHASE" | "REFUND";
  readonly amountCents: bigint;
  readonly rawMerchant?: string;
  readonly displayMerchant: string;
  readonly normalizedMerchant: string;
  readonly occurrenceDate: Date;
  readonly postedDate?: Date;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SyncMutation {
  readonly added: readonly NormalizedSyncTransaction[];
  readonly modified: readonly NormalizedSyncTransaction[];
  readonly removed: readonly RemovedTransaction[];
  readonly nextCursor: string;
  readonly occurredAt: Date;
}

export interface BankingStore {
  recordLinkSession(context: TenantContext, consent: ConsentInput, expiration: string): Promise<string>;
  consumeLinkAndCreateItem(
    context: TenantContext,
    input: ExchangeInput,
    providerItemId: string,
    token: EncryptedSecret,
    accounts: readonly ProviderAccount[],
  ): Promise<{ readonly itemId: string }>;
  getItem(context: TenantContext, itemId: string): Promise<StoredItem | null>;
  listItems(context: TenantContext): Promise<readonly StoredItem[]>;
  enqueueSync(context: TenantContext, itemId: string): Promise<SyncJob>;
  claimSyncJobs(input: ClaimSyncJobsInput): Promise<readonly SyncJob[]>;
  runSerializedSync<T>(job: SyncJob, operation: (item: StoredItem) => Promise<{ readonly mutation: SyncMutation; readonly value: T }>): Promise<T>;
  recordVerifiedWebhook(input: VerifiedWebhookInput): Promise<{ readonly duplicate: boolean; readonly job?: SyncJob }>;
  markItemHealth(context: TenantContext, itemId: string, health: StoredItem["health"], errorCode?: string): Promise<boolean>;
  disconnectItem(context: TenantContext, itemId: string, policy: "retain" | "delete", removedAt: Date): Promise<boolean>;
}

export interface VerifiedWebhookInput {
  readonly dedupeHash: string;
  readonly providerItemId?: string;
  readonly webhookType: string;
  readonly webhookCode: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly verificationKeyId?: string;
  readonly receivedAt: Date;
  readonly connectionHealth?: "REQUIRES_UPDATE" | "ERROR";
  readonly connectionErrorCode?: string;
}

export interface ClaimSyncJobsInput {
  readonly limit: number;
  readonly staleBefore: Date;
  readonly maxAttempts: number;
  readonly claimedAt: Date;
}

export interface WebhookVerifier {
  verify(rawBody: Uint8Array | string, verificationJwt: string | undefined): Promise<{
    readonly body: unknown;
    readonly keyId?: string;
  }>;
}

export interface LinkRequestFactory {
  (context: TenantContext, input: CreateLinkInput): LinkTokenRequest;
}

export interface SyncNormalization {
  (record: PlaidTransactionRecord): NormalizedSyncTransaction;
}
