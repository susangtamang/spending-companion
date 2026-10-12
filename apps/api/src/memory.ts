import { Injectable } from "@nestjs/common";
import type { AuthenticatedUser, Budget, Category, FinancialAccount, Transaction } from "@spending-companion/contracts";
import type { IdempotencyRecord, Identity, RepositoryPort, TransactionOverridePatch, UserProfile } from "./ports.js";

@Injectable()
export class InMemoryRepository implements RepositoryPort {
  private readonly users = new Map<string, UserProfile>();
  private readonly subjectToUser = new Map<string, string>();
  private readonly categories: Category[] = [];
  private readonly budgets: Budget[] = [];
  private readonly transactions: Transaction[] = [];
  private readonly accounts: FinancialAccount[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  public async provision(identity: Identity, now: string): Promise<UserProfile> {
    const key = `${identity.issuer}\u0000${identity.subject}`;
    const existingId = this.subjectToUser.get(key);
    if (existingId) return this.users.get(existingId)!;
    const id = `user_${stableId(key)}`;
    const user: UserProfile = { id, identityProviderSubject: identity.subject, ...(identity.email ? { email: identity.email } : {}), timezone: "America/Chicago", currencyCode: "USD", createdAt: now, updatedAt: now };
    this.subjectToUser.set(key, id); this.users.set(id, user); return user;
  }
  public async updateUser(userId: string, patch: { displayName?: string | null; timezone?: string }, now: string): Promise<UserProfile> {
    const user = this.users.get(userId)!; const next = { ...user, ...patch, updatedAt: now } as UserProfile; this.users.set(userId, next); return next;
  }
  public async listCategories(userId: string): Promise<Category[]> { return this.categories.filter((v) => v.userId === undefined || v.userId === userId); }
  public async saveCategory(userId: string, value: Category): Promise<Category> { return upsert(this.categories, value, userId); }
  public async findCategory(userId: string, id: string): Promise<Category | undefined> { return this.categories.find((v) => v.id === id && (v.userId === undefined || v.userId === userId)); }
  public async listBudgets(userId: string): Promise<Budget[]> { return owned(this.budgets, userId); }
  public async saveBudget(userId: string, value: Budget): Promise<Budget> { return upsert(this.budgets, value, userId); }
  public async findBudget(userId: string, id: string): Promise<Budget | undefined> { return findOwned(this.budgets, userId, id); }
  public async deleteBudget(userId: string, id: string): Promise<boolean> { return removeOwned(this.budgets, userId, id); }
  public async listTransactions(userId: string): Promise<Transaction[]> { return owned(this.transactions, userId); }
  public async findTransaction(userId: string, id: string): Promise<Transaction | undefined> { return findOwned(this.transactions, userId, id); }
  public async saveTransaction(userId: string, value: Transaction): Promise<Transaction> { return upsert(this.transactions, value, userId); }
  public async saveTransactionOverride(userId: string, id: string, patch: TransactionOverridePatch, now: string): Promise<Transaction | undefined> {
    const current = findOwned(this.transactions, userId, id);
    if (!current) return undefined;
    const next = {
      ...current,
      ...(patch.displayMerchant === undefined ? {} : { displayMerchant: patch.displayMerchant ?? current.rawMerchant ?? current.displayMerchant }),
      ...(patch.categoryOverrideId === undefined ? {} : { categoryOverrideId: patch.categoryOverrideId ?? undefined }),
      ...(patch.note === undefined ? {} : { note: patch.note ?? undefined }),
      updatedAt: now,
    } as Transaction;
    return upsert(this.transactions, next, userId);
  }
  public async deleteTransaction(userId: string, id: string): Promise<boolean> { return removeOwned(this.transactions, userId, id); }
  public async listAccounts(userId: string): Promise<FinancialAccount[]> { return owned(this.accounts, userId); }
  public async findAccount(userId: string, id: string): Promise<FinancialAccount | undefined> { return findOwned(this.accounts, userId, id); }
  public async saveAccount(userId: string, value: FinancialAccount): Promise<FinancialAccount> { return upsert(this.accounts, value, userId); }
  public async idempotencyBegin(userId: string, key: string, fingerprint: string): Promise<import("./ports.js").IdempotencyBegin> { const prior = this.idempotency.get(`${userId}\u0000${key}`); if (!prior) { this.idempotency.set(`${userId}\u0000${key}`, { fingerprint, value: IN_PROGRESS }); return { disposition: "started" }; } if (prior.fingerprint !== fingerprint || prior.value === IN_PROGRESS) return { disposition: "conflict" }; return { disposition: "replay", value: prior.value }; }
  public async idempotencyComplete(userId: string, key: string, value: IdempotencyRecord): Promise<void> { this.idempotency.set(`${userId}\u0000${key}`, value); }
}

function owned<T extends { userId: string }>(values: readonly T[], userId: string): T[] { return values.filter((v) => v.userId === userId); }
function findOwned<T extends { id: string; userId: string }>(values: readonly T[], userId: string, id: string): T | undefined { return values.find((v) => v.id === id && v.userId === userId); }
function upsert<T extends { id: string; userId?: string }>(values: T[], value: T, userId: string): T { if (value.userId !== userId) throw new Error("Repository ownership violation."); const i = values.findIndex((v) => v.id === value.id && v.userId === userId); if (i < 0) values.push(value); else values[i] = value; return value; }
function removeOwned<T extends { id: string; userId: string }>(values: T[], userId: string, id: string): boolean { const i = values.findIndex((v) => v.id === id && v.userId === userId); if (i < 0) return false; values.splice(i, 1); return true; }
function stableId(input: string): string { let h = 2166136261; for (const c of input) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const IN_PROGRESS = Symbol("in-progress");
