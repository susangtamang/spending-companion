import { ClerkSessionTokenVerifier, SessionVerificationBoundary } from "@spending-companion/auth";
import type { AuthPort, Identity } from "./ports.js";

export class ClerkAuthPort implements AuthPort {
  private readonly boundary: SessionVerificationBoundary;
  public constructor(environment: NodeJS.ProcessEnv) {
    const issuer = required(environment, "CLERK_ISSUER");
    const jwtKey = environment.CLERK_JWT_KEY;
    const secretKey = environment.CLERK_SECRET_KEY;
    if (!jwtKey && !secretKey) throw new Error("Authentication is not configured: CLERK_JWT_KEY or CLERK_SECRET_KEY is required.");
    const audience = split(environment.CLERK_AUDIENCE);
    const authorizedParties = split(environment.CLERK_AUTHORIZED_PARTIES);
    const verifier = new ClerkSessionTokenVerifier({ ...(jwtKey ? { jwtKey } : {}), ...(secretKey ? { secretKey } : {}), ...(audience.length ? { audience } : {}), ...(authorizedParties.length ? { authorizedParties } : {}) });
    this.boundary = new SessionVerificationBoundary(verifier, { issuer, ...(audience.length ? { audience } : {}), ...(authorizedParties.length ? { authorizedParties } : {}) });
  }
  public async verify(token: string): Promise<Identity> {
    const verified = await this.boundary.authenticate(`Bearer ${token}`);
    return { issuer: verified.issuer, subject: verified.subject, ...(verified.issuedAt === undefined ? {} : { issuedAt: verified.issuedAt }) };
  }
}
function required(environment: NodeJS.ProcessEnv, name: string): string { const value = environment[name]; if (!value) throw new Error(`Authentication is not configured: ${name} is required.`); return value; }
function split(value: string | undefined): string[] { return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? []; }
