import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AUTH_PORT, CLOCK_PORT, REPOSITORY_PORT, type AuthPort, type ClockPort } from "../src/ports.js";
import { ApiErrorFilter, SanitizingValidationPipe } from "../src/http.js";
import { PostgresRepository, identityHash } from "../src/postgres.js";
import { IMPORT_FEATURE, ImportFeature } from "../src/import-feature.js";
import { RECONCILIATION_FEATURE, ReconciliationFeature } from "../src/reconciliation-feature.js";
import { PRIVACY_FEATURE, PrivacyFeature } from "../src/privacy-feature.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = !!testDatabaseUrl && new URL(testDatabaseUrl).pathname.endsWith("_test");
const suite = enabled ? describe : describe.skip;
const subjects = ["api-restart-test-a", "api-restart-test-b"];

class DatabaseTestAuth implements AuthPort {
  public async verify(token: string) {
    if (token === "api-restart-test-b-stale") return { issuer: "https://test.clerk.invalid", subject: "api-restart-test-b", issuedAt: 0 };
    if (!subjects.includes(token)) throw new Error("invalid");
    return { issuer: "https://test.clerk.invalid", subject: token };
  }
}
class FixedClock implements ClockPort { public now(): string { return "2026-10-09T18:00:00.000Z"; } }

suite("PostgreSQL HTTP restart gate", () => {
  afterAll(async () => {
    const client = testClient();
    await client.user.deleteMany({ where: { issuer: "https://test.clerk.invalid", subject: { in: subjects } } });
    await client.deletionTombstone.deleteMany({ where: { identityHash: { in: subjects.map((subject) => identityHash({ issuer: "https://test.clerk.invalid", subject })) } } });
    await client.$disconnect();
  });

  it("persists a purchase across app restart and denies the other tenant", async () => {
    const first = await createDatabaseApp();
    const payload = { status: "posted", kind: "purchase", amountCents: 1234, displayMerchant: "Restart Store", occurrenceDate: "2026-10-09" };
    let createdId = "";
    try {
      const created = await request(first.getHttpServer()).post("/v1/transactions")
        .set("Authorization", "Bearer api-restart-test-a")
        .set("Idempotency-Key", "database-restart-key-001")
        .send(payload)
        .expect(201);
      createdId = created.body.id as string;
    } finally { await first.close(); }

    const second = await createDatabaseApp();
    try {
      const replay = await request(second.getHttpServer()).post("/v1/transactions")
        .set("Authorization", "Bearer api-restart-test-a")
        .set("Idempotency-Key", "database-restart-key-001")
        .send(payload).expect(201);
      expect(replay.body.id).toBe(createdId);
      const summary = await request(second.getHttpServer()).get("/v1/summaries/monthly?month=2026-10&budgetMode=including_utilities")
        .set("Authorization", "Bearer api-restart-test-a").expect(200);
      expect(summary.body.spentCents).toBe(1234);
      await request(second.getHttpServer()).get(`/v1/transactions/${createdId}`)
        .set("Authorization", "Bearer api-restart-test-b").expect(404);
    } finally { await second.close(); }
  });

  it("previews, idempotently commits, isolates, and atomically undoes a CSV import", async () => {
    const app = await createDatabaseApp();
    try {
      const csv = "sourceId,date,merchant,amount,status,category,kind\ncsv-1,2026-10-08,CSV Market,10.25,posted,groceries,purchase";
      const preview = await request(app.getHttpServer()).post("/v1/imports/csv/preview")
        .set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "csv-preview-key-00001")
        .attach("file", Buffer.from(csv), { filename: "transactions.csv", contentType: "text/csv" }).expect(201);
      expect(preview.body.rows).toMatchObject([{ disposition: "valid" }]);
      const replay = await request(app.getHttpServer()).post("/v1/imports/csv/preview")
        .set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "csv-preview-key-00001")
        .attach("file", Buffer.from(csv), { filename: "transactions.csv", contentType: "text/csv" }).expect(201);
      expect(replay.body.id).toBe(preview.body.id);
      await request(app.getHttpServer()).get(`/v1/imports/${preview.body.id}`).set("Authorization", "Bearer api-restart-test-b").expect(404);
      const committed = await request(app.getHttpServer()).post("/v1/imports/csv/commit")
        .set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "csv-commit-key-000001")
        .send({ previewId: preview.body.id }).expect(201);
      expect(committed.body).toMatchObject({ status: "committed", importedRows: 1 });
      const transactions = await request(app.getHttpServer()).get("/v1/transactions?source=csv").set("Authorization", "Bearer api-restart-test-a").expect(200);
      expect(transactions.body.data).toMatchObject([{ displayMerchant: "CSV Market", amountCents: 1025 }]);
      await request(app.getHttpServer()).post(`/v1/imports/${preview.body.id}/undo`)
        .set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "csv-undo-key-0000001").expect(201);
      const afterUndo = await request(app.getHttpServer()).get("/v1/transactions?source=csv").set("Authorization", "Bearer api-restart-test-a").expect(200);
      expect(afterUndo.body.data).toEqual([]);
    } finally { await app.close(); }
  });

  it("lists and confirms tenant-scoped reconciliation candidates", async () => {
    const app = await createDatabaseApp();
    const client = testClient();
    try {
      await request(app.getHttpServer()).get("/v1/me").set("Authorization", "Bearer api-restart-test-a").expect(200);
      const user = await client.user.findFirstOrThrow({ where: { issuer: "https://test.clerk.invalid", subject: "api-restart-test-a" } });
      const item = await client.plaidItem.create({ data: { userId: user.id, providerItemId: `reconcile-item-${Date.now()}`, institutionName: "Test Bank", encryptedAccessToken: new Uint8Array([1]), keyVersion: "test", consentVersion: "v1", consentedAt: new Date() } });
      const account = await client.account.create({ data: { userId: user.id, plaidItemId: item.id, providerAccountId: `reconcile-account-${Date.now()}`, name: "Checking", type: "checking" } });
      const pending = await client.transaction.create({ data: { userId: user.id, accountId: account.id, source: "PLAID", sourceScope: account.id, sourceTransactionId: `pending-${Date.now()}`, status: "PENDING", kind: "PURCHASE", amountCents: 2500n, displayMerchant: "Corner Market", normalizedMerchant: "corner market", occurrenceDate: new Date("2026-10-07") } });
      const posted = await client.transaction.create({ data: { userId: user.id, accountId: account.id, source: "PLAID", sourceScope: account.id, sourceTransactionId: `posted-${Date.now()}`, status: "POSTED", kind: "PURCHASE", amountCents: 2500n, displayMerchant: "Corner Market", normalizedMerchant: "corner market", occurrenceDate: new Date("2026-10-08"), postedDate: new Date("2026-10-08") } });
      const candidates = await request(app.getHttpServer()).get("/v1/reconciliations").set("Authorization", "Bearer api-restart-test-a").expect(200);
      expect(candidates.body).toEqual(expect.arrayContaining([expect.objectContaining({ pendingTransactionId: pending.id, postedTransactionId: posted.id, requiresConfirmation: true })]));
      const overridden = await request(app.getHttpServer()).patch(`/v1/transactions/${posted.id}`).set("Authorization", "Bearer api-restart-test-a")
        .set("Idempotency-Key", "provider-override-0001").send({ displayMerchant: "My Corner Market", note: "weekly groceries" }).expect(200);
      expect(overridden.body).toMatchObject({ displayMerchant: "My Corner Market", note: "weekly groceries" });
      expect(overridden.body.userId).toBeUndefined();
      expect(await client.transaction.findUniqueOrThrow({ where: { id: posted.id } })).toMatchObject({ displayMerchant: "Corner Market" });
      expect(await client.transactionOverride.findUniqueOrThrow({ where: { transactionId: posted.id } })).toMatchObject({ displayMerchant: "My Corner Market", note: "weekly groceries" });
      await request(app.getHttpServer()).post(`/v1/reconciliations/${pending.id}/confirm`).set("Authorization", "Bearer api-restart-test-b").set("Idempotency-Key", "reconcile-other-00001").send({ postedTransactionId: posted.id }).expect(404);
      await request(app.getHttpServer()).post(`/v1/reconciliations/${pending.id}/confirm`).set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "reconcile-confirm-001").send({ postedTransactionId: posted.id }).expect(201).expect(({ body }) => expect(body.decision).toBe("confirmed"));
      expect(await client.transaction.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "REMOVED", reconciledToTransactionId: posted.id });
    } finally { await client.$disconnect(); await app.close(); }
  }, 15_000);

  it("exports only the tenant's data and permanently tombstones a deleted identity", async () => {
    const app = await createDatabaseApp();
    try {
      await request(app.getHttpServer()).post("/v1/transactions").set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "export-source-key-001").send({ status: "posted", kind: "purchase", amountCents: 321, displayMerchant: "Privacy Store", occurrenceDate: "2026-10-09" }).expect(201);
      const created = await request(app.getHttpServer()).post("/v1/exports").set("Authorization", "Bearer api-restart-test-a").set("Idempotency-Key", "export-json-key-0001").send({ format: "json" }).expect(201);
      expect(created.body).toMatchObject({ status: "ready", format: "json" });
      await request(app.getHttpServer()).get(`/v1/exports/${created.body.id}`).set("Authorization", "Bearer api-restart-test-b").expect(404);
      await request(app.getHttpServer()).get(`/v1/exports/${created.body.id}/download`).set("Authorization", "Bearer api-restart-test-a").expect(200).expect(({ text }) => expect(text).toContain("Privacy Store"));
      await request(app.getHttpServer()).post("/v1/me/deletion").set("Authorization", "Bearer api-restart-test-b").set("Idempotency-Key", "delete-stale-key-001").send({ confirmation: "DELETE", reauthenticationToken: "api-restart-test-b-stale" }).expect(401);
      const deleted = await request(app.getHttpServer()).post("/v1/me/deletion").set("Authorization", "Bearer api-restart-test-b").set("Idempotency-Key", "delete-account-key-01").send({ confirmation: "DELETE", reauthenticationToken: "api-restart-test-b" }).expect(201);
      expect(deleted.body.status).toBe("completed");
      await request(app.getHttpServer()).get("/v1/me/deletion").set("Authorization", "Bearer api-restart-test-b").expect(200).expect(({ body }) => expect(body.status).toBe("completed"));
      await request(app.getHttpServer()).get("/v1/me").set("Authorization", "Bearer api-restart-test-b").expect(403);
    } finally { await app.close(); }
  }, 15_000);
});

async function createDatabaseApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_PORT).useClass(DatabaseTestAuth)
    .overrideProvider(CLOCK_PORT).useClass(FixedClock)
    .overrideProvider(REPOSITORY_PORT).useFactory({ factory: () => new PostgresRepository(testClient()) })
    .overrideProvider(IMPORT_FEATURE).useFactory({ factory: () => ImportFeature.fromEnvironment({ DATABASE_URL: testDatabaseUrl }) })
    .overrideProvider(RECONCILIATION_FEATURE).useFactory({ factory: () => ReconciliationFeature.fromEnvironment({ DATABASE_URL: testDatabaseUrl }) })
    .overrideProvider(PRIVACY_FEATURE).useFactory({ factory: () => PrivacyFeature.fromEnvironment({ DATABASE_URL: testDatabaseUrl }) })
    .compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new SanitizingValidationPipe());
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
  return app;
}

function testClient(): PrismaClient {
  if (!testDatabaseUrl || !new URL(testDatabaseUrl).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test.");
  return new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
}
