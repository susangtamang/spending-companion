import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { previewCsv, type CsvImportPreview } from "@spending-companion/imports";
import { randomUUID } from "node:crypto";

export const IMPORT_FEATURE = Symbol("IMPORT_FEATURE");

@Injectable()
export class ImportFeature {
  private constructor(private readonly prisma: PrismaClient | null) {}
  public static fromEnvironment(env: NodeJS.ProcessEnv): ImportFeature { return new ImportFeature(env.DATABASE_URL ? new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } }) : null); }
  private db(): PrismaClient { if (!this.prisma) throw new ServiceUnavailableException("CSV persistence requires DATABASE_URL."); return this.prisma; }
  public async onApplicationShutdown() { await this.prisma?.$disconnect(); }

  public async preview(userId: string, fileName: string, csv: string, financialAccountId?: string, importContext = "device-csv") {
    const db = this.db();
    if (!fileName.trim() || !csv.trim()) throw new BadRequestException("A non-empty CSV file is required.");
    if (financialAccountId && !await db.account.findFirst({ where: { id: financialAccountId, userId } })) throw new BadRequestException("financialAccountId is invalid.");
    const existing = await db.transaction.findMany({ where: { userId, source: "CSV", sourceTransactionId: { not: null } }, select: { sourceTransactionId: true, accountId: true, sourceScope: true } });
    const batchId = randomUUID();
    const now = new Date();
    const preview = previewCsv(csv, { userId, batchId, fileName, now: now.toISOString(), ...(financialAccountId ? { financialAccountId } : {}), importContext, transactionIdForRow: () => randomUUID(), existing: existing.map((row) => ({ userId, ...(row.accountId ? { financialAccountId: row.accountId } : {}), importContext: row.sourceScope.replace(/^csv:/, ""), sourceId: row.sourceTransactionId! })) });
    const expiresAt = new Date(now.valueOf() + 60 * 60 * 1000);
    await db.$transaction(async (tx) => {
      await tx.importBatch.create({ data: { id: batchId, userId, fileName, status: "PREVIEWED", formatVersion: "csv-v1", fingerprint: preview.fingerprint, importContext, expiresAt, totalRows: preview.batch.totalRows, duplicateRows: preview.batch.duplicateRows, invalidRows: preview.batch.invalidRows } });
      if (preview.rows.length) await tx.importRow.createMany({ data: preview.rows.map((row) => ({ batchId, rowNumber: row.rowNumber, sourceId: row.transaction?.sourceTransactionId ?? null, rawRecord: row as unknown as Prisma.InputJsonValue, state: row.disposition.toUpperCase() as "VALID" | "INVALID" | "DUPLICATE", errors: row.errors as unknown as Prisma.InputJsonValue })) });
    });
    return { id: batchId, expiresAt: expiresAt.toISOString(), rows: preview.rows };
  }

  public async commit(userId: string, batchId: string) {
    return this.db().$transaction(async (tx) => {
      const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
      if (!batch) throw new NotFoundException();
      if (batch.status === "COMMITTED") return batchDto(batch);
      if (batch.status !== "PREVIEWED") throw new ConflictException("Import cannot be committed in its current state.");
      if (batch.expiresAt <= new Date()) throw new ConflictException("Import preview expired; preview the file again.");
      let importedRows = 0;
      for (const row of batch.rows) {
        if (row.state !== "VALID") continue;
        const previewRow = row.rawRecord as unknown as CsvImportPreview["rows"][number];
        const value = previewRow.transaction;
        if (!value) throw new Error("Valid import row has no transaction plan.");
        const saved = await tx.transaction.create({ data: { id: value.id, userId, accountId: value.financialAccountId ?? null, source: "CSV", sourceScope: value.financialAccountId ?? `csv:${batch.importContext}`, sourceTransactionId: value.sourceTransactionId ?? null, status: value.status.toUpperCase() as "PENDING" | "POSTED", kind: value.kind.toUpperCase() as "PURCHASE" | "REFUND" | "PAYMENT" | "TRANSFER" | "CASH", amountCents: BigInt(value.amountCents), currencyCode: "USD", rawMerchant: value.rawMerchant ?? null, displayMerchant: value.displayMerchant, normalizedMerchant: value.normalizedMerchant, occurrenceDate: new Date(`${value.occurrenceDate}T00:00:00.000Z`), postedDate: value.postedDate ? new Date(`${value.postedDate}T00:00:00.000Z`) : null, sourceCreatedAt: new Date(value.createdAt), sourceUpdatedAt: new Date(value.updatedAt) } });
        await tx.importRow.update({ where: { id: row.id }, data: { state: "IMPORTED", transactionId: saved.id } });
        importedRows += 1;
      }
      const updated = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", importedRows, committedAt: new Date() } });
      return batchDto(updated);
    });
  }

  public async list(userId: string) { const rows = await this.db().importBatch.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }); return { data: rows.map(batchDto) }; }
  public async detail(userId: string, batchId: string) { const batch = await this.db().importBatch.findFirst({ where: { id: batchId, userId }, include: { rows: { orderBy: { rowNumber: "asc" } } } }); if (!batch) throw new NotFoundException(); return { ...batchDto(batch), rows: batch.rows.map((row) => row.rawRecord) }; }
  public async undo(userId: string, batchId: string) { return this.db().$transaction(async (tx) => { const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId }, include: { rows: true } }); if (!batch) throw new NotFoundException(); if (batch.status === "UNDONE") return batchDto(batch); if (batch.status !== "COMMITTED") throw new ConflictException("Only a committed import can be undone."); const ids = batch.rows.flatMap((row) => row.transactionId ? [row.transactionId] : []); await tx.transaction.deleteMany({ where: { id: { in: ids }, userId, source: "CSV" } }); const updated = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "UNDONE", undoneAt: new Date() } }); return batchDto(updated); }); }
}

function batchDto(row: { id: string; fileName: string; status: string; totalRows: number; importedRows: number; duplicateRows: number; invalidRows: number; createdAt: Date; committedAt: Date | null; undoneAt: Date | null }) { return { id: row.id, fileName: row.fileName, status: row.status.toLowerCase(), totalRows: row.totalRows, importedRows: row.importedRows, duplicateRows: row.duplicateRows, invalidRows: row.invalidRows, createdAt: row.createdAt.toISOString(), ...(row.committedAt ? { committedAt: row.committedAt.toISOString() } : {}), ...(row.undoneAt ? { undoneAt: row.undoneAt.toISOString() } : {}) }; }
