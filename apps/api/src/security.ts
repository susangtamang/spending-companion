import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AUTH_PORT, type AuthPort } from "./ports.js";

@Injectable()
export class BearerGuard implements CanActivate {
  public constructor(@Inject(AUTH_PORT) private readonly auth: AuthPort) {}
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.length <= 7) throw new UnauthorizedException("A valid bearer token is required.");
    try { request.identity = await this.auth.verify(header.slice(7)); return true; }
    catch { throw new UnauthorizedException("The bearer token is invalid or expired."); }
  }
}
