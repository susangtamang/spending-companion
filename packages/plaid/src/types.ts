export interface LinkTokenRequest {
  readonly clientUserId: string;
  readonly clientName: string;
  readonly webhookUrl: string;
  readonly redirectUri?: string;
  readonly androidPackageName?: string;
  readonly daysRequested?: number;
}

export interface LinkTokenResult { readonly linkToken: string; readonly expiration: string }
export interface TokenExchangeResult { readonly accessToken: string; readonly itemId: string }

export interface PlaidAccountRecord {
  readonly accountId: string;
  readonly name: string;
  readonly officialName?: string;
  readonly mask?: string;
  readonly type: "checking" | "credit" | "savings" | "other";
  readonly subtype?: string;
  readonly isoCurrencyCode?: string;
}

export interface PlaidTransactionRecord {
  readonly transactionId: string;
  readonly accountId: string;
  readonly pendingTransactionId?: string;
  readonly pending: boolean;
  readonly amount: number;
  /** Exact signed cents; Plaid positive amounts are outflows and negative amounts are inflows. */
  readonly signedAmountCents: number;
  readonly date: string;
  readonly authorizedDate?: string;
  readonly merchantName?: string;
  readonly name: string;
  readonly isoCurrencyCode?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface RemovedTransaction { readonly transactionId: string }
export interface SyncPage {
  readonly requestedCursor?: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly added: readonly PlaidTransactionRecord[];
  readonly modified: readonly PlaidTransactionRecord[];
  readonly removed: readonly RemovedTransaction[];
}

export interface SyncPlan {
  readonly originalCursor?: string;
  readonly nextCursor: string;
  readonly added: readonly PlaidTransactionRecord[];
  readonly modified: readonly PlaidTransactionRecord[];
  readonly removed: readonly RemovedTransaction[];
}

export interface PlaidProvider {
  createTransactionsLinkToken(request: LinkTokenRequest): Promise<LinkTokenResult>;
  createUpdateLinkToken(request: Omit<LinkTokenRequest, "daysRequested">, accessToken: string): Promise<LinkTokenResult>;
  exchangePublicToken(publicToken: string): Promise<TokenExchangeResult>;
  getAccounts(accessToken: string): Promise<readonly PlaidAccountRecord[]>;
  removeItem(accessToken: string): Promise<void>;
  syncPage(accessToken: string, cursor?: string): Promise<SyncPage>;
  getWebhookVerificationKey(keyId: string): Promise<JsonWebKey>;
}

export interface JsonWebKey {
  readonly kty: string; readonly kid?: string; readonly alg?: string; readonly use?: string;
  readonly crv?: string; readonly x?: string; readonly y?: string;
}

export class PlaidProviderError extends Error {
  constructor(readonly code: string, message = "Plaid provider request failed.") {
    super(message); this.name = "PlaidProviderError";
  }
}
