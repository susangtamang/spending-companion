import { BadRequestException, Body, Controller, Get, Headers, Inject, NotFoundException, Param, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { AUTH_PORT, type AuthPort } from "./ports.js";
import { ApiService } from "./service.js";
import { BearerGuard } from "./security.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { PLAID_FEATURE, PlaidFeature } from "./plaid-feature.js";
import { PRIVACY_FEATURE, PrivacyFeature } from "./privacy-feature.js";

@Controller("v1")
@UseGuards(BearerGuard, MutationIdempotencyGuard)
export class PrivacyController {
  public constructor(@Inject(ApiService) private readonly api: ApiService, @Inject(AUTH_PORT) private readonly auth: AuthPort, @Inject(PLAID_FEATURE) private readonly plaid: PlaidFeature, @Inject(PRIVACY_FEATURE) private readonly privacy: PrivacyFeature) {}
  @Post("exports") public createExport(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { if (body.format !== "json" && body.format !== "csv") throw new BadRequestException("format must be json or csv."); return this.api.mutate(request.identity!, key, fingerprint(request), (user) => this.privacy.createExport(user.id, body.format as "json"|"csv")); }
  @Get("exports/:id/download") public async download(@Req() request: Request, @Param("id") id: string, @Res() response: Response) { const user = await this.api.current(request.identity!); const result = await this.privacy.exportPayload(user.id, id); if (result.format === "csv") return response.type("text/csv").attachment("spending-companion-export.csv").send(toCsv(result.payload)); return response.type("application/json").attachment("spending-companion-export.json").send(JSON.stringify(result.payload, null, 2)); }
  @Get("exports/:id") public async exportStatus(@Req() request: Request, @Param("id") id: string) { return this.privacy.exportStatus((await this.api.current(request.identity!)).id, id); }
  @Post("me/deletion") public async deleteAccount(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) {
    if (body.confirmation !== "DELETE" || typeof body.reauthenticationToken !== "string") throw new BadRequestException("Type DELETE and reauthenticate to continue.");
    let verified; try { verified = await this.auth.verify(body.reauthenticationToken); } catch { throw new UnauthorizedException("Reauthentication failed."); }
    if (verified.issuer !== request.identity!.issuer || verified.subject !== request.identity!.subject) throw new UnauthorizedException("Reauthentication identity does not match.");
    if (verified.issuedAt !== undefined && (verified.issuedAt > Math.floor(Date.now() / 1000) + 30 || Date.now() / 1000 - verified.issuedAt > 10 * 60)) throw new UnauthorizedException("Reauthentication is no longer fresh.");
    try { const prior = await this.privacy.deletionStatus(request.identity!); if (prior.status === "completed") return prior; } catch (error) { if (!(error instanceof NotFoundException)) throw error; }
    const user = await this.api.current(request.identity!);
    const started = await this.privacy.beginDeletion(user.id, request.identity!, key);
    try { for (const itemId of started.itemIds) await this.plaid.required().disconnect({ userId: user.id }, itemId, "delete"); }
    catch { return this.privacy.blockDeletion(user.id, started.jobId, "PLAID_ITEM_REMOVE_FAILED"); }
    return this.privacy.finishDeletion(user.id, started.jobId, started.identityHash, started.requestedAt);
  }
  @Get("me/deletion") public deletionStatus(@Req() request: Request) { return this.privacy.deletionStatus(request.identity!); }
}

function fingerprint(request: Request) { return createHash("sha256").update(`${request.method}\n${request.originalUrl}\n${JSON.stringify(request.body ?? null)}`).digest("hex"); }
function toCsv(payload: unknown): string { const transactions = (payload as { transactions?: Record<string, unknown>[] }).transactions ?? []; const fields = ["id","source","status","kind","amountCents","currencyCode","displayMerchant","occurrenceDate","postedDate"]; return `${fields.join(",")}\n${transactions.map((row) => fields.map((field) => quote(row[field])).join(",")).join("\n")}`; }
function quote(value: unknown): string { const text = value === null || value === undefined ? "" : String(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; }
