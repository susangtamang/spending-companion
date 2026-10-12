import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from "jose";
import type { JsonWebKey } from "./types.js";

export interface WebhookKeySource { getWebhookVerificationKey(keyId: string): Promise<JsonWebKey> }
export interface VerifyWebhookOptions { readonly maxAgeSeconds?: number; readonly now?: () => number }
export interface VerifiedWebhook { readonly payload: JWTPayload; readonly body: unknown; readonly keyId: string }

export async function verifyPlaidWebhook(rawBody: Uint8Array | string, verificationJwt: string | undefined, keys: WebhookKeySource, options: VerifyWebhookOptions = {}): Promise<VerifiedWebhook> {
  if (!verificationJwt) throw new Error("Missing Plaid-Verification header.");
  const header = decodeProtectedHeader(verificationJwt);
  if (header.alg !== "ES256" || !header.kid) throw new Error("Invalid Plaid webhook JWT header.");
  const jwk = await keys.getWebhookVerificationKey(header.kid);
  if (jwk.alg && jwk.alg !== "ES256") throw new Error("Invalid Plaid webhook key algorithm.");
  const key = await importJWK(jwk, "ES256");
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const { payload } = await jwtVerify(verificationJwt, key, { algorithms: ["ES256"], currentDate: new Date(now * 1000) });
  const maxAge = options.maxAgeSeconds ?? 300;
  if (typeof payload.iat !== "number" || payload.iat > now + 30 || now - payload.iat > maxAge) throw new Error("Plaid webhook JWT is outside the allowed timestamp window.");
  if (typeof payload.request_body_sha256 !== "string") throw new Error("Plaid webhook JWT has no body digest.");
  const bytes = typeof rawBody === "string" ? Buffer.from(rawBody) : Buffer.from(rawBody);
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(payload.request_body_sha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Plaid webhook body digest mismatch.");
  return { payload, body: JSON.parse(bytes.toString("utf8")) as unknown, keyId: header.kid };
}
