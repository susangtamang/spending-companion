import { BadRequestException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class MutationIdempotencyGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const key = request.header("idempotency-key");
    if (!key || key.length < 16 || key.length > 128) throw new BadRequestException("Idempotency-Key must contain 16 to 128 characters.");
    return true;
  }
}
