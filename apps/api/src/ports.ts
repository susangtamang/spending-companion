import type { AuthenticatedUser, Budget, Category, FinancialAccount, Transaction } from "@spending-companion/contracts";

export const AUTH_PORT = Symbol("AUTH_PORT");
export const REPOSITORY_PORT = Symbol("REPOSITORY_PORT");
export const CLOCK_PORT = Symbol("CLOCK_PORT");

export interface Identity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly issuedAt?: number;
}

export interface AuthPort {
  verify(token: string): Promise<Identity>;
}

export interface ClockPort { now(): string; }

export interface UserProfile extends AuthenticatedUser {
  readonly displayName?: string;
  readonly currencyCode: "USD";
}

export interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly value: unknown;
}
export interface TransactionOverridePatch {
  readonly displayMerchant?: string | null;
  readonly categoryOverrideId?: string | null;
  readonly note?: string | null;
}
export type IdempotencyBegin = { readonly disposition: "started" } | { readonly disposition: "replay"; readonly value: unknown } | { readonly disposition: "conflict" };

export interface RepositoryPort {
  provision(identity: Identity, now: string): Promise<UserProfile>;
  updateUser(userId: string, patch: { displayName?: string | null; timezone?: string }, now: string): Promise<UserProfile>;
  listCategories(userId: string): Promise<Category[]>;
  saveCategory(userId: string, category: Category): Promise<Category>;
  findCategory(userId: string, id: string): Promise<Category | undefined>;
  listBudgets(userId: string): Promise<Budget[]>;
  saveBudget(userId: string, budget: Budget): Promise<Budget>;
  findBudget(userId: string, id: string): Promise<Budget | undefined>;
  deleteBudget(userId: string, id: string): Promise<boolean>;
  listTransactions(userId: string): Promise<Transaction[]>;
  findTransaction(userId: string, id: string): Promise<Transaction | undefined>;
  saveTransaction(userId: string, transaction: Transaction): Promise<Transaction>;
  saveTransactionOverride(userId: string, id: string, patch: TransactionOverridePatch, now: string): Promise<Transaction | undefined>;
  deleteTransaction(userId: string, id: string): Promise<boolean>;
  listAccounts(userId: string): Promise<FinancialAccount[]>;
  findAccount(userId: string, id: string): Promise<FinancialAccount | undefined>;
  saveAccount(userId: string, account: FinancialAccount): Promise<FinancialAccount>;
  idempotencyBegin(userId: string, key: string, fingerprint: string, now: string): Promise<IdempotencyBegin>;
  idempotencyComplete(userId: string, key: string, record: IdempotencyRecord, now: string): Promise<void>;
}
