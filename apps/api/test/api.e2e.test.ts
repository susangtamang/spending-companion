import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AUTH_PORT, CLOCK_PORT, REPOSITORY_PORT, type AuthPort, type ClockPort, type RepositoryPort } from "../src/ports.js";
import { ApiErrorFilter, SanitizingValidationPipe } from "../src/http.js";

class TestAuth implements AuthPort {
  public async verify(token: string) {
    if (token !== "token-a" && token !== "token-b") throw new Error("invalid");
    return { issuer: "test", subject: token, email: `${token}@example.test` };
  }
}
class TestClock implements ClockPort { public now(): string { return "2026-10-09T18:00:00.000Z"; } }

describe("API foundation", () => {
  let app: INestApplication;
  let repo: RepositoryPort;
  const authA = { Authorization: "Bearer token-a" };
  const authB = { Authorization: "Bearer token-b" };
  const idem = { "Idempotency-Key": "idempotency-key-0001" };

  beforeAll(async () => {
    process.env.API_USE_IN_MEMORY = "true";
    process.env.OPERATIONS_TOKEN = "operations-test-token";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PORT).useClass(TestAuth)
      .overrideProvider(CLOCK_PORT).useClass(TestClock)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new SanitizingValidationPipe());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    repo = app.get(REPOSITORY_PORT);
  });
  afterAll(async () => app.close());

  it("exposes health without authentication and structured request IDs", async () => {
    await request(app.getHttpServer()).get("/health").expect(200).expect(({ body }) => expect(body.status).toBe("ok"));
    await request(app.getHttpServer()).get("/v1/me").expect(401).expect(({ body, headers }) => {
      expect(body).toMatchObject({ code: "unauthorized", requestId: expect.any(String) });
      expect(headers["x-request-id"]).toBe(body.requestId);
    });
  });

  it("keeps readiness and metrics operationally separate from liveness", async () => {
    await request(app.getHttpServer()).get("/ready").expect(503).expect(({ body }) => expect(body.code).toBe("service_unavailable"));
    await request(app.getHttpServer()).get("/internal/metrics").expect(503);
    await request(app.getHttpServer()).get("/internal/metrics").set("Authorization", "Bearer operations-test-token").expect(200)
      .expect("Content-Type", /text\/plain/).expect(({ text }) => expect(text).toContain("spending_companion_http_requests_total"));
  });

  it("logs request metadata without financial or credential payloads", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.STRUCTURED_LOGGING = "true";
    try {
      await request(app.getHttpServer()).post("/v1/transactions").set(authA).set("Idempotency-Key", "logging-key-000001")
        .send({ status: "posted", kind: "purchase", amountCents: 9999, displayMerchant: "PRIVATE MERCHANT", occurrenceDate: "2026-09-03", accessToken: "SECRET TOKEN" }).expect(201);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("http_request");
      expect(output).not.toContain("PRIVATE MERCHANT");
      expect(output).not.toContain("SECRET TOKEN");
      expect(output).not.toContain("9999");
    } finally { delete process.env.STRUCTURED_LOGGING; log.mockRestore(); }
  });

  it("provisions stable current users without exposing provider subjects", async () => {
    const first = await request(app.getHttpServer()).get("/v1/me").set(authA).expect(200);
    const second = await request(app.getHttpServer()).get("/v1/me").set(authA).expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.identityProviderSubject).toBeUndefined();
    expect(first.body).toMatchObject({ email: "token-a@example.test", currencyCode: "USD" });
  });

  it("requires idempotency for mutations and replays a prior result", async () => {
    const payload = { status: "posted", kind: "purchase", amountCents: 4250, displayMerchant: "Walmart", occurrenceDate: "2026-10-03", userId: "user-attacker", identityProviderSubject: "attacker" };
    await request(app.getHttpServer()).post("/v1/transactions").set(authA).send(payload).expect(400);
    const first = await request(app.getHttpServer()).post("/v1/transactions").set(authA).set(idem).send(payload).expect(201);
    const replay = await request(app.getHttpServer()).post("/v1/transactions").set(authA).set(idem).send(payload).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body.userId).toBeUndefined();
    expect(first.body.audit).toBeUndefined();
    expect(first.body.identityProviderSubject).toBeUndefined();
    await request(app.getHttpServer()).post("/v1/transactions").set(authA).set(idem).send({ ...payload, amountCents: 999 }).expect(409);
  });

  it("prevents cross-user transaction and category access", async () => {
    const list = await request(app.getHttpServer()).get("/v1/transactions").set(authA).expect(200);
    const transactionId = list.body.data[0].id as string;
    await request(app.getHttpServer()).get(`/v1/transactions/${transactionId}`).set(authB).expect(404);

    const category = await request(app.getHttpServer()).post("/v1/categories").set(authA).set("Idempotency-Key", "category-key-00001").send({ name: "Private", isUtility: false }).expect(201);
    expect(category.body.userId).toBeUndefined();
    await request(app.getHttpServer()).patch(`/v1/categories/${category.body.id}`).set(authB).set("Idempotency-Key", "category-key-00002").send({ name: "Stolen", isUtility: false }).expect(404);
  });

  it("isolates accounts and produces an authoritative summary", async () => {
    const userA = await repo.provision({ issuer: "test", subject: "token-a" }, "2026-10-09T18:00:00.000Z");
    const userB = await repo.provision({ issuer: "test", subject: "token-b" }, "2026-10-09T18:00:00.000Z");
    await repo.saveAccount(userA.id, { id: "account-a", userId: userA.id, connectionId: "connection-a", sourceAccountId: "source-a", name: "Checking", type: "checking", includeInSpending: true, currencyCode: "USD", createdAt: "2026-10-09T18:00:00.000Z", updatedAt: "2026-10-09T18:00:00.000Z" });
    await repo.saveAccount(userB.id, { id: "account-b", userId: userB.id, connectionId: "connection-b", sourceAccountId: "source-b", name: "Credit", type: "credit", includeInSpending: true, currencyCode: "USD", createdAt: "2026-10-09T18:00:00.000Z", updatedAt: "2026-10-09T18:00:00.000Z" });
    const accountsA = await request(app.getHttpServer()).get("/v1/accounts").set(authA).expect(200);
    expect(accountsA.body.map((a: { id: string }) => a.id)).toEqual(["account-a"]);
    expect(accountsA.body[0].userId).toBeUndefined();
    expect(accountsA.body[0].sourceAccountId).toBeUndefined();
    await request(app.getHttpServer()).patch("/v1/accounts/account-b").set(authA).set("Idempotency-Key", "account-key-000001").send({ includeInSpending: false }).expect(404);

    const summary = await request(app.getHttpServer()).get("/v1/summaries/monthly?month=2026-10&budgetMode=including_utilities").set(authA).expect(200);
    expect(summary.body).toMatchObject({ spentCents: 4250, postedCents: 4250, pendingCents: 0, availableCents: 245750 });
  });

  it("stores user overrides without allowing imported transaction deletion", async () => {
    const user = await repo.provision({ issuer: "test", subject: "token-a" }, "2026-10-09T18:00:00.000Z");
    await repo.saveTransaction(user.id, {
      id: "plaid-transaction-a", userId: user.id, source: "plaid", sourceTransactionId: "provider-transaction-a",
      status: "posted", kind: "purchase", amountCents: 725, currencyCode: "USD", rawMerchant: "RAW STORE 123",
      displayMerchant: "Raw Store", normalizedMerchant: "raw store", occurrenceDate: "2026-10-08", postedDate: "2026-10-09",
      createdAt: "2026-10-09T18:00:00.000Z", updatedAt: "2026-10-09T18:00:00.000Z",
    });
    const updated = await request(app.getHttpServer()).patch("/v1/transactions/plaid-transaction-a").set(authA)
      .set("Idempotency-Key", "override-key-00001").send({ displayMerchant: "My Store", note: "work lunch" }).expect(200);
    expect(updated.body).toMatchObject({ source: "plaid", sourceTransactionId: "provider-transaction-a", rawMerchant: "RAW STORE 123", displayMerchant: "My Store", note: "work lunch" });
    expect(updated.body.userId).toBeUndefined();
    await request(app.getHttpServer()).delete("/v1/transactions/plaid-transaction-a").set(authA)
      .set("Idempotency-Key", "override-key-00002").expect(409);
  });

  it("returns explicit 503 when Plaid credentials are absent", async () => {
    await request(app.getHttpServer()).post("/v1/plaid/link-token").set(authA).set("Idempotency-Key", "plaid-key-00000001").send({ consentAccepted: true, consentVersion: "v1" }).expect(503).expect(({ body }) => expect(body.code).toBe("service_unavailable"));
  });
});
