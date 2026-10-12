import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { ApiService } from "./service.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { BearerGuard } from "./security.js";
import { RECONCILIATION_FEATURE, ReconciliationFeature } from "./reconciliation-feature.js";

@Controller("v1/reconciliations")
@UseGuards(BearerGuard, MutationIdempotencyGuard)
export class ReconciliationController {
  public constructor(@Inject(ApiService) private readonly api: ApiService, @Inject(RECONCILIATION_FEATURE) private readonly feature: ReconciliationFeature) {}
  @Get() public async list(@Req() request: Request) { return this.feature.list((await this.api.current(request.identity!)).id); }
  @Post(":pendingId/confirm") public confirm(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("pendingId") pendingId: string, @Body() body: Record<string, unknown>) { return this.mutate(request, key, pendingId, body, "confirmed"); }
  @Post(":pendingId/reject") public reject(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("pendingId") pendingId: string, @Body() body: Record<string, unknown>) { return this.mutate(request, key, pendingId, body, "rejected"); }
  private mutate(request: Request, key: string, pendingId: string, body: Record<string, unknown>, decision: "confirmed" | "rejected") { if (typeof body.postedTransactionId !== "string" || !body.postedTransactionId) throw new BadRequestException("postedTransactionId is required."); const fingerprint = createHash("sha256").update(`${request.method}\n${request.originalUrl}\n${JSON.stringify(body)}`).digest("hex"); return this.api.mutate(request.identity!, key, fingerprint, (user) => this.feature.decide(user.id, pendingId, body.postedTransactionId as string, decision)); }
}
