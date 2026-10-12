import { verifyToken } from "@clerk/backend";
import type { SessionClaims, SessionTokenVerifier } from "./session.js";

export interface ClerkVerifierConfig {
  /** Server-only Clerk secret. Prefer jwtKey when networkless verification is configured. */
  readonly secretKey?: string;
  /** Clerk PEM public key for networkless verification. */
  readonly jwtKey?: string;
  readonly audience?: string | readonly string[];
  readonly authorizedParties?: readonly string[];
}

/** Production adapter. Policy is also enforced independently by SessionVerificationBoundary. */
export class ClerkSessionTokenVerifier implements SessionTokenVerifier {
  constructor(private readonly config: ClerkVerifierConfig) {
    if (!config.secretKey && !config.jwtKey) {
      throw new Error("Clerk verification requires a server-side secretKey or jwtKey.");
    }
  }

  async verify(token: string): Promise<SessionClaims> {
    const result = await verifyToken(token, {
      ...(this.config.secretKey ? { secretKey: this.config.secretKey } : {}),
      ...(this.config.jwtKey ? { jwtKey: this.config.jwtKey } : {}),
      ...(this.config.audience ? { audience: [...asArray(this.config.audience)] } : {}),
      ...(this.config.authorizedParties
        ? { authorizedParties: [...this.config.authorizedParties] }
        : {}),
    });

    return {
      ...(typeof result.iss === "string" ? { iss: result.iss } : {}),
      ...(typeof result.sub === "string" ? { sub: result.sub } : {}),
      ...(typeof result.exp === "number" ? { exp: result.exp } : {}),
      ...(typeof result.nbf === "number" ? { nbf: result.nbf } : {}),
      ...(typeof result.iat === "number" ? { iat: result.iat } : {}),
      ...(typeof result.sid === "string" ? { sid: result.sid } : {}),
      ...(typeof result.aud === "string" || Array.isArray(result.aud) ? { aud: result.aud } : {}),
      ...(typeof result.azp === "string" ? { azp: result.azp } : {}),
    };
  }
}

function asArray(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}
