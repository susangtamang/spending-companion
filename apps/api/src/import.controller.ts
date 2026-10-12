import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { ApiService } from "./service.js";
import { BearerGuard } from "./security.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { IMPORT_FEATURE, ImportFeature } from "./import-feature.js";

@Controller("v1/imports")
@UseGuards(BearerGuard, MutationIdempotencyGuard)
export class ImportController {
  public constructor(@Inject(ApiService) private readonly api: ApiService, @Inject(IMPORT_FEATURE) private readonly imports: ImportFeature) {}

  @Post("csv/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  public async preview(@Req() request: Request, @Headers("idempotency-key") key: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown>) {
    if (!file) throw new BadRequestException("CSV file is required.");
    const csv = file.buffer.toString("utf8");
    const digest = createHash("sha256").update(csv).digest("hex");
    return publicImport(await this.api.mutate(request.identity!, key, `POST\n/v1/imports/csv/preview\n${digest}`, (user) => this.imports.preview(user.id, file.originalname, csv, typeof body.financialAccountId === "string" ? body.financialAccountId : undefined, typeof body.institutionScope === "string" && body.institutionScope.trim() ? body.institutionScope.trim() : "device-csv")));
  }

  @Get()
  public async list(@Req() request: Request) { return this.imports.list((await this.api.current(request.identity!)).id); }
  @Get(":batchId")
  public async detail(@Req() request: Request, @Param("batchId") batchId: string) { return publicImport(await this.imports.detail((await this.api.current(request.identity!)).id, batchId)); }
  @Post("csv/commit")
  public commit(@Req() request: Request, @Headers("idempotency-key") key: string, @Body() body: Record<string, unknown>) { if (typeof body.previewId !== "string" || !body.previewId) throw new BadRequestException("previewId is required."); return this.api.mutate(request.identity!, key, requestFingerprint(request), (user) => this.imports.commit(user.id, body.previewId as string)); }
  @Post(":batchId/undo")
  public undo(@Req() request: Request, @Headers("idempotency-key") key: string, @Param("batchId") batchId: string) { return this.api.mutate(request.identity!, key, requestFingerprint(request), (user) => this.imports.undo(user.id, batchId)); }
}

function requestFingerprint(request: Request): string { return createHash("sha256").update(`${request.method}\n${request.originalUrl}\n${JSON.stringify(request.body ?? null)}`).digest("hex"); }
function publicImport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicImport);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "userId" && key !== "audit").map(([key, child]) => [key, publicImport(child)]));
}
