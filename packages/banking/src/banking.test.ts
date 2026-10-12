import { describe, expect, it } from "vitest";
import { FakePlaidProvider, LocalAes256GcmEncryption } from "../../plaid/src/index.js";
import { BankingService } from "./service.js";
import { normalizePlaidTransaction } from "./normalize.js";
import type { BankingStore, ConsentInput, ExchangeInput, StoredItem, SyncJob, SyncMutation, TenantContext, VerifiedWebhookInput } from "./types.js";

const context = { userId: "user-1" };

class MemoryStore implements BankingStore {
  sessions = new Map<string, { owner: string; consent: ConsentInput; used: boolean }>();
  items = new Map<string, StoredItem>();
  mutations: SyncMutation[] = [];
  webhooks = new Set<string>();
  disconnected?: "retain" | "delete";

  async recordLinkSession(ctx: TenantContext, consent: ConsentInput): Promise<string> {
    this.sessions.set("link-session-1", { owner: ctx.userId, consent, used: false });
    return "link-session-1";
  }
  async consumeLinkAndCreateItem(ctx: TenantContext, input: ExchangeInput, providerItemId: string, token: StoredItem["encryptedAccessToken"]): Promise<{ itemId: string }> {
    const session = this.sessions.get(input.linkSessionId);
    if (!session || session.owner !== ctx.userId || session.used) throw new Error("invalid link session");
    session.used = true;
    this.items.set("item-1", { id: "item-1", userId: ctx.userId, providerItemId, institutionName: input.institutionName, encryptedAccessToken: token, health: "HEALTHY", consentVersion: session.consent.consentVersion, consentedAt: new Date(session.consent.consentedAt), createdAt: new Date(), updatedAt: new Date() });
    return { itemId: "item-1" };
  }
  async getItem(ctx: TenantContext, itemId: string): Promise<StoredItem | null> { const item = this.items.get(itemId); return item?.userId === ctx.userId ? item : null; }
  async listItems(ctx: TenantContext): Promise<readonly StoredItem[]> { return [...this.items.values()].filter((item) => item.userId === ctx.userId); }
  async enqueueSync(ctx: TenantContext, itemId: string): Promise<SyncJob> { if (!await this.getItem(ctx, itemId)) throw new Error("missing"); return { id: "job-1", itemId }; }
  async runSerializedSync<T>(job: SyncJob, operation: (item: StoredItem) => Promise<{ mutation: SyncMutation; value: T }>): Promise<T> { const result = await operation(this.items.get(job.itemId)!); this.mutations.push(result.mutation); this.items.set(job.itemId, { ...this.items.get(job.itemId)!, syncCursor: result.mutation.nextCursor }); return result.value; }
  async recordVerifiedWebhook(input: VerifiedWebhookInput): Promise<{ duplicate: boolean; job?: SyncJob }> { const duplicate = this.webhooks.has(input.dedupeHash); this.webhooks.add(input.dedupeHash); return duplicate ? { duplicate } : { duplicate, job: { id: "job-webhook", itemId: "item-1" } }; }
  async markItemHealth(ctx: TenantContext, itemId: string, health: StoredItem["health"]): Promise<boolean> { const item = await this.getItem(ctx, itemId); if (!item) return false; this.items.set(itemId, { ...item, health }); return true; }
  async disconnectItem(ctx: TenantContext, itemId: string, policy: "retain" | "delete", removedAt: Date): Promise<boolean> { const item = await this.getItem(ctx, itemId); if (!item) return false; this.disconnected = policy; this.items.set(itemId, { ...item, health: "DISCONNECTED", disconnectedAt: removedAt }); return true; }
}

function fixture() {
  const provider = new FakePlaidProvider();
  const store = new MemoryStore();
  const service = new BankingService({ provider, store, encryption: new LocalAes256GcmEncryption(new Uint8Array(32).fill(7)), normalizeTransaction: normalizePlaidTransaction, linkRequest: (ctx, input) => ({ clientUserId: ctx.userId, clientName: input.clientName, webhookUrl: input.webhookUrl }), verifyWebhook: { async verify(raw) { return { body: JSON.parse(String(raw)) as unknown, keyId: "key-1" }; } }, now: () => new Date("2026-10-10T12:00:00.000Z") });
  return { provider, store, service };
}

async function connect(value = fixture()) {
  const link = await value.service.createLinkToken(context, { consentVersion: "v1", consentedAt: "2026-10-10T11:59:00.000Z", clientName: "Spending Companion", webhookUrl: "https://example.test/webhooks/plaid" });
  await value.service.exchange(context, { linkSessionId: link.linkSessionId, publicToken: "public-secret", institutionName: "Sandbox Bank" });
  return value;
}

describe("banking orchestration", () => {
  it("records consent and returns an opaque link-session identifier", async () => { const { service, store } = fixture(); const result = await service.createLinkToken(context, { consentVersion: "v1", consentedAt: "2026-10-10T11:59:00.000Z", clientName: "Spending Companion", webhookUrl: "https://example.test/webhooks/plaid" }); expect(result).toMatchObject({ linkToken: "link-fake", linkSessionId: "link-session-1" }); expect(store.sessions.get(result.linkSessionId)?.owner).toBe(context.userId); });
  it("exchanges once, encrypts the access token, and rejects non-USD accounts", async () => { const connected = await connect(); expect(connected.store.items.get("item-1")?.encryptedAccessToken.ciphertext).not.toContain("access-fake"); await expect(connected.service.exchange(context, { linkSessionId: "link-session-1", publicToken: "again", institutionName: "Bank" })).rejects.toThrow(); const invalid = fixture(); invalid.provider.accounts = [{ accountId: "foreign", name: "Foreign", type: "checking", isoCurrencyCode: "EUR" }]; await invalid.service.createLinkToken(context, { consentVersion: "v1", consentedAt: new Date().toISOString(), clientName: "App", webhookUrl: "https://example.test" }); await expect(invalid.service.exchange(context, { linkSessionId: "link-session-1", publicToken: "public", institutionName: "Bank" })).rejects.toThrow("not USD"); });
  it("fetches all sync pages and commits a single cursor mutation", async () => { const value = await connect(); value.provider.syncResponses.push({ nextCursor: "c1", hasMore: true, added: [{ transactionId: "pending", accountId: "account-fake", pending: true, amount: 12.34, signedAmountCents: 1234, date: "2026-10-09", name: "Coffee", isoCurrencyCode: "USD", raw: {} }], modified: [], removed: [] }, { requestedCursor: "c1", nextCursor: "c2", hasMore: false, added: [], modified: [], removed: [{ transactionId: "old" }] }); const job = await value.service.enqueueSync(context, "item-1"); await value.service.processSyncJob(job); expect(value.store.mutations).toHaveLength(1); expect(value.store.mutations[0]).toMatchObject({ nextCursor: "c2", removed: [{ transactionId: "old" }] }); expect(value.store.mutations[0]!.added[0]!.amountCents).toBe(1234n); });
  it("deduplicates verified webhook bodies", async () => { const value = fixture(); const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "provider-item" }); expect(await value.service.acceptWebhook(body, "jwt")).toMatchObject({ duplicate: false, job: { id: "job-webhook" } }); expect(await value.service.acceptWebhook(body, "jwt")).toEqual({ duplicate: true }); });
  it("removes the provider item before purging the local token", async () => { const value = await connect(); await expect(value.service.disconnect({ userId: "other" }, "item-1", "delete")).rejects.toThrow("not found"); expect(await value.service.disconnect(context, "item-1", "delete")).toBe(true); expect(value.store.disconnected).toBe("delete"); expect(value.provider.calls.at(-1)).toMatchObject({ method: "remove", secret: "access-fake" }); });
});
