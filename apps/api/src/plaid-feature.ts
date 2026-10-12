import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { BankingService, BankingSyncWorker, PostgresBankingStore, normalizePlaidTransaction, type StoredItem } from "@spending-companion/banking";
import { LocalAes256GcmEncryption, PlaidNodeProvider, verifyPlaidWebhook } from "@spending-companion/plaid";

export const PLAID_FEATURE = Symbol("PLAID_FEATURE");

@Injectable()
export class PlaidFeature {
  private constructor(
    private readonly banking: BankingService | null,
    private readonly worker: BankingSyncWorker | null,
    private readonly prisma: PrismaClient | null,
    private readonly config: { clientName: string; webhookUrl: string; redirectUri?: string; androidPackageName?: string },
  ) {}

  public static fromEnvironment(env: NodeJS.ProcessEnv): PlaidFeature {
    const clientId = env.PLAID_CLIENT_ID?.trim();
    const secret = env.PLAID_SECRET?.trim();
    const keyText = env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();
    const databaseUrl = env.DATABASE_URL?.trim();
    const webhookUrl = env.PLAID_WEBHOOK_URL?.trim();
    if (!clientId || !secret || !keyText || !databaseUrl || !webhookUrl) {
      return new PlaidFeature(null, null, null, { clientName: "Spending Companion", webhookUrl: "" });
    }
    if (env.NODE_ENV === "production") throw new Error("Production Plaid requires a cloud KMS adapter; local AES keys are refused.");
    const key = Buffer.from(keyText, "base64");
    if (key.byteLength !== 32) throw new Error("PLAID_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    const provider = new PlaidNodeProvider({ clientId, secret, environment: env.PLAID_ENV === "production" ? "production" : "sandbox" });
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const store = new PostgresBankingStore(prisma);
    const banking = new BankingService({
      provider,
      store,
      encryption: new LocalAes256GcmEncryption(key),
      normalizeTransaction: normalizePlaidTransaction,
      linkRequest: (context, input) => ({ clientUserId: context.userId, clientName: input.clientName, webhookUrl: input.webhookUrl, ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}), ...(input.androidPackageName ? { androidPackageName: input.androidPackageName } : {}), daysRequested: 730 }),
      verifyWebhook: { verify: (rawBody, jwt) => verifyPlaidWebhook(rawBody, jwt, provider) },
    });
    const worker = new BankingSyncWorker(store, banking);
    return new PlaidFeature(banking, worker, prisma, {
      clientName: env.PLAID_CLIENT_NAME?.trim() || "Spending Companion",
      webhookUrl,
      ...(env.PLAID_REDIRECT_URI?.trim() ? { redirectUri: env.PLAID_REDIRECT_URI.trim() } : {}),
      ...(env.PLAID_ANDROID_PACKAGE_NAME?.trim() ? { androidPackageName: env.PLAID_ANDROID_PACKAGE_NAME.trim() } : {}),
    });
  }

  public required(): BankingService {
    if (!this.banking) throw new ServiceUnavailableException("Plaid is not configured on this server.");
    return this.banking;
  }
  public linkConfig() { return this.config; }
  private workerTimer: NodeJS.Timeout | undefined;
  private workerRun: Promise<unknown> | undefined;
  public onModuleInit(): void {
    if (!this.worker) return;
    this.workerTimer = setInterval(() => this.wakeWorker(), 15_000);
    this.workerTimer.unref();
    this.wakeWorker();
  }
  public wakeWorker(): void {
    if (!this.worker || this.workerRun) return;
    this.workerRun = this.worker.runOnce().catch(() => undefined).finally(() => { this.workerRun = undefined; });
  }
  public async onApplicationShutdown(): Promise<void> {
    if (this.workerTimer) clearInterval(this.workerTimer);
    await this.workerRun;
    await this.prisma?.$disconnect();
  }
}

export function publicConnection(item: StoredItem) {
  return {
    id: item.id,
    provider: "plaid" as const,
    ...(item.institutionId ? { institutionId: item.institutionId } : {}),
    institutionName: item.institutionName,
    health: item.health.toLowerCase(),
    consentedAt: item.consentedAt.toISOString(),
    consentVersion: item.consentVersion,
    ...(item.lastSuccessfulSyncAt ? { lastSuccessfulSyncAt: item.lastSuccessfulSyncAt.toISOString() } : {}),
    ...(item.disconnectedAt ? { disconnectedAt: item.disconnectedAt.toISOString() } : {}),
    ...(item.disconnectHistoryPolicy ? { disconnectHistoryPolicy: item.disconnectHistoryPolicy } : {}),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
