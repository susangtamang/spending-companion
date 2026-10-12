import { describe, expect, it, vi } from "vitest";

import {
  PrismaCategoryRepository,
  PrismaTransactionRepository,
  PrismaUserRepository,
  type ModelDelegate,
  type PersistenceClient,
} from "./index.js";

function delegate(): ModelDelegate {
  return {
    findFirst: vi.fn().mockResolvedValue({ id: "row" }),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "row" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

function client() {
  const model = delegate();
  return { model, client: { user: model, category: model, budget: model, transaction: model, account: model, idempotencyRecord: model } satisfies PersistenceClient };
}

describe("tenant repositories", () => {
  it("adds session userId to reads", async () => {
    const { model, client: db } = client();
    await new PrismaTransactionRepository(db).findById({ userId: " user-a " }, "transaction-a");
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: "transaction-a", userId: "user-a" } });
  });

  it("overrides request ownership on create", async () => {
    const { model, client: db } = client();
    await new PrismaTransactionRepository(db).create({ userId: "user-a" }, { userId: "user-b", amountCents: 100 });
    expect(model.create).toHaveBeenCalledWith({ data: { userId: "user-a", amountCents: 100 } });
  });

  it("uses updateMany with tenant predicate to prevent IDOR", async () => {
    const { model, client: db } = client();
    await new PrismaTransactionRepository(db).update({ userId: "user-a" }, "transaction-b", { userId: "user-b", status: "POSTED" });
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: "transaction-b", userId: "user-a" }, data: { status: "POSTED" },
    });
  });

  it("returns null without a post-update read when ownership does not match", async () => {
    const { model, client: db } = client();
    vi.mocked(model.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(new PrismaTransactionRepository(db).update({ userId: "user-a" }, "other", {})).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it("never archives system categories", async () => {
    const { model, client: db } = client();
    await new PrismaCategoryRepository(db).archive({ userId: "user-a" }, "category-a", new Date("2026-10-09T00:00:00Z"));
    expect(model.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "category-a", userId: "user-a", isSystem: false },
    }));
  });

  it("allows a user to read and update only their own user row", async () => {
    const { model, client: db } = client();
    const repository = new PrismaUserRepository(db);
    await expect(repository.findById({ userId: "user-a" }, "user-b")).resolves.toBeNull();
    await expect(repository.update({ userId: "user-a" }, "user-b", { timezone: "America/Chicago" })).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it("rejects missing internal user context", async () => {
    const { client: db } = client();
    await expect(new PrismaTransactionRepository(db).list({ userId: "" })).rejects.toThrow("userId is required");
  });
});
