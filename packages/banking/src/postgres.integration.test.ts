import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakePlaidProvider, type EncryptedSecret } from "../../plaid/src/index.js";
import { normalizePlaidTransaction } from "./normalize.js";
import { PostgresBankingStore } from "./postgres.js";
import { BankingService } from "./service.js";
import type { BankingPlaidProvider } from "./types.js";
import { BankingSyncWorker } from "./worker.js";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl !== undefined && !new URL(testUrl).pathname.slice(1).endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must target a database whose name ends with _test.");
}
const describeDatabase = testUrl ? describe : describe.skip;

describeDatabase("PostgreSQL Plaid orchestration", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  const baseProvider = new FakePlaidProvider();
  const provider = Object.assign(baseProvider, {
    getAccounts: vi.fn(async () => [{
      accountId: "banking-provider-account", name: "Checking", type: "checking" as const, isoCurrencyCode: "USD",
    }]),
  }) satisfies BankingPlaidProvider;
  const secret: EncryptedSecret = { algorithm: "KMS", keyVersion: "integration-v1", ciphertext: "ciphertext" };
  const store = new PostgresBankingStore(prisma);
  const service = new BankingService({
    provider,
    store,
    encryption: { encrypt: vi.fn(async () => secret), decrypt: vi.fn(async () => "access-fake") },
    verifyWebhook: { verify: vi.fn(async (raw) => ({ body: JSON.parse(String(raw)) as unknown, keyId: "integration-key" })) },
    normalizeTransaction: normalizePlaidTransaction,
    linkRequest: (context, input) => ({ clientUserId: context.userId, clientName: input.clientName, webhookUrl: input.webhookUrl }),
    now: () => new Date("2026-10-10T12:00:00.000Z"),
  });
  let userId = "";
  let itemId = "";

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.webhookReceipt.deleteMany({ where: { verificationKeyId: "integration-key" } });
    await prisma.user.deleteMany({ where: { issuer: "banking-integration-test" } });
    const user = await prisma.user.create({ data: {
      identityProvider: "test", issuer: "banking-integration-test", subject: "subject",
      timezone: "America/Chicago", currencyCode: "USD",
    } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { issuer: "banking-integration-test" } });
    await prisma.$disconnect();
  });

  it("records consent, encrypts exchange, and creates tenant-scoped accounts", async () => {
    const link = await service.createLinkToken({ userId }, {
      consentVersion: "2026-10", consentedAt: "2026-10-10T12:00:00.000Z",
      clientName: "Spending Companion", webhookUrl: "https://example.test/v1/webhooks/plaid",
    });
    const result = await service.exchange({ userId }, {
      linkSessionId: link.linkSessionId, publicToken: "public-sandbox",
      institutionId: "ins-test", institutionName: "Test Bank",
    });
    itemId = result.itemId;
    await expect(prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).resolves.toMatchObject({
      userId, consentVersion: "2026-10", keyVersion: "integration-v1", health: "HEALTHY",
    });
    await expect(prisma.account.findFirstOrThrow({ where: { plaidItemId: itemId } })).resolves.toMatchObject({
      userId, providerAccountId: "banking-provider-account", currencyCode: "USD",
    });
  });

  it("claims a durable job and atomically advances cursor after all pages", async () => {
    provider.syncResponses.push({
      nextCursor: "cursor-1", hasMore: false, modified: [], removed: [], added: [{
        transactionId: "pending-1", accountId: "banking-provider-account", pending: true,
        amount: 42.5, signedAmountCents: 4250, date: "2026-10-10", authorizedDate: "2026-10-09",
        merchantName: "Walmart", name: "Walmart", isoCurrencyCode: "USD", raw: { source: "fake" },
      }],
    });
    await service.enqueueSync({ userId }, itemId);
    const jobs = await store.claimSyncJobs({
      limit: 10, maxAttempts: 5,
      claimedAt: new Date("2026-10-10T12:01:00.000Z"),
      staleBefore: new Date("2026-10-10T11:56:00.000Z"),
    });
    expect(jobs).toHaveLength(1);
    await service.processSyncJob(jobs[0]!);
    await expect(prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).resolves.toMatchObject({ syncCursor: "cursor-1", health: "HEALTHY" });
    await expect(prisma.transaction.findFirstOrThrow({ where: { userId, sourceTransactionId: "pending-1" } })).resolves.toMatchObject({
      status: "PENDING", amountCents: 4250n,
    });
  });

  it("preserves overrides and reconciles a provider-linked posted replacement once", async () => {
    const pending = await prisma.transaction.findFirstOrThrow({ where: { userId, sourceTransactionId: "pending-1" } });
    await prisma.transactionOverride.create({ data: { transactionId: pending.id, userId, note: "keep this" } });
    provider.syncResponses.push({
      requestedCursor: "cursor-1", nextCursor: "cursor-2", hasMore: false, added: [{
        transactionId: "posted-1", accountId: "banking-provider-account", pendingTransactionId: "pending-1", pending: false,
        amount: 42.5, signedAmountCents: 4250, date: "2026-10-11", authorizedDate: "2026-10-09",
        merchantName: "Walmart Store", name: "Walmart", isoCurrencyCode: "USD", raw: { source: "fake-posted" },
      }], modified: [], removed: [],
    });
    await service.enqueueSync({ userId }, itemId);
    await new BankingSyncWorker(store, service).runOnce();
    const posted = await prisma.transaction.findFirstOrThrow({ where: { userId, sourceTransactionId: "posted-1" } });
    await expect(prisma.transaction.findUniqueOrThrow({ where: { id: pending.id }, include: { override: true } })).resolves.toMatchObject({
      status: "REMOVED", reconciledToTransactionId: posted.id, override: { note: "keep this" },
    });
  });

  it("durably dedupes error webhooks and changes connection health", async () => {
    const body = JSON.stringify({
      webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-fake", error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });
    await expect(service.acceptWebhook(body, "verified")).resolves.toEqual({ duplicate: false });
    await expect(service.acceptWebhook(body, "verified")).resolves.toEqual({ duplicate: true });
    await expect(prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).resolves.toMatchObject({ health: "REQUIRES_UPDATE" });
    await expect(prisma.webhookReceipt.count({ where: { webhookType: "ITEM", webhookCode: "ERROR" } })).resolves.toBe(1);
  });
});
