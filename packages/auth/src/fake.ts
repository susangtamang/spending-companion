import { AuthenticationError } from "./session.js";
import type { SessionClaims, SessionTokenVerifier } from "./session.js";

export type FakeTokenOutcome = SessionClaims | Error;

/** Deterministic verifier for unit/integration tests; it performs no JWT parsing. */
export class FakeSessionTokenVerifier implements SessionTokenVerifier {
  private readonly outcomes = new Map<string, FakeTokenOutcome>();

  constructor(entries: Readonly<Record<string, FakeTokenOutcome>> = {}) {
    for (const [token, outcome] of Object.entries(entries)) this.outcomes.set(token, outcome);
  }

  set(token: string, outcome: FakeTokenOutcome): this {
    this.outcomes.set(token, outcome);
    return this;
  }

  async verify(token: string): Promise<SessionClaims> {
    const outcome = this.outcomes.get(token);
    if (!outcome) throw new AuthenticationError("invalid_token");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}
