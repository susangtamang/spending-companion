# Spending Companion architecture

## System boundary

```text
Expo mobile app
    | authenticated HTTPS
NestJS API
    |                    | encrypted Plaid access
PostgreSQL               | token used just-in-time
    ^                    v
sync worker <------ Plaid API
    ^                    |
durable queue <--- verified webhook
```

The mobile app displays server-produced summaries and never receives a Plaid secret or access token. The backend is the source of truth for normalized transactions, category overrides, budgets, reconciliation, and totals.

## Environments

| Environment | Plaid | Database | Purpose |
|---|---|---|---|
| Local | Sandbox | Local PostgreSQL | Development and deterministic integration tests |
| CI | Mock/Sandbox contract fixtures | Ephemeral PostgreSQL | Automated verification |
| Staging | Sandbox, then Trial when approved | Isolated managed PostgreSQL | Signed development builds and end-to-end QA |
| Production | Production | Isolated managed PostgreSQL | App Store users |

Secrets, encryption keys, queues, databases, webhook URLs, Plaid applications, and Clerk instances/keys must be isolated by environment. Production data must never be copied into local or CI environments.

## Authentication boundary

Clerk issues mobile session tokens. NestJS validates each token with Clerk's supported backend verifier, including signature, issuer, expiry/not-before, subject, and the configured audience/authorized-party claims when those claims are present in the actual Expo token profile. Exact staging and production claim values must be captured from signed development-build fixtures before the authentication implementation gate closes; unsupported claims are not assumed.

Only after verification does the backend transactionally find or create an internal user using `(issuer, subject)`. Email is mutable contact/display metadata, never an ownership key. Client-provided user IDs, provider subjects, and emails are never trusted for provisioning or authorization.

The mobile app uses Clerk's supported secure token cache. Clerk session and refresh tokens are not persisted in PostgreSQL or written to logs, queues, request bodies, error serialization, or analytics.

## Plaid boundary

1. Mobile requests a Link token from NestJS.
2. NestJS creates it with `transactions`, country `US`, the registered Android package, and iOS redirect configuration.
3. Plaid Link returns a temporary public token to mobile.
4. Mobile immediately sends it to NestJS over authenticated HTTPS.
5. NestJS exchanges it, encrypts the access token, and queues initial synchronization.
6. Webhooks are signature-verified and durably queued before acknowledgment.
7. One serialized worker per Item applies complete sync updates atomically.

Plaid webhooks do not use Clerk authentication. After signature verification, the backend resolves tenancy only through the stored Plaid Item mapping. Unknown Items are quarantined or rejected and can never create a user or connection from webhook-supplied identifiers. Stored webhook content is minimized, redacted, and expires under the retention policy.

## Authoritative calculation boundary

The domain engine accepts normalized records and an explicit month/timezone/filter policy. It returns integer-cent summaries and breakdowns. Mobile formatting is presentation-only. Plaid categories, AI suggestions, and client calculations cannot become authoritative without server validation.

## Offline boundary

Cached mobile data may be displayed with its last-updated time. Bank connection and synchronization require network access. Mutations use client-generated idempotency keys; Version 1 may defer unsafe writes rather than silently queue them.
