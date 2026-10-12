export type AuthErrorCode =
  | "missing_authorization"
  | "malformed_authorization"
  | "invalid_token"
  | "expired_token"
  | "wrong_issuer"
  | "wrong_audience"
  | "wrong_authorized_party"
  | "missing_subject";

export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(readonly code: AuthErrorCode, message = "Authentication failed.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Minimal verified claims consumed by the application boundary. */
export interface SessionClaims {
  readonly iss?: string;
  readonly sub?: string;
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly sid?: string;
  readonly aud?: string | readonly string[];
  readonly azp?: string;
}

/** Cryptographic verification is implemented by Clerk in production and a fake in tests. */
export interface SessionTokenVerifier {
  verify(token: string): Promise<SessionClaims>;
}

export interface SessionPolicy {
  readonly issuer: string;
  readonly audience?: string | readonly string[];
  readonly authorizedParties?: readonly string[];
  /** Injectable epoch seconds makes expiry tests deterministic. */
  readonly now?: () => number;
}

/** The only provider identity input accepted by persistence user mapping. */
export interface VerifiedIdentityMappingInput {
  readonly identityProvider: "clerk";
  readonly issuer: string;
  readonly subject: string;
}

/** Request-scoped identity. Internal user ID is added only after server-side mapping. */
export interface VerifiedIdentityContext extends VerifiedIdentityMappingInput {
  readonly sessionId?: string;
  readonly issuedAt?: number;
}

export interface InternalIdentityContext extends VerifiedIdentityContext {
  readonly internalUserId: string;
}

export class SessionVerificationBoundary {
  constructor(
    private readonly verifier: SessionTokenVerifier,
    private readonly policy: SessionPolicy,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<VerifiedIdentityContext> {
    const token = parseBearerToken(authorizationHeader);
    let claims: SessionClaims;
    try {
      claims = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("invalid_token");
    }

    this.enforceClaims(claims);
    const identity: VerifiedIdentityContext = {
      identityProvider: "clerk",
      issuer: claims.iss!,
      subject: claims.sub!,
    };
    return { ...identity, ...(claims.sid ? { sessionId: claims.sid } : {}), ...(claims.iat === undefined ? {} : { issuedAt: claims.iat }) };
  }

  private enforceClaims(claims: SessionClaims): void {
    if (!claims.sub) throw new AuthenticationError("missing_subject");
    if (claims.iss !== this.policy.issuer) throw new AuthenticationError("wrong_issuer");

    const now = this.policy.now?.() ?? Math.floor(Date.now() / 1_000);
    if (claims.exp === undefined || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now)) {
      throw new AuthenticationError("expired_token");
    }

    if (this.policy.audience && !audienceMatches(claims.aud, this.policy.audience)) {
      throw new AuthenticationError("wrong_audience");
    }

    if (
      this.policy.authorizedParties &&
      (!claims.azp || !this.policy.authorizedParties.includes(claims.azp))
    ) {
      throw new AuthenticationError("wrong_authorized_party");
    }
  }
}

export function mapVerifiedIdentity(
  verified: VerifiedIdentityContext,
  internalUserId: string,
): InternalIdentityContext {
  if (!internalUserId) throw new Error("A server-resolved internal user ID is required.");
  return { ...verified, internalUserId };
}

function parseBearerToken(header: string | undefined): string {
  if (!header?.trim()) throw new AuthenticationError("missing_authorization");
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match?.[1]) throw new AuthenticationError("malformed_authorization");
  return match[1];
}

function audienceMatches(
  actual: SessionClaims["aud"],
  expected: string | readonly string[],
): boolean {
  if (!actual) return false;
  const actualValues = typeof actual === "string" ? [actual] : actual;
  const expectedValues = typeof expected === "string" ? [expected] : expected;
  return expectedValues.some((value) => actualValues.includes(value));
}
