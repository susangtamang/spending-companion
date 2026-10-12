import { describe, expect, it, vi } from "vitest";

import { FakePlaidProvider, type EncryptedSecret, type SyncPage } from "../../plaid/src/index.js";
import { BankingService } from "./service.js";
import type { BankingPlaidProvider, BankingStore, StoredItem } from "./types.js";
import { BankingSyncWorker } from "./worker.js";
import { normalizePlaidTransaction } from "./normalize.js";

const now = new Date("2026-10-10T12:00:00.000Z");
const context = { userId: "user-a" };
const encrypted: EncryptedSecret = { algorithm: "KMS", keyVersion: "test-v1", ciphertext: "encrypted" };
const item: StoredItem = {
  id: "item-internal",
  userId: context.userId,
  providerItemId: "item-fake",
  institutionName: "Test Bank",
  encryptedAccessToken: encrypted,
  health: "HEALTHY",
  consentVersion: "2026-10",
  consentedAt: now,
  createdAt: now,
  updatedAt: now,
};

function setup() {
  const baseProvider = new FakePlaidProvider();
  const provider = Object.assign(baseProvider, {
    getAccounts: vi.fn(async () => [{ accountId: "account-provider", name: "Checking", type: "checking" as const, isoCurrencyCode: "USD" }]),
  }) satisfies BankingPlaidProvider;
  const calls: string[] = [];
  const store: BankingStore = {
    recordLinkSession: vi.fn(async () => "link-session"),
    consumeLinkAndCreateItem: vi.fn(async () => ({ itemId: item.id })),
    getItem: vi.fn(async () => item),
    listItems: vi.fn(async () => [item]),
    enqueueSync: vi.fn(async () => ({ id: "job", itemId: item.id })),
    claimSyncJobs: vi.fn(async () => []),
    runSerializedSync: vi.fn(async (_job, operation) => {
      const result = await operation(item);
      calls.push(`commit:${result.mutation.nextCursor}`);
      return result.value;
    }),
    recordVerifiedWebhook: vi.fn(async () => ({ duplicate: false })),
    markItemHealth: vi.fn(async () => true),
    disconnectItem: vi.fn(async () => { calls.push("purge"); return true; }),
  };
  const service = new BankingService({
    provider,
    store,
    encryption: {
      encrypt: vi.fn(async () => encrypted),
      decrypt: vi.fn(async () => "access-fake"),
    },
    verifyWebhook: { verify: vi.fn(async (raw) => ({ body: JSON.parse(String(raw)) as unknown, keyId: "key-1" })) },
    normalizeTransaction: normalizePlaidTransaction,
    linkRequest: (tenant, input) => ({ clientUserId: tenant.userId, clientName: input.clientName, webhookUrl: input.webhookUrl }),
    now: () => now,
  });
  return { provider, store, service, calls };
}

describe("BankingService", () => {
  it("records consent before returning a Link session", async () => {
    const { service, store } = setup();
    await expect(service.createLinkToken(context, {
      consentVersion: "2026-10", consentedAt: now.toISOString(), clientName: "Spending Companion", webhookUrl: "https://example.test/webhook",
    })).resolves.toMatchObject({ linkToken: "link-fake", linkSessionId: "link-session" });
    expect(store.recordLinkSession).toHaveBeenCalledWith(context, expect.objectContaining({ consentVersion: "2026-10" }), "2030-01-01T00:00:00Z");
  });

  it("fetches every sync page before committing one cursor mutation", async () => {
    const { service, provider, calls } = setup();
    const first: SyncPage = { nextCursor: "cursor-1", hasMore: true, added: [], modified: [], removed: [] };
    const second: SyncPage = { requestedCursor: "cursor-1", nextCursor: "cursor-2", hasMore: false, added: [], modified: [], removed: [] };
    provider.syncResponses.push(first, second);
    await service.processSyncJob({ id: "job", itemId: item.id });
    expect(provider.calls.filter(({ method }) => method === "sync")).toHaveLength(2);
    expect(calls).toEqual(["commit:cursor-2"]);
  });

  it.each([
    ["PENDING_EXPIRATION", undefined, "REQUIRES_UPDATE"],
    ["ERROR", "ITEM_LOGIN_REQUIRED", "REQUIRES_UPDATE"],
    ["ERROR", "INSTITUTION_DOWN", "ERROR"],
  ] as const)("maps ITEM/%s webhook to %s health", async (webhookCode, errorCode, expectedHealth) => {
    const { service, store } = setup();
    const body = JSON.stringify({
      webhook_type: "ITEM", webhook_code: webhookCode, item_id: "item-fake",
      ...(errorCode === undefined ? {} : { error: { error_code: errorCode } }),
    });
    await service.acceptWebhook(body, "verified-jwt");
    expect(store.recordVerifiedWebhook).toHaveBeenCalledWith(expect.objectContaining({
      connectionHealth: expectedHealth,
      ...(errorCode === undefined ? {} : { connectionErrorCode: errorCode }),
    }));
  });

  it("calls Plaid removal before purging the stored token", async () => {
    const { service, provider, calls } = setup();
    vi.spyOn(provider, "removeItem").mockImplementation(async () => { calls.push("provider-remove"); });
    await service.disconnect(context, item.id, "retain");
    expect(calls).toEqual(["provider-remove", "purge"]);
  });
});

describe("BankingSyncWorker", () => {
  it("claims stale/retryable work and continues after an individual failure", async () => {
    const { service, store } = setup();
    vi.mocked(store.claimSyncJobs).mockResolvedValue([
      { id: "job-1", itemId: "item-1" }, { id: "job-2", itemId: "item-2" },
    ]);
    vi.spyOn(service, "processSyncJob")
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce();
    const worker = new BankingSyncWorker(store, service, { now: () => now, staleAfterMs: 60_000, maxAttempts: 3 });
    await expect(worker.runOnce()).resolves.toEqual({ claimed: 2, completed: 1, failed: 1 });
    expect(store.claimSyncJobs).toHaveBeenCalledWith({
      limit: 10, staleBefore: new Date("2026-10-10T11:59:00.000Z"), maxAttempts: 3, claimedAt: now,
    });
  });
});
