export interface TenantContext {
  /** Derived from the authenticated session, never from a request body. */
  readonly userId: string;
}

export interface PageOptions {
  readonly take?: number;
  readonly cursor?: string;
}

export interface TenantRepository<T, Create, Update> {
  findById(context: TenantContext, id: string): Promise<T | null>;
  list(context: TenantContext, page?: PageOptions): Promise<readonly T[]>;
  create(context: TenantContext, data: Create): Promise<T>;
  update(context: TenantContext, id: string, data: Update): Promise<T | null>;
}

export type UserRepository = Pick<TenantRepository<unknown, never, Record<string, unknown>>, "findById" | "update">;
export type CategoryRepository = TenantRepository<unknown, Record<string, unknown>, Record<string, unknown>> & {
  archive(context: TenantContext, id: string, archivedAt: Date): Promise<unknown | null>;
};
export type BudgetRepository = TenantRepository<unknown, Record<string, unknown>, Record<string, unknown>>;
export type TransactionRepository = TenantRepository<unknown, Record<string, unknown>, Record<string, unknown>>;
export type AccountRepository = Pick<TenantRepository<unknown, never, Record<string, unknown>>, "findById" | "list" | "update">;

export interface ModelDelegate {
  findFirst(args: Record<string, unknown>): Promise<unknown | null>;
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  create(args: Record<string, unknown>): Promise<unknown>;
  updateMany(args: Record<string, unknown>): Promise<{ readonly count: number }>;
}

export interface PersistenceClient {
  readonly user: ModelDelegate;
  readonly category: ModelDelegate;
  readonly budget: ModelDelegate;
  readonly transaction: ModelDelegate;
  readonly account: ModelDelegate;
  readonly idempotencyRecord: ModelDelegate;
  $transaction?<T>(operation: (transaction: PersistenceClient) => Promise<T>): Promise<T>;
}

type ModelName = "user" | "category" | "budget" | "transaction" | "account" | "idempotencyRecord";

/**
 * Prisma-compatible repository. Every predicate is augmented with the internal
 * authenticated user ID; ownership is never accepted inside mutation data.
 */
export class PrismaTenantRepository implements TenantRepository<unknown, Record<string, unknown>, Record<string, unknown>> {
  public constructor(
    protected readonly client: PersistenceClient,
    protected readonly model: ModelName,
  ) {}

  public async findById(context: TenantContext, id: string): Promise<unknown | null> {
    return this.delegate.findFirst({ where: { id, userId: requiredUserId(context) } });
  }

  public async list(context: TenantContext, page: PageOptions = {}): Promise<readonly unknown[]> {
    const take = Math.min(Math.max(page.take ?? 50, 1), 100);
    return this.delegate.findMany({
      where: { userId: requiredUserId(context) },
      take,
      orderBy: { id: "asc" },
      ...(page.cursor === undefined ? {} : { cursor: { id: page.cursor }, skip: 1 }),
    });
  }

  public async create(context: TenantContext, data: Record<string, unknown>): Promise<unknown> {
    return this.delegate.create({ data: { ...withoutOwnership(data), userId: requiredUserId(context) } });
  }

  public async update(context: TenantContext, id: string, data: Record<string, unknown>): Promise<unknown | null> {
    const userId = requiredUserId(context);
    const result = await this.delegate.updateMany({ where: { id, userId }, data: withoutOwnership(data) });
    return result.count === 0 ? null : this.delegate.findFirst({ where: { id, userId } });
  }

  protected get delegate(): ModelDelegate {
    return this.client[this.model];
  }
}

export class PrismaUserRepository implements UserRepository {
  public constructor(private readonly client: PersistenceClient) {}

  public findById(context: TenantContext, id: string): Promise<unknown | null> {
    const userId = requiredUserId(context);
    if (id !== userId) return Promise.resolve(null);
    return this.client.user.findFirst({ where: { id: userId } });
  }

  public async update(context: TenantContext, id: string, data: Record<string, unknown>): Promise<unknown | null> {
    const userId = requiredUserId(context);
    if (id !== userId) return null;
    const result = await this.client.user.updateMany({ where: { id: userId }, data: withoutOwnership(data) });
    return result.count === 0 ? null : this.client.user.findFirst({ where: { id: userId } });
  }

  /** Provisioning identity comes only from a verified identity-provider token. */
  public async provision(identity: VerifiedIdentity, defaults: UserProvisionDefaults): Promise<unknown> {
    const existing = await this.client.user.findFirst({ where: {
      identityProvider: identity.identityProvider,
      issuer: identity.issuer,
      subject: identity.subject,
    } });
    if (existing !== null) return existing;
    return this.client.user.create({ data: {
      identityProvider: identity.identityProvider,
      issuer: identity.issuer,
      subject: identity.subject,
      ...(identity.email === undefined ? {} : { email: identity.email }),
      ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
      timezone: defaults.timezone,
      currencyCode: "USD",
    } });
  }
}

export interface VerifiedIdentity {
  readonly identityProvider: string;
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
}

export interface UserProvisionDefaults { readonly timezone: string }

export interface BeginIdempotentMutation {
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly bodyFingerprint: string;
  readonly expiresAt: Date;
}

export type IdempotencyBeginResult =
  | { readonly disposition: "started"; readonly record: unknown }
  | { readonly disposition: "replay"; readonly record: unknown }
  | { readonly disposition: "conflict"; readonly record: unknown };

export class PrismaIdempotencyRepository {
  public constructor(private readonly client: PersistenceClient) {}

  /**
   * Requires a database transaction in production. The user/key unique index is
   * the final concurrency arbiter; callers retry the read after a P2002 race.
   */
  public async begin(context: TenantContext, input: BeginIdempotentMutation): Promise<IdempotencyBeginResult> {
    const userId = requiredUserId(context);
    const existing = await this.client.idempotencyRecord.findFirst({ where: { userId, key: input.key } });
    if (existing !== null) return classifyIdempotency(existing, input);
    try {
      const record = await this.client.idempotencyRecord.create({ data: {
        userId,
        key: input.key,
        method: input.method,
        path: input.path,
        bodyFingerprint: input.bodyFingerprint,
        state: "IN_PROGRESS",
        expiresAt: input.expiresAt,
      } });
      return { disposition: "started", record };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.client.idempotencyRecord.findFirst({ where: { userId, key: input.key } });
      if (raced === null) throw error;
      return classifyIdempotency(raced, input);
    }
  }

  public async complete(
    context: TenantContext,
    key: string,
    responseStatus: number,
    responseBody: unknown,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.client.idempotencyRecord.updateMany({
      where: { userId: requiredUserId(context), key, state: "IN_PROGRESS" },
      data: { state: "COMPLETED", responseStatus, responseBody, completedAt },
    });
    return result.count === 1;
  }
}

export class PrismaCategoryRepository extends PrismaTenantRepository implements CategoryRepository {
  public constructor(client: PersistenceClient) { super(client, "category"); }

  public async archive(context: TenantContext, id: string, archivedAt: Date): Promise<unknown | null> {
    const userId = requiredUserId(context);
    const result = await this.delegate.updateMany({
      where: { id, userId, isSystem: false },
      data: { archivedAt },
    });
    return result.count === 0 ? null : this.delegate.findFirst({ where: { id, userId } });
  }
}

export class PrismaBudgetRepository extends PrismaTenantRepository implements BudgetRepository {
  public constructor(client: PersistenceClient) { super(client, "budget"); }
}

export class PrismaTransactionRepository extends PrismaTenantRepository implements TransactionRepository {
  public constructor(client: PersistenceClient) { super(client, "transaction"); }
}

export class PrismaAccountRepository extends PrismaTenantRepository implements AccountRepository {
  public constructor(client: PersistenceClient) { super(client, "account"); }
}

export interface PersistenceRepositories {
  readonly users: PrismaUserRepository;
  readonly categories: PrismaCategoryRepository;
  readonly budgets: PrismaBudgetRepository;
  readonly transactions: PrismaTransactionRepository;
  readonly accounts: PrismaAccountRepository;
  readonly idempotency: PrismaIdempotencyRepository;
}

/** Accepts a generated PrismaClient while keeping this package easy to unit test. */
export function createPersistenceRepositories(client: unknown): PersistenceRepositories {
  const persistenceClient = client as PersistenceClient;
  return {
    users: new PrismaUserRepository(persistenceClient),
    categories: new PrismaCategoryRepository(persistenceClient),
    budgets: new PrismaBudgetRepository(persistenceClient),
    transactions: new PrismaTransactionRepository(persistenceClient),
    accounts: new PrismaAccountRepository(persistenceClient),
    idempotency: new PrismaIdempotencyRepository(persistenceClient),
  };
}

function requiredUserId(context: TenantContext): string {
  const userId = context.userId.trim();
  if (!userId) throw new Error("Authenticated internal userId is required.");
  return userId;
}

function withoutOwnership(data: Record<string, unknown>): Record<string, unknown> {
  const { userId: _userId, id: _id, ...safe } = data;
  return safe;
}

function classifyIdempotency(record: unknown, input: BeginIdempotentMutation): IdempotencyBeginResult {
  const value = record as { method?: unknown; path?: unknown; bodyFingerprint?: unknown; state?: unknown };
  if (value.method !== input.method || value.path !== input.path || value.bodyFingerprint !== input.bodyFingerprint) {
    return { disposition: "conflict", record };
  }
  return { disposition: value.state === "COMPLETED" ? "replay" : "conflict", record };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
