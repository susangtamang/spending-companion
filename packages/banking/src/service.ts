import { createHash } from "node:crypto";

import { fetchCompleteSync, type SecretEncryptionPort } from "../../plaid/src/index.js";

import type {
  BankingPlaidProvider,
  BankingStore,
  CreateLinkInput,
  CreatedLink,
  ExchangeInput,
  LinkRequestFactory,
  SyncNormalization,
  TenantContext,
  WebhookVerifier,
} from "./types.js";

export interface BankingServiceDependencies {
  readonly provider: BankingPlaidProvider;
  readonly encryption: SecretEncryptionPort;
  readonly store: BankingStore;
  readonly verifyWebhook: WebhookVerifier;
  readonly normalizeTransaction: SyncNormalization;
  readonly linkRequest: LinkRequestFactory;
  readonly now?: () => Date;
}

export class BankingService {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: BankingServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async createLinkToken(context: TenantContext, input: CreateLinkInput): Promise<CreatedLink> {
    requireContext(context);
    if (!input.consentVersion.trim()) throw new Error("consentVersion is required.");
    const token = await this.dependencies.provider.createTransactionsLinkToken(
      this.dependencies.linkRequest(context, input),
    );
    const linkSessionId = await this.dependencies.store.recordLinkSession(context, input, token.expiration);
    return { ...token, linkSessionId };
  }

  public async exchange(context: TenantContext, input: ExchangeInput): Promise<{ readonly itemId: string }> {
    requireContext(context);
    const exchanged = await this.dependencies.provider.exchangePublicToken(input.publicToken);
    const accounts = await this.dependencies.provider.getAccounts(exchanged.accessToken);
    for (const account of accounts) {
      if (account.isoCurrencyCode !== undefined && account.isoCurrencyCode !== "USD") {
        throw new Error(`Account ${account.accountId} is not USD and cannot be connected in Version 1.`);
      }
    }
    const encrypted = await this.dependencies.encryption.encrypt(exchanged.accessToken, {
      userId: context.userId,
      providerItemId: exchanged.itemId,
    });
    return this.dependencies.store.consumeLinkAndCreateItem(
      context, input, exchanged.itemId, encrypted, accounts,
    );
  }

  public async createUpdateLinkToken(
    context: TenantContext,
    itemId: string,
    request: Omit<ReturnType<LinkRequestFactory>, "daysRequested">,
  ): Promise<{ readonly linkToken: string; readonly expiration: string }> {
    const item = await this.requiredItem(context, itemId);
    const accessToken = await this.decrypt(item);
    return this.dependencies.provider.createUpdateLinkToken(request, accessToken);
  }

  public async enqueueSync(context: TenantContext, itemId: string) {
    await this.requiredItem(context, itemId);
    return this.dependencies.store.enqueueSync(context, itemId);
  }

  public async listItems(context: TenantContext) {
    requireContext(context);
    return this.dependencies.store.listItems(context);
  }

  public async getItem(context: TenantContext, itemId: string) {
    return this.requiredItem(context, itemId);
  }

  public async processSyncJob(job: { readonly id: string; readonly itemId: string }): Promise<void> {
    await this.dependencies.store.runSerializedSync(job, async (item) => {
      const accessToken = await this.decrypt(item);
      const plan = await fetchCompleteSync(this.dependencies.provider, accessToken, item.syncCursor);
      const occurredAt = this.now();
      return {
        mutation: {
          added: plan.added.map(this.dependencies.normalizeTransaction),
          modified: plan.modified.map(this.dependencies.normalizeTransaction),
          removed: plan.removed,
          nextCursor: plan.nextCursor,
          occurredAt,
        },
        value: undefined,
      };
    });
  }

  public async acceptWebhook(rawBody: Uint8Array | string, verificationJwt: string | undefined): Promise<{ duplicate: boolean; job?: { readonly id: string; readonly itemId: string } }> {
    const verified = await this.dependencies.verifyWebhook.verify(rawBody, verificationJwt);
    if (!isRecord(verified.body)) throw new Error("Plaid webhook body must be an object.");
    const webhookType = stringField(verified.body, "webhook_type");
    const webhookCode = stringField(verified.body, "webhook_code");
    const providerItemId = optionalStringField(verified.body, "item_id");
    const health = webhookHealth(webhookType, webhookCode, verified.body);
    const bytes = typeof rawBody === "string" ? Buffer.from(rawBody) : Buffer.from(rawBody);
    const dedupeHash = createHash("sha256").update(bytes).digest("hex");
    return this.dependencies.store.recordVerifiedWebhook({
      dedupeHash,
      ...(providerItemId === undefined ? {} : { providerItemId }),
      webhookType,
      webhookCode,
      payload: verified.body,
      ...(verified.keyId === undefined ? {} : { verificationKeyId: verified.keyId }),
      receivedAt: this.now(),
      ...(health === undefined ? {} : health),
    });
  }

  public async markReconnected(context: TenantContext, itemId: string): Promise<boolean> {
    await this.requiredItem(context, itemId);
    return this.dependencies.store.markItemHealth(context, itemId, "HEALTHY");
  }

  public async disconnect(
    context: TenantContext,
    itemId: string,
    historyPolicy: "retain" | "delete",
  ): Promise<boolean> {
    const item = await this.requiredItem(context, itemId);
    const accessToken = await this.decrypt(item);
    await this.dependencies.provider.removeItem(accessToken);
    return this.dependencies.store.disconnectItem(context, itemId, historyPolicy, this.now());
  }

  private async requiredItem(context: TenantContext, itemId: string) {
    requireContext(context);
    const item = await this.dependencies.store.getItem(context, itemId);
    if (!item) throw new Error("Bank connection not found.");
    return item;
  }

  private decrypt(item: Awaited<ReturnType<BankingStore["getItem"]>> & {}) {
    return this.dependencies.encryption.decrypt(item.encryptedAccessToken, {
      userId: item.userId,
      providerItemId: item.providerItemId,
    });
  }
}

function webhookHealth(
  webhookType: string,
  webhookCode: string,
  body: Readonly<Record<string, unknown>>,
): { connectionHealth: "REQUIRES_UPDATE" | "ERROR"; connectionErrorCode?: string } | undefined {
  if (webhookType !== "ITEM") return undefined;
  const errorValue = body.error;
  const errorCode = isRecord(errorValue) ? optionalStringField(errorValue, "error_code") : undefined;
  if (webhookCode === "PENDING_EXPIRATION" || webhookCode === "USER_PERMISSION_REVOKED" || errorCode === "ITEM_LOGIN_REQUIRED") {
    return {
      connectionHealth: "REQUIRES_UPDATE",
      ...(errorCode === undefined ? {} : { connectionErrorCode: errorCode }),
    };
  }
  if (webhookCode === "ERROR") {
    return { connectionHealth: "ERROR", ...(errorCode === undefined ? {} : { connectionErrorCode: errorCode }) };
  }
  return undefined;
}

function requireContext(context: TenantContext): void {
  if (!context.userId.trim()) throw new Error("Authenticated internal userId is required.");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field) throw new Error(`Plaid webhook ${key} is required.`);
  return field;
}

function optionalStringField(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}
