import { createHash, generateKeyPairSync } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import type { PlaidApi } from "plaid";
import { describe, expect, it } from "vitest";
import { FakePlaidProvider, LocalAes256GcmEncryption, PlaidNodeProvider, PlaidProviderError, fetchCompleteSync, plaidAmountToSignedCents, planSync, verifyPlaidWebhook } from "./index.js";
import type { PlaidTransactionRecord, SyncPage } from "./index.js";

const row = (id: string): PlaidTransactionRecord => ({ transactionId: id, accountId: "a", pending: false, amount: 1.23, signedAmountCents: 123, date: "2026-10-09", name: "Test", raw: {} });
const page = (requestedCursor: string | undefined, nextCursor: string, hasMore: boolean, added: readonly PlaidTransactionRecord[] = []): SyncPage => ({ ...(requestedCursor ? { requestedCursor } : {}), nextCursor, hasMore, added, modified: [], removed: [] });

describe("Plaid provider domain", () => {
  it("uses Transactions for US create mode and omits products in update mode", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      linkTokenCreate: async (request: Record<string, unknown>) => {
        requests.push(request);
        return { data: { link_token: "link", expiration: "2030-01-01T00:00:00Z" } };
      },
    } as unknown as PlaidApi;
    const provider = new PlaidNodeProvider(
      { clientId: "client-secret-never-serialized", secret: "api-secret-never-serialized", environment: "sandbox" },
      client,
    );
    const request = { clientUserId: "internal-user", clientName: "Spending Companion", webhookUrl: "https://example.test/webhook" };
    await provider.createTransactionsLinkToken(request);
    await provider.createUpdateLinkToken(request, "access-secret");
    expect(requests[0]).toMatchObject({ products: ["transactions"], country_codes: ["US"] });
    expect(requests[1]).toMatchObject({ access_token: "access-secret", country_codes: ["US"] });
    expect(requests[1]).not.toHaveProperty("products");
    expect(JSON.stringify(provider)).toBe('{"type":"PlaidNodeProvider"}');
  });
  it("converts signed decimal values to exact safe cents", () => {
    expect(plaidAmountToSignedCents(12.34)).toBe(1234);
    expect(plaidAmountToSignedCents("-0.05")).toBe(-5);
    expect(plaidAmountToSignedCents(1e-2)).toBe(1);
    expect(() => plaidAmountToSignedCents("1.001")).toThrow(/sub-cent/);
  });
  it("encrypts access tokens with authenticated context without serializing plaintext", async () => {
    const crypto = new LocalAes256GcmEncryption(Buffer.alloc(32, 7));
    const envelope = await crypto.encrypt("access-secret", { itemId: "item-1" });
    expect(JSON.stringify(envelope)).not.toContain("access-secret");
    await expect(crypto.decrypt(envelope, { itemId: "item-1" })).resolves.toBe("access-secret");
    await expect(crypto.decrypt(envelope, { itemId: "item-2" })).rejects.toThrow();
  });
  it("plans all pages and advances only to the final cursor", () => {
    const plan = planSync("c0", [page("c0", "c1", true, [row("1")]), page("c1", "c2", false, [row("2")])]);
    expect(plan.nextCursor).toBe("c2"); expect(plan.added.map((x) => x.transactionId)).toEqual(["1", "2"]);
  });
  it("restarts pagination from the original cursor after a mutation error", async () => {
    const fake = new FakePlaidProvider();
    fake.syncResponses = [page("c0", "c1", true, [row("stale")]), new PlaidProviderError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"), page("c0", "c9", false, [row("fresh")])];
    const result = await fetchCompleteSync(fake, "secret", "c0");
    expect(result.added.map((x) => x.transactionId)).toEqual(["fresh"]);
    expect(fake.calls.filter((x) => x.method === "sync").map((x) => x.cursor)).toEqual(["c0", "c1", "c0"]);
    expect(JSON.stringify(fake)).not.toContain("secret");
  });
});

describe("Plaid webhook verification", () => {
  it("verifies ES256, timestamp, and the exact raw body digest", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = await exportJWK(publicKey); const body = '{"webhook_code":"SYNC_UPDATES_AVAILABLE"}'; const now = 1_800_000_000;
    const jwt = await new SignJWT({ request_body_sha256: createHash("sha256").update(body).digest("hex") }).setProtectedHeader({ alg: "ES256", kid: "key-1" }).setIssuedAt(now).sign(privateKey);
    const verified = await verifyPlaidWebhook(body, jwt, { getWebhookVerificationKey: async () => ({ ...jwk, alg: "ES256", kid: "key-1" }) }, { now: () => now });
    expect(verified.body).toEqual({ webhook_code: "SYNC_UPDATES_AVAILABLE" });
    await expect(verifyPlaidWebhook(`${body} `, jwt, { getWebhookVerificationKey: async () => ({ ...jwk, alg: "ES256" }) }, { now: () => now })).rejects.toThrow(/digest/);
    await expect(verifyPlaidWebhook(body, jwt, { getWebhookVerificationKey: async () => ({ ...jwk, alg: "ES256" }) }, { now: () => now + 301 })).rejects.toThrow(/timestamp/);
  });
});
