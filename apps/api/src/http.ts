import { BadRequestException, Catch, type ArgumentsHost, type ExceptionFilter, HttpException, Injectable, type NestMiddleware, type PipeTransform } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { DomainValidationError } from "@spending-companion/domain";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  public use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header("x-request-id");
    request.requestId = supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  }
}

@Injectable()
export class SanitizingValidationPipe implements PipeTransform {
  public transform(value: unknown): unknown {
    if (value && typeof value === "object") rejectUnsafeKeys(value);
    return value;
  }
}

function rejectUnsafeKeys(value: object): void {
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new BadRequestException("Unsafe request field.");
    if (child && typeof child === "object") rejectUnsafeKeys(child);
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  public catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : error instanceof DomainValidationError ? 400 : 500;
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    const message = error instanceof DomainValidationError ? error.message : typeof body === "string" ? body : isMessageBody(body) ? body.message : status === 500 ? "Internal server error." : "Request failed.";
    response.status(status).json({ code: codeFor(status), message: Array.isArray(message) ? message.join("; ") : message, requestId: request.requestId ?? "unknown" });
  }
}

function isMessageBody(value: unknown): value is { message: string | string[] } { return !!value && typeof value === "object" && "message" in value; }
function codeFor(status: number): string { return ({ 400: "validation_failed", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 501: "not_configured", 503: "service_unavailable" } as Record<number, string>)[status] ?? "internal_error"; }
