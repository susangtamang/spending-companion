import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { BearerGuard } from "./security.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { ApiService } from "./service.js";
import { PLAID_FEATURE, PlaidFeature, publicConnection } from "./plaid-feature.js";

@Controller("v1/plaid")
@UseGuards(BearerGuard, MutationIdempotencyGuard)
export class PlaidController {
  public constructor(@Inject(ApiService) private readonly api: ApiService, @Inject(PLAID_FEATURE) private readonly feature: PlaidFeature) {}

  @Post("link-token")
  public linkToken(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) {
    return this.mutation(request, key, async (userId) => {
      if (body.consentAccepted !== true || typeof body.consentVersion !== "string" || !body.consentVersion.trim()) throw new BadRequestException("Financial-data consent is required.");
      const config = this.feature.linkConfig();
      return this.feature.required().createLinkToken({ userId }, { ...config, consentVersion: body.consentVersion.trim(), consentedAt: new Date().toISOString(), ...(typeof body.redirectUri === "string" ? { redirectUri: body.redirectUri } : {}) });
    });
  }

  @Post("exchange")
  public exchange(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) {
    return this.mutation(request, key, async (userId) => {
      const publicToken = requiredString(body.publicToken, "publicToken");
      const linkSessionId = requiredString(body.linkSessionId, "linkSessionId");
      const institutionName = requiredString(body.institutionName, "institutionName");
      const banking = this.feature.required();
      const result = await banking.exchange({ userId }, { publicToken, linkSessionId, institutionName, ...(typeof body.institutionId === "string" && body.institutionId ? { institutionId: body.institutionId } : {}) });
      await banking.enqueueSync({ userId }, result.itemId);
      this.feature.wakeWorker();
      return publicConnection(await banking.getItem({ userId }, result.itemId));
    });
  }

  @Get("items")
  public async items(@Req() request: Request) {
    const user = await this.api.current(request.identity!);
    return (await this.feature.required().listItems({ userId: user.id })).map(publicConnection);
  }

  @Post("items/:id/update-link-token")
  public update(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("id") itemId: string) {
    return this.mutation(request, key, async (userId) => this.feature.required().createUpdateLinkToken({ userId }, itemId, { clientUserId: userId, ...this.feature.linkConfig() }));
  }

  @Post("items/:id/sync")
  public sync(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("id") itemId: string) {
    return this.mutation(request, key, async (userId) => {
      const banking = this.feature.required();
      const job = await banking.enqueueSync({ userId }, itemId);
      this.feature.wakeWorker();
      return { id: job.id, status: "queued", createdAt: new Date().toISOString() };
    });
  }

  @Delete("items/:id")
  public remove(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("id") itemId: string, @Query("transactionHistory") history: string) {
    return this.mutation(request, key, async (userId) => {
      if (history !== "retain" && history !== "delete") throw new BadRequestException("transactionHistory must be retain or delete.");
      const banking = this.feature.required();
      if (!await banking.disconnect({ userId }, itemId, history)) throw new NotFoundException();
      return publicConnection(await banking.getItem({ userId }, itemId));
    });
  }

  private async mutation<T>(request: Request, key: string, work: (userId: string) => Promise<T>): Promise<T> {
    return this.api.mutate(request.identity!, key, fingerprint(request), (user) => work(user.id));
  }
}

@Controller("v1/webhooks")
export class PlaidWebhookController {
  public constructor(@Inject(PLAID_FEATURE) private readonly feature: PlaidFeature) {}
  @Post("plaid")
  public async accept(@Req() request: Request & { rawBody?: Buffer }, @Headers("plaid-verification") verification: string | undefined) {
    if (!request.rawBody) throw new BadRequestException("Raw webhook body is required.");
    try {
      const banking = this.feature.required();
      const accepted = await banking.acceptWebhook(request.rawBody, verification);
      if (accepted.job) this.feature.wakeWorker();
      return { duplicate: accepted.duplicate };
    }
    catch (error) { if (error instanceof BadRequestException) throw error; throw new UnauthorizedException("Plaid webhook verification failed."); }
  }
}

function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required.`); return value.trim(); }
function fingerprint(request: Request): string { return createHash("sha256").update(`${request.method}\n${request.originalUrl}\n${stableJson(request.body ?? null)}`).digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }
