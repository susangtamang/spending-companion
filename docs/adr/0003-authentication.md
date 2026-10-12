# ADR 0003: Managed authentication

Status: Accepted

## Decision

Use Clerk as the Version 1 identity provider with passwordless email verification codes as the primary sign-up and sign-in method.

- Expo uses `@clerk/expo` and Clerk's supported secure token cache.
- NestJS uses `@clerk/backend` to validate session JWTs.
- The mobile app sends a short-lived session token in the HTTPS `Authorization` header.
- The API always validates signature, time claims, issuer, and subject. Audience and authorized-party validation is enabled only against claim values verified from real Expo development-build tokens and recorded per environment.
- The verified `(issuer, subject)` maps transactionally to an internal user UUID; every tenant-owned query uses that UUID.
- Clerk's secret key remains server-side. Only the publishable key is included in the mobile configuration.
- Social login is deferred. If introduced on iOS, Apple sign-in parity will be reviewed before release.

Plaid Link authentication is a separate bank-consent flow and never substitutes for Spending Companion authentication.

## Rationale

Managed authentication avoids creating and recovering application passwords while fitting an Expo client and independently authoritative NestJS API. Email codes also avoid native email-link routing during the first release.

## Account lifecycle

There is no application password-reset flow. Users regain access through verified control of their email account. Account deletion requires confirmation, removes Plaid Items and application data, invalidates sessions, and then deletes the Clerk identity. The workflow is idempotent and audited without retaining sensitive payloads.

Support must not manually reassign an identity or email based on ordinary support evidence. Lost-email recovery requires a separately approved high-assurance policy; otherwise account recovery may be unavailable. Clerk email delivery and rate limiting are documented availability dependencies.

## Security acceptance criteria

- Missing, invalid, expired, or wrong-issuer tokens return `401`. A wrong configured audience returns `401` when the token profile includes/configures `aud`; a wrong configured authorized party returns `401` when `azp` validation is enabled.
- Cross-user access is denied and integration-tested for every resource type.
- Client-provided user IDs, provider subjects, and emails never determine ownership or provision users.
- Authorization headers, session tokens, email codes, provider secrets, request/query bodies, queue payloads, and serialized errors use explicit sensitive-field redaction.
- Development, staging, and production use separate Clerk instances and keys.
- Sign-up, sign-in, sign-out, expiry, offline, rate-limit, and deletion flows are tested on iOS and Android.
- Pricing and retained-user limits are reviewed immediately before production launch.

## Primary references

- https://clerk.com/docs/expo/getting-started/quickstart
- https://clerk.com/docs/reference/backend/verify-token
- https://clerk.com/docs/guides/sessions/session-tokens
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
