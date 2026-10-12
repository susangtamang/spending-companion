import { PrismaClient, Prisma } from "@prisma/client";
import type { EncryptedSecret } from "../../plaid/src/index.js";

import type {
  BankingStore,
  ClaimSyncJobsInput,
  ConsentInput,
  ExchangeInput,
  ProviderAccount,
  StoredItem,
  SyncJob,
  SyncMutation,
  TenantContext,
  VerifiedWebhookInput,
} from "./types.js";

export class PostgresBankingStore implements BankingStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async recordLinkSession(context: TenantContext, consent: ConsentInput, expiration: string): Promise<string> {
    const row = await this.prisma.plaidLinkSession.create({ data: {
      userId: userId(context),
      consentVersion: consent.consentVersion,
      consentedAt: new Date(consent.consentedAt),
      expiresAt: new Date(expiration),
    } });
    return row.id;
  }

  public consumeLinkAndCreateItem(
    context: TenantContext,
    input: ExchangeInput,
    providerItemId: string,
    token: EncryptedSecret,
    accounts: readonly ProviderAccount[],
  ): Promise<{ readonly itemId: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const owner = userId(context);
      const session = await transaction.plaidLinkSession.findFirst({ where: {
        id: input.linkSessionId, userId: owner, usedAt: null, expiresAt: { gt: new Date() },
      } });
      if (!session) throw new Error("Link session is missing, expired, used, or belongs to another user.");
      const item = await transaction.plaidItem.create({ data: {
        userId: owner,
        providerItemId,
        ...(input.institutionId === undefined ? {} : { institutionId: input.institutionId }),
        institutionName: input.institutionName,
        encryptedAccessToken: serializeSecret(token),
        keyVersion: token.keyVersion,
        health: "HEALTHY",
        consentVersion: session.consentVersion,
        consentedAt: session.consentedAt,
      } });
      if (accounts.length > 0) {
        await transaction.account.createMany({ data: accounts.map((account) => ({
          userId: owner,
          plaidItemId: item.id,
          providerAccountId: account.accountId,
          name: account.name,
          ...(account.officialName === undefined ? {} : { officialName: account.officialName }),
          ...(account.mask === undefined ? {} : { mask: account.mask }),
          type: account.type,
          ...(account.subtype === undefined ? {} : { subtype: account.subtype }),
          currencyCode: "USD",
        })) });
      }
      await transaction.plaidLinkSession.update({ where: { id: session.id }, data: { usedAt: new Date() } });
      return { itemId: item.id };
    });
  }

  public async getItem(context: TenantContext, itemId: string): Promise<StoredItem | null> {
    const item = await this.prisma.plaidItem.findFirst({ where: { id: itemId, userId: userId(context) } });
    return item ? mapItem(item) : null;
  }

  public async listItems(context: TenantContext): Promise<readonly StoredItem[]> {
    const rows = await this.prisma.plaidItem.findMany({ where: { userId: userId(context) }, orderBy: { createdAt: "desc" } });
    return rows.map(mapItem);
  }

  public async enqueueSync(context: TenantContext, itemId: string): Promise<SyncJob> {
    const owner = userId(context);
    const item = await this.prisma.plaidItem.findFirst({ where: { id: itemId, userId: owner, disconnectedAt: null } });
    if (!item) throw new Error("Bank connection not found or disconnected.");
    const job = await this.prisma.syncRun.create({ data: {
      plaidItemId: item.id,
      startingCursor: item.syncCursor,
      state: "QUEUED",
    } });
    return { id: job.id, itemId: item.id };
  }

  public claimSyncJobs(input: ClaimSyncJobsInput): Promise<readonly SyncJob[]> {
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
    const maxAttempts = Math.min(Math.max(Math.trunc(input.maxAttempts), 1), 20);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; plaid_item_id: string }>>(Prisma.sql`
        WITH candidates AS (
          SELECT id
          FROM sync_runs
          WHERE attempt_count < ${maxAttempts}
            AND (
              state IN ('QUEUED'::"SyncRunState", 'FAILED'::"SyncRunState")
              OR (state = 'RUNNING'::"SyncRunState" AND started_at < ${input.staleBefore})
            )
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE sync_runs AS run
        SET state = 'RUNNING'::"SyncRunState",
            started_at = ${input.claimedAt},
            attempt_count = run.attempt_count + 1,
            error_code = NULL,
            completed_at = NULL
        FROM candidates
        WHERE run.id = candidates.id
        RETURNING run.id, run.plaid_item_id
      `);
      return rows.map((row) => ({ id: row.id, itemId: row.plaid_item_id }));
    });
  }

  public async runSerializedSync<T>(
    job: SyncJob,
    operation: (item: StoredItem) => Promise<{ readonly mutation: SyncMutation; readonly value: T }>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", job.itemId);
        const run = await transaction.syncRun.findFirst({ where: { id: job.id, plaidItemId: job.itemId } });
        if (!run) throw new Error("Sync job not found.");
        if (run.state === "COMPLETED") return undefined as T;
        if (run.state !== "QUEUED" && run.state !== "FAILED" && run.state !== "RUNNING") {
          throw new Error("Sync job cannot be processed from its current state.");
        }
        const item = await transaction.plaidItem.findFirst({ where: { id: job.itemId, disconnectedAt: null } });
        if (!item) throw new Error("Bank connection not found or disconnected.");
        if (run.state !== "RUNNING") {
          await transaction.syncRun.update({ where: { id: run.id }, data: {
            state: "RUNNING", startedAt: new Date(), attemptCount: { increment: 1 }, errorCode: null,
          } });
        }
        await transaction.plaidItem.update({ where: { id: item.id }, data: { health: "SYNCING" } });
        const result = await operation(mapItem(item));
        await applyMutation(transaction, item.userId, item.id, result.mutation);
        await transaction.plaidItem.update({ where: { id: item.id }, data: {
          syncCursor: result.mutation.nextCursor,
          health: "HEALTHY",
          lastSuccessfulSyncAt: result.mutation.occurredAt,
        } });
        await transaction.syncRun.update({ where: { id: run.id }, data: {
          state: "COMPLETED",
          endingCursor: result.mutation.nextCursor,
          addedCount: result.mutation.added.length,
          modifiedCount: result.mutation.modified.length,
          removedCount: result.mutation.removed.length,
          completedAt: result.mutation.occurredAt,
        } });
        return result.value;
      }, { timeout: 60_000, maxWait: 10_000 });
    } catch (error) {
      await this.prisma.syncRun.updateMany({ where: { id: job.id, state: { not: "COMPLETED" } }, data: {
        state: "FAILED", errorCode: providerErrorCode(error), completedAt: new Date(),
      } });
      await this.prisma.plaidItem.updateMany({ where: { id: job.itemId, disconnectedAt: null }, data: { health: "ERROR" } });
      throw error;
    }
  }

  public async recordVerifiedWebhook(input: VerifiedWebhookInput): Promise<{ readonly duplicate: boolean; readonly job?: SyncJob }> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const item = input.providerItemId === undefined ? null : await transaction.plaidItem.findFirst({
          where: { providerItemId: input.providerItemId, disconnectedAt: null },
        });
        await transaction.webhookReceipt.create({ data: {
          dedupeHash: input.dedupeHash,
          ...(item === null ? {} : { plaidItemId: item.id }),
          webhookType: input.webhookType,
          webhookCode: input.webhookCode,
          payload: input.payload as Prisma.InputJsonValue,
          ...(input.verificationKeyId === undefined ? {} : { verificationKeyId: input.verificationKeyId }),
          receivedAt: input.receivedAt,
        } });
        if (item && input.connectionHealth !== undefined) {
          await transaction.plaidItem.update({
            where: { id: item.id },
            data: { health: input.connectionHealth },
          });
        }
        if (!item || input.webhookCode !== "SYNC_UPDATES_AVAILABLE") return { duplicate: false };
        const job = await transaction.syncRun.create({ data: {
          plaidItemId: item.id, startingCursor: item.syncCursor, state: "QUEUED",
        } });
        return { duplicate: false, job: { id: job.id, itemId: item.id } };
      });
    } catch (error) {
      if (isUniqueConflict(error)) return { duplicate: true };
      throw error;
    }
  }

  public async markItemHealth(
    context: TenantContext,
    itemId: string,
    health: StoredItem["health"],
    errorCode?: string,
  ): Promise<boolean> {
    const result = await this.prisma.plaidItem.updateMany({
      where: { id: itemId, userId: userId(context), disconnectedAt: null },
      data: { health, ...(errorCode === undefined ? {} : {}) },
    });
    return result.count === 1;
  }

  public async disconnectItem(
    context: TenantContext,
    itemId: string,
    policy: "retain" | "delete",
    removedAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const owner = userId(context);
      const item = await transaction.plaidItem.findFirst({ where: { id: itemId, userId: owner, disconnectedAt: null } });
      if (!item) return false;
      if (policy === "delete") {
        const accounts = await transaction.account.findMany({ where: { plaidItemId: item.id, userId: owner }, select: { id: true } });
        await transaction.transaction.deleteMany({ where: { userId: owner, accountId: { in: accounts.map(({ id }) => id) } } });
        await transaction.account.deleteMany({ where: { plaidItemId: item.id, userId: owner } });
      }
      await transaction.plaidItem.update({ where: { id: item.id }, data: {
        health: "DISCONNECTED",
        disconnectedAt: removedAt,
        disconnectHistoryPolicy: policy,
        encryptedAccessToken: new Uint8Array(0),
        tokenPurgedAt: removedAt,
      } });
      return true;
    });
  }
}

async function applyMutation(
  transaction: Prisma.TransactionClient,
  owner: string,
  itemId: string,
  mutation: SyncMutation,
): Promise<void> {
  const accounts = await transaction.account.findMany({ where: { userId: owner, plaidItemId: itemId } });
  const byProvider = new Map(accounts.map((account) => [account.providerAccountId, account]));
  for (const incoming of [...mutation.added, ...mutation.modified]) {
    const account = byProvider.get(incoming.providerAccountId);
    if (!account) throw new Error(`Plaid transaction references unknown account ${incoming.providerAccountId}.`);
    const data: Prisma.TransactionUncheckedCreateInput = {
      userId: owner,
      accountId: account.id,
      source: "PLAID" as const,
      sourceScope: account.id,
      sourceTransactionId: incoming.providerTransactionId,
      status: incoming.status,
      kind: incoming.kind,
      amountCents: incoming.amountCents,
      currencyCode: "USD",
      ...(incoming.rawMerchant === undefined ? {} : { rawMerchant: incoming.rawMerchant }),
      displayMerchant: incoming.displayMerchant,
      normalizedMerchant: incoming.normalizedMerchant,
      occurrenceDate: incoming.occurrenceDate,
      ...(incoming.postedDate === undefined ? {} : { postedDate: incoming.postedDate }),
      ...(incoming.pendingProviderTransactionId === undefined ? {} : { pendingSourceTransactionId: incoming.pendingProviderTransactionId }),
      sourceUpdatedAt: mutation.occurredAt,
    };
    const saved = await transaction.transaction.upsert({
      where: { userId_source_sourceScope_sourceTransactionId: {
        userId: owner, source: "PLAID", sourceScope: account.id, sourceTransactionId: incoming.providerTransactionId,
      } },
      create: { ...data, sourceCreatedAt: mutation.occurredAt },
      update: data,
    });
    await transaction.transactionAudit.create({ data: {
      transactionId: saved.id,
      action: "source_upserted",
      actor: "plaid_sync",
      after: incoming.raw as Prisma.InputJsonValue,
      createdAt: mutation.occurredAt,
    } });
    if (incoming.pendingProviderTransactionId) {
      const pending = await transaction.transaction.findFirst({ where: {
        userId: owner,
        accountId: account.id,
        source: "PLAID",
        sourceTransactionId: incoming.pendingProviderTransactionId,
        status: "PENDING",
      } });
      if (pending) {
        const replaced = await transaction.transaction.updateMany({
          where: { id: pending.id, userId: owner, accountId: account.id, reconciledToTransactionId: null },
          data: { status: "REMOVED", reconciledToTransactionId: saved.id, removedAt: mutation.occurredAt },
        });
        if (replaced.count === 1) await transaction.transactionAudit.create({ data: {
          transactionId: pending.id,
          action: "provider_reconciled",
          actor: "plaid_sync",
          after: { postedTransactionId: saved.id },
          createdAt: mutation.occurredAt,
        } });
      }
    }
  }
  for (const removed of mutation.removed) {
    await transaction.transaction.updateMany({ where: {
      userId: owner,
      source: "PLAID",
      sourceTransactionId: removed.transactionId,
      account: { plaidItemId: itemId },
    }, data: { status: "REMOVED", removedAt: mutation.occurredAt, sourceUpdatedAt: mutation.occurredAt } });
  }
}

function mapItem(item: {
  id: string; userId: string; providerItemId: string; encryptedAccessToken: Uint8Array;
  institutionId: string | null; institutionName: string; syncCursor: string | null; health: string;
  consentVersion: string; consentedAt: Date; disconnectedAt: Date | null; disconnectHistoryPolicy: string | null;
  lastSuccessfulSyncAt: Date | null; createdAt: Date; updatedAt: Date;
}): StoredItem {
  return {
    id: item.id,
    userId: item.userId,
    providerItemId: item.providerItemId,
    ...(item.institutionId === null ? {} : { institutionId: item.institutionId }),
    institutionName: item.institutionName,
    encryptedAccessToken: deserializeSecret(item.encryptedAccessToken),
    ...(item.syncCursor === null ? {} : { syncCursor: item.syncCursor }),
    health: item.health as StoredItem["health"],
    consentVersion: item.consentVersion,
    consentedAt: item.consentedAt,
    ...(item.disconnectedAt === null ? {} : { disconnectedAt: item.disconnectedAt }),
    ...(item.disconnectHistoryPolicy === "retain" || item.disconnectHistoryPolicy === "delete" ? { disconnectHistoryPolicy: item.disconnectHistoryPolicy } : {}),
    ...(item.lastSuccessfulSyncAt === null ? {} : { lastSuccessfulSyncAt: item.lastSuccessfulSyncAt }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function serializeSecret(secret: EncryptedSecret): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(JSON.stringify(secret)); }
function deserializeSecret(value: Uint8Array): EncryptedSecret { return JSON.parse(new TextDecoder().decode(value)) as EncryptedSecret; }
function userId(context: TenantContext): string {
  const value = context.userId.trim();
  if (!value) throw new Error("Authenticated internal userId is required.");
  return value;
}
function isUniqueConflict(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; }
function providerErrorCode(error: unknown): string { return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "SYNC_FAILED"; }
