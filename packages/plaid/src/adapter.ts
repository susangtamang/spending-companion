import {
  Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products,
  type Transaction as SdkTransaction,
} from "plaid";
import type { JsonWebKey, LinkTokenRequest, LinkTokenResult, PlaidAccountRecord, PlaidProvider, PlaidTransactionRecord, SyncPage, TokenExchangeResult } from "./types.js";
import { PlaidProviderError } from "./types.js";
import { plaidAmountToSignedCents } from "./money.js";

export type PlaidEnvironment = "sandbox" | "production";
export interface PlaidNodeConfig { readonly clientId: string; readonly secret: string; readonly environment: PlaidEnvironment }

export class PlaidNodeProvider implements PlaidProvider {
  private readonly client: PlaidApi;
  constructor(config: PlaidNodeConfig, client?: PlaidApi) {
    if (!config.clientId || !config.secret) throw new Error("Plaid server credentials are required.");
    const basePath = config.environment === "sandbox" ? PlaidEnvironments.sandbox : PlaidEnvironments.production;
    if (!basePath) throw new Error("Unsupported Plaid environment.");
    this.client = client ?? new PlaidApi(new Configuration({ basePath, baseOptions: { headers: { "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret } } }));
  }
  async createTransactionsLinkToken(request: LinkTokenRequest): Promise<LinkTokenResult> {
    const response = await this.client.linkTokenCreate({
      user: { client_user_id: request.clientUserId }, client_name: request.clientName,
      products: [Products.Transactions], transactions: { days_requested: request.daysRequested ?? 730 },
      country_codes: [CountryCode.Us], language: "en", webhook: request.webhookUrl,
      ...(request.redirectUri ? { redirect_uri: request.redirectUri } : {}),
      ...(request.androidPackageName ? { android_package_name: request.androidPackageName } : {}),
    });
    return { linkToken: response.data.link_token, expiration: response.data.expiration };
  }
  async createUpdateLinkToken(request: Omit<LinkTokenRequest, "daysRequested">, accessToken: string): Promise<LinkTokenResult> {
    const response = await this.client.linkTokenCreate({
      user: { client_user_id: request.clientUserId }, client_name: request.clientName,
      access_token: accessToken, country_codes: [CountryCode.Us], language: "en", webhook: request.webhookUrl,
      ...(request.redirectUri ? { redirect_uri: request.redirectUri } : {}),
      ...(request.androidPackageName ? { android_package_name: request.androidPackageName } : {}),
    });
    return { linkToken: response.data.link_token, expiration: response.data.expiration };
  }
  async exchangePublicToken(publicToken: string): Promise<TokenExchangeResult> { const r = await this.client.itemPublicTokenExchange({ public_token: publicToken }); return { accessToken: r.data.access_token, itemId: r.data.item_id }; }
  async getAccounts(accessToken: string): Promise<readonly PlaidAccountRecord[]> {
    const response = await this.client.accountsGet({ access_token: accessToken });
    return response.data.accounts.map((account) => ({
      accountId: account.account_id,
      name: account.name,
      ...(account.official_name ? { officialName: account.official_name } : {}),
      ...(account.mask ? { mask: account.mask } : {}),
      type: accountType(account.type, account.subtype ? String(account.subtype) : undefined),
      ...(account.subtype ? { subtype: String(account.subtype) } : {}),
      ...(account.balances.iso_currency_code ? { isoCurrencyCode: account.balances.iso_currency_code } : {}),
    }));
  }
  async removeItem(accessToken: string): Promise<void> { await this.client.itemRemove({ access_token: accessToken }); }
  async syncPage(accessToken: string, cursor?: string): Promise<SyncPage> {
    try {
      const r = await this.client.transactionsSync({ access_token: accessToken, count: 500, ...(cursor ? { cursor } : {}) });
      return { ...(cursor ? { requestedCursor: cursor } : {}), nextCursor: r.data.next_cursor, hasMore: r.data.has_more, added: r.data.added.map(normalizeTransaction), modified: r.data.modified.map(normalizeTransaction), removed: r.data.removed.map((x) => ({ transactionId: x.transaction_id })) };
    } catch (error) {
      const code = readPlaidErrorCode(error); throw new PlaidProviderError(code ?? "PLAID_REQUEST_FAILED");
    }
  }
  async getWebhookVerificationKey(keyId: string): Promise<JsonWebKey> { const r = await this.client.webhookVerificationKeyGet({ key_id: keyId }); return r.data.key as JsonWebKey; }
  toJSON(): object { return { type: "PlaidNodeProvider" }; }
}

function accountType(value: string, subtype?: string): PlaidAccountRecord["type"] {
  if (value === "depository" && subtype === "savings") return "savings";
  if (value === "depository") return "checking";
  if (value === "credit") return "credit";
  return "other";
}

function normalizeTransaction(value: SdkTransaction): PlaidTransactionRecord {
  return { transactionId: value.transaction_id, accountId: value.account_id, ...(value.pending_transaction_id ? { pendingTransactionId: value.pending_transaction_id } : {}), pending: value.pending, amount: value.amount, signedAmountCents: plaidAmountToSignedCents(value.amount), date: value.date, ...(value.authorized_date ? { authorizedDate: value.authorized_date } : {}), ...(value.merchant_name ? { merchantName: value.merchant_name } : {}), name: value.name, ...(value.iso_currency_code ? { isoCurrencyCode: value.iso_currency_code } : {}), raw: value as unknown as Record<string, unknown> };
}
function readPlaidErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { data?: { error_code?: unknown } } }).response;
  return typeof response?.data?.error_code === "string" ? response.data.error_code : undefined;
}
