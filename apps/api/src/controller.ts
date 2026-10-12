import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { BearerGuard } from "./security.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { ApiService } from "./service.js";
import type { UserProfile } from "./ports.js";
import { createHash } from "node:crypto";

@Controller()
export class HealthController {
  @Get("health") public health(): object { return { status: "ok", timestamp: new Date().toISOString() }; }
}

@Controller("v1")
@UseGuards(BearerGuard, MutationIdempotencyGuard)
export class ApiController {
  public constructor(@Inject(ApiService) private readonly service: ApiService) {}
  private user(request: Request): Promise<UserProfile> { return this.service.current(request.identity!); }
  private async mutation<T>(request: Request, key: string, work: (user: UserProfile) => Promise<T>): Promise<T> { return this.service.mutate(request.identity!, key, requestFingerprint(request), work); }

  @Get("me") public async me(@Req() request: Request) { return publicUser(await this.user(request)); }
  @Patch("me") public async patchMe(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { return publicUser(await this.mutation(request, key, (u) => this.service.updateUser(u, body))); }

  @Get("categories") public async categories(@Req() request: Request) { return (await this.service.categories((await this.user(request)).id)).map(publicOwned); }
  @Post("categories") public async createCategory(@Req() req: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { return publicOwned(await this.mutation(req, key, (u) => this.service.createCategory(u.id, body))); }
  @Patch("categories/:id") public async patchCategory(@Req() req: Request, @Headers("idempotency-key") key: string, @Param("id") id: string, @Body() body: Record<string, unknown>) { return publicOwned(await this.mutation(req, key, (u) => this.service.updateCategory(u.id, id, body))); }
  @Delete("categories/:id") public async archiveCategory(@Req() req: Request, @Res() res: Response, @Headers("idempotency-key") key: string, @Param("id") id: string) { await this.mutation(req, key, async (u) => { await this.service.archiveCategory(u.id, id); return null; }); res.status(204).send(); }

  @Get("budgets") public async budgets(@Req() req: Request, @Query("month") month?: string) { return (await this.service.budgets((await this.user(req)).id, month)).map(publicOwned); }
  @Post("budgets") public async createBudget(@Req() req: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { return publicOwned(await this.mutation(req, key, (u) => this.service.saveBudget(u.id, body))); }
  @Patch("budgets/:id") public async patchBudget(@Req() req: Request, @Headers("idempotency-key") key: string, @Param("id") id: string, @Body() body: Record<string, unknown>) { return publicOwned(await this.mutation(req, key, (u) => this.service.saveBudget(u.id, body, id))); }
  @Delete("budgets/:id") public async deleteBudget(@Req() req: Request, @Res() res: Response, @Headers("idempotency-key") key: string, @Param("id") id: string) { await this.mutation(req, key, async (u) => { await this.service.deleteBudget(u.id, id); return null; }); res.status(204).send(); }

  @Get("transactions") public async transactions(@Req() req: Request, @Query() query: Record<string, unknown>) { const page = await this.service.transactions((await this.user(req)).id, query); return { ...page, data: page.data.map(publicTransaction) }; }
  @Post("transactions") public async createTransaction(@Req() req: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { return publicTransaction(await this.mutation(req, key, (u) => this.service.createTransaction(u.id, body))); }
  @Get("transactions/:id") public async transaction(@Req() req: Request, @Param("id") id: string) { return publicTransaction(await this.service.transaction((await this.user(req)).id, id)); }
  @Patch("transactions/:id") public async patchTransaction(@Req() req: Request, @Headers("idempotency-key") key: string, @Param("id") id: string, @Body() body: Record<string, unknown>) { return publicTransaction(await this.mutation(req, key, (u) => this.service.updateTransaction(u.id, id, body))); }
  @Delete("transactions/:id") public async deleteTransaction(@Req() req: Request, @Res() res: Response, @Headers("idempotency-key") key: string, @Param("id") id: string) { await this.mutation(req, key, async (u) => { await this.service.deleteTransaction(u.id, id); return null; }); res.status(204).send(); }

  @Get("accounts") public async accounts(@Req() req: Request) { return (await this.service.accounts((await this.user(req)).id)).map(publicAccount); }
  @Patch("accounts/:id") public async patchAccount(@Req() req: Request, @Headers("idempotency-key") key: string, @Param("id") id: string, @Body() body: Record<string, unknown>) { return publicAccount(await this.mutation(req, key, (u) => this.service.updateAccount(u.id, id, body))); }

  @Get("summaries/monthly") public async summary(@Req() req: Request, @Query("month") month: string, @Query("budgetMode") mode = "including_utilities") { return this.service.summary(await this.user(req), month, mode); }
  @Get("summaries/monthly/categories") public async categorySummary(@Req() req: Request, @Query("month") month: string, @Query("budgetMode") mode = "including_utilities") { return (await this.service.summary(await this.user(req), month, mode)).categoryBreakdown; }
  @Get("summaries/monthly/merchants") public async merchantSummary(@Req() req: Request, @Query("month") month: string, @Query("budgetMode") mode = "including_utilities") { return (await this.service.summary(await this.user(req), month, mode)).merchantBreakdown; }
}

function publicUser(user: UserProfile): object { const { identityProviderSubject: _secret, ...safe } = user; return safe; }
function publicOwned<T extends { readonly userId?: unknown }>(value: T): Omit<T, "userId"> { const { userId: _owner, ...safe } = value; return safe; }
function publicTransaction<T extends { readonly userId?: unknown; readonly audit?: unknown }>(value: T): Omit<T, "userId" | "audit"> { const { userId: _owner, audit: _audit, ...safe } = value; return safe; }
function publicAccount<T extends { readonly userId?: unknown; readonly sourceAccountId?: unknown }>(value: T): Omit<T, "userId" | "sourceAccountId"> { const { userId: _owner, sourceAccountId: _providerId, ...safe } = value; return safe; }
function requestFingerprint(request: Request): string { const canonical = `${request.method}\n${request.originalUrl}\n${stableJson(request.body ?? null)}`; return createHash("sha256").update(canonical).digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }
