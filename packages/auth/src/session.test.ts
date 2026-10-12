import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  FakeSessionTokenVerifier,
  SessionVerificationBoundary,
  mapVerifiedIdentity,
  redactSensitive,
} from "./index.js";
import type { AuthErrorCode, SessionClaims } from "./index.js";

const NOW = 1_800_000_000;
const validClaims: SessionClaims & {
  readonly iss: string;
  readonly sub: string;
  readonly sid: string;
  readonly exp: number;
  readonly nbf: number;
  readonly aud: string;
  readonly azp: string;
} = {
  iss: "https://clerk.example.test",
  sub: "user_clerk_123",
  sid: "session_123",
  exp: NOW + 60,
  nbf: NOW - 60,
  aud: "spending-api",
  azp: "spending-companion",
};

function boundary(claims = validClaims) {
  return new SessionVerificationBoundary(new FakeSessionTokenVerifier({ token: claims }), {
    issuer: validClaims.iss,
    audience: validClaims.aud,
    authorizedParties: [validClaims.azp],
    now: () => NOW,
  });
}

async function expectCode(promise: Promise<unknown>, code: AuthErrorCode) {
  await expect(promise).rejects.toMatchObject<Partial<AuthenticationError>>({ code, statusCode: 401 });
}

describe("SessionVerificationBoundary", () => {
  it("rejects missing and malformed authorization", async () => {
    await expectCode(boundary().authenticate(undefined), "missing_authorization");
    await expectCode(boundary().authenticate("Basic abc"), "malformed_authorization");
    await expectCode(boundary().authenticate("Bearer one two"), "malformed_authorization");
  });

  it("rejects malformed or cryptographically invalid tokens", async () => {
    await expectCode(boundary().authenticate("Bearer unknown"), "invalid_token");
  });

  it("rejects expired tokens", async () => {
    await expectCode(boundary({ ...validClaims, exp: NOW }).authenticate("Bearer token"), "expired_token");
  });

  it("rejects the wrong issuer", async () => {
    await expectCode(
      boundary({ ...validClaims, iss: "https://attacker.example" }).authenticate("Bearer token"),
      "wrong_issuer",
    );
  });

  it("enforces audience only when configured", async () => {
    await expectCode(
      boundary({ ...validClaims, aud: "another-api" }).authenticate("Bearer token"),
      "wrong_audience",
    );
    const withoutAudiencePolicy = new SessionVerificationBoundary(
      new FakeSessionTokenVerifier({ token: { ...validClaims, aud: "another-api" } }),
      { issuer: validClaims.iss, now: () => NOW },
    );
    await expect(withoutAudiencePolicy.authenticate("Bearer token")).resolves.toMatchObject({
      subject: validClaims.sub,
    });
  });

  it("enforces authorized party only when configured", async () => {
    await expectCode(
      boundary({ ...validClaims, azp: "another-app" }).authenticate("Bearer token"),
      "wrong_authorized_party",
    );
  });

  it("produces only verified identity mapping inputs", async () => {
    const verified = await boundary().authenticate("Bearer token");
    expect(verified).toEqual({
      identityProvider: "clerk",
      issuer: validClaims.iss,
      subject: validClaims.sub,
      sessionId: validClaims.sid,
    });
    expect(mapVerifiedIdentity(verified, "internal-user-1")).toEqual({
      ...verified,
      internalUserId: "internal-user-1",
    });
  });
});

describe("redactSensitive", () => {
  it("redacts auth headers, tokens, secrets, codes, and embedded bearer values", () => {
    const input = {
      authorization: "Bearer abc.def.ghi",
      nested: {
        access_token: "plaid-secret",
        password: "password",
        message: "request failed with Bearer abc.def.ghi",
        merchant: "Coffee Shop",
      },
    };
    expect(redactSensitive(input)).toEqual({
      authorization: "[REDACTED]",
      nested: {
        access_token: "[REDACTED]",
        password: "[REDACTED]",
        message: "request failed with Bearer [REDACTED]",
        merchant: "Coffee Shop",
      },
    });
    expect(input.nested.access_token).toBe("plaid-secret");
  });
});
