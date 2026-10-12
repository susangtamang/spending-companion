import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Identity } from "./ports.js";
import { identityHash } from "./postgres.js";

export const PRIVACY_FEATURE = Symbol("PRIVACY_FEATURE");

@Injectable()
export class PrivacyFeature {
  private constructor(private readonly prisma: PrismaClient | null) {}
  public static fromEnvironment(env: NodeJS.ProcessEnv) { return new PrivacyFeature(env.DATABASE_URL ? new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } }) : null); }
  private db() { if (!this.prisma) throw new ServiceUnavailableException("Privacy operations require DATABASE_URL."); return this.prisma; }
  public async onApplicationShutdown() { await this.prisma?.$disconnect(); }

  public async createExport(userId: string, format: "json" | "csv") {
    const db = this.db();
    const [user, categories, budgets, connections, accounts, transactions, imports] = await Promise.all([
      db.user.findFirstOrThrow({ where: { id: userId }, select: { id: true, email: true, displayName: true, timezone: true, currencyCode: true, createdAt: true, updatedAt: true } }),
      db.category.findMany({ where: { userId } }), db.budget.findMany({ where: { userId } }), db.plaidItem.findMany({ where: { userId }, select: { id: true, institutionId: true, institutionName: true, health: true, consentedAt: true, lastSuccessfulSyncAt: true, disconnectedAt: true, disconnectHistoryPolicy: true, createdAt: true, updatedAt: true } }),
      db.account.findMany({ where: { userId }, select: { id: true, plaidItemId: true, name: true, officialName: true, mask: true, type: true, subtype: true, includeInSpending: true, currencyCode: true, createdAt: true, updatedAt: true } }),
      db.transaction.findMany({ where: { userId }, include: { override: true } }), db.importBatch.findMany({ where: { userId }, include: { rows: true } }),
    ]);
    const payload = jsonSafe({ exportedAt: new Date(), user, categories, budgets, connections, accounts, transactions, imports });
    const now = new Date(); const expiresAt = new Date(now.valueOf() + 24 * 60 * 60 * 1000);
    const job = await db.exportJob.create({ data: { userId, format, state: "READY", payload: payload as Prisma.InputJsonValue, readyAt: now, expiresAt } });
    return exportDto(job);
  }
  public async exportStatus(userId: string, id: string) { const job = await this.db().exportJob.findFirst({ where: { id, userId } }); if (!job) throw new NotFoundException(); return exportDto(job); }
  public async exportPayload(userId: string, id: string) { const job = await this.db().exportJob.findFirst({ where: { id, userId, state: "READY", expiresAt: { gt: new Date() } } }); if (!job) throw new NotFoundException(); return { format: job.format, payload: job.payload }; }

  public async beginDeletion(userId: string, identity: Identity, key: string) { const now = new Date(); return this.db().$transaction(async (tx) => { await tx.user.update({ where: { id: userId }, data: { state: "DELETING", deletingAt: now } }); const prior = await tx.deletionJob.findFirst({ where: { userId }, orderBy: { requestedAt: "desc" } }); const job = prior ? await tx.deletionJob.update({ where: { id: prior.id }, data: { state: "PROCESSING", processingStartedAt: now, blockedAt: null, failedAt: null, failureCode: null, retryCount: { increment: 1 } } }) : await tx.deletionJob.create({ data: { userId, idempotencyKey: key, state: "PROCESSING", processingStartedAt: now } }); const items = await tx.plaidItem.findMany({ where: { userId, disconnectedAt: null }, select: { id: true } }); return { jobId: job.id, itemIds: items.map((item) => item.id), identityHash: identityHash(identity), requestedAt: job.requestedAt }; }); }
  public async blockDeletion(userId: string, jobId: string, code: string) { const job = await this.db().deletionJob.update({ where: { id: jobId, userId }, data: { state: "BLOCKED", blockedAt: new Date(), failureCode: code } }); return deletionDto(job); }
  public async finishDeletion(userId: string, jobId: string, hash: string, requestedAt: Date) { const completedAt = new Date(); await this.db().$transaction(async (tx) => { await tx.deletionTombstone.create({ data: { operationId: jobId, state: "COMPLETED", identityHash: hash, requestedAt, completedAt, expiresAt: new Date(completedAt.valueOf() + 7 * 365 * 24 * 60 * 60 * 1000) } }); await tx.user.delete({ where: { id: userId } }); }); return { id: jobId, status: "completed", requestedAt: requestedAt.toISOString(), updatedAt: completedAt.toISOString(), completedAt: completedAt.toISOString() }; }
  public async deletionStatus(identity: Identity) { const hash = identityHash(identity); const tombstone = await this.db().deletionTombstone.findUnique({ where: { identityHash: hash } }); if (tombstone) return { id: tombstone.operationId, status: "completed", requestedAt: tombstone.requestedAt.toISOString(), updatedAt: tombstone.completedAt.toISOString(), completedAt: tombstone.completedAt.toISOString() }; const user = await this.db().user.findFirst({ where: { issuer: identity.issuer, subject: identity.subject }, include: { deletionJobs: { orderBy: { requestedAt: "desc" }, take: 1 } } }); const job = user?.deletionJobs[0]; if (!job) throw new NotFoundException(); return deletionDto(job); }
}

function exportDto(job: { id: string; state: string; format: string; createdAt: Date; expiresAt: Date }) { return { id: job.id, status: job.state.toLowerCase(), format: job.format, downloadUrl: `/v1/exports/${job.id}/download`, expiresAt: job.expiresAt.toISOString(), createdAt: job.createdAt.toISOString() }; }
function deletionDto(job: { id: string; state: string; requestedAt: Date; processingStartedAt: Date | null; blockedAt: Date | null; failedAt: Date | null; failureCode: string | null }) { const updated = job.failedAt ?? job.blockedAt ?? job.processingStartedAt ?? job.requestedAt; return { id: job.id, status: job.state.toLowerCase(), requestedAt: job.requestedAt.toISOString(), updatedAt: updated.toISOString(), ...(job.failureCode ? { failureCode: job.failureCode, retryable: true } : {}) }; }
function jsonSafe(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)); }
