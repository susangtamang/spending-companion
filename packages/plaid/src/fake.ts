import type { JsonWebKey, LinkTokenRequest, LinkTokenResult, PlaidAccountRecord, PlaidProvider, SyncPage, TokenExchangeResult } from "./types.js";

export class FakePlaidProvider implements PlaidProvider {
  readonly calls: { method: string; secret?: string; cursor?: string }[] = [];
  syncResponses: (SyncPage | Error)[] = [];
  verificationKeys = new Map<string, JsonWebKey>();
  accounts: PlaidAccountRecord[] = [{ accountId: "account-fake", name: "Sandbox Checking", type: "checking", isoCurrencyCode: "USD" }];
  async createTransactionsLinkToken(_request: LinkTokenRequest): Promise<LinkTokenResult> { this.calls.push({ method: "link" }); return { linkToken: "link-fake", expiration: "2030-01-01T00:00:00Z" }; }
  async createUpdateLinkToken(_request: Omit<LinkTokenRequest, "daysRequested">, _accessToken: string): Promise<LinkTokenResult> { this.calls.push({ method: "update" }); return { linkToken: "link-update-fake", expiration: "2030-01-01T00:00:00Z" }; }
  async exchangePublicToken(publicToken: string): Promise<TokenExchangeResult> { this.calls.push({ method: "exchange", secret: publicToken }); return { accessToken: "access-fake", itemId: "item-fake" }; }
  async getAccounts(accessToken: string): Promise<readonly PlaidAccountRecord[]> { this.calls.push({ method: "accounts", secret: accessToken }); return this.accounts; }
  async removeItem(accessToken: string): Promise<void> { this.calls.push({ method: "remove", secret: accessToken }); }
  async syncPage(accessToken: string, cursor?: string): Promise<SyncPage> { this.calls.push({ method: "sync", secret: accessToken, ...(cursor ? { cursor } : {}) }); const response = this.syncResponses.shift(); if (!response) throw new Error("No fake sync response queued."); if (response instanceof Error) throw response; return response; }
  async getWebhookVerificationKey(keyId: string): Promise<JsonWebKey> { const key = this.verificationKeys.get(keyId); if (!key) throw new Error("Unknown fake verification key."); return key; }
  toJSON(): object { return { type: "FakePlaidProvider", callCount: this.calls.length }; }
}
