import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPersistenceRepositories } from "./index.js";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl !== undefined) {
  const databaseName = new URL(testUrl).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must target a database whose name ends with _test.");
  }
}
const describeDatabase = testUrl ? describe : describe.skip;

describeDatabase("PostgreSQL persistence", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  const repositories = createPersistenceRepositories(prisma);
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.deleteMany({ where: { issuer: "integration-test" } });
    const first = await repositories.users.provision(
      { identityProvider: "test", issuer: "integration-test", subject: "a@example" },
      { timezone: "America/Chicago" },
    ) as { id: string };
    const second = await repositories.users.provision(
      { identityProvider: "test", issuer: "integration-test", subject: "b@example" },
      { timezone: "America/New_York" },
    ) as { id: string };
    userA = first.id;
    userB = second.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { issuer: "integration-test" } });
    await prisma.$disconnect();
  });

  it("provisions identity tuples idempotently", async () => {
    const existing = await repositories.users.provision(
      { identityProvider: "test", issuer: "integration-test", subject: "a@example" },
      { timezone: "America/Los_Angeles" },
    ) as { id: string; timezone: string };
    expect(existing.id).toBe(userA);
    expect(existing.timezone).toBe("America/Chicago");
  });

  it("prevents cross-tenant repository reads and updates", async () => {
    await repositories.budgets.create({ userId: userA }, {
      mode: "INCLUDING_UTILITIES", scopeKey: "default", amountCents: 250000n,
    });
    const budget = await prisma.budget.findFirstOrThrow({ where: { userId: userA } });
    await expect(repositories.budgets.findById({ userId: userB }, budget.id)).resolves.toBeNull();
    await expect(repositories.budgets.update({ userId: userB }, budget.id, { amountCents: 1n })).resolves.toBeNull();
    await expect(prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).resolves.toMatchObject({ amountCents: 250000n });
  });

  it("enforces USD and non-negative cents in PostgreSQL", async () => {
    await expect(prisma.budget.create({ data: {
      userId: userA, mode: "EXCLUDING_UTILITIES", scopeKey: "bad", amountCents: -1n,
    } })).rejects.toThrow();
    await expect(prisma.account.create({ data: {
      userId: userA,
      plaidItemId: "00000000-0000-0000-0000-000000000000",
      providerAccountId: "bad",
      name: "Bad",
      type: "checking",
      currencyCode: "CAD",
    } })).rejects.toThrow();
  });

  it("persists and replays completed idempotency results and rejects key reuse", async () => {
    const input = {
      key: "integration-key",
      method: "POST",
      path: "/v1/transactions",
      bodyFingerprint: "sha256:abc",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    };
    await expect(repositories.idempotency.begin({ userId: userA }, input)).resolves.toMatchObject({ disposition: "started" });
    await expect(repositories.idempotency.complete({ userId: userA }, input.key, 201, { id: "created" }, new Date())).resolves.toBe(true);
    await expect(repositories.idempotency.begin({ userId: userA }, input)).resolves.toMatchObject({ disposition: "replay" });
    await expect(repositories.idempotency.begin({ userId: userA }, { ...input, bodyFingerprint: "sha256:different" })).resolves.toMatchObject({ disposition: "conflict" });
  });
});
