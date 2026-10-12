# Dependency and security review

Review date: 2026-10-11

## Automated results

- Latest install/audit checkpoint: 32 findings (20 high, 12 moderate, 0 critical).
- Expo Doctor: 21/21 checks pass.
- The React runtime is pinned and deduplicated at the Expo SDK 57-required version.
- Plaid React Native v13 is kept on the current supported major. Its React Native Directory entry is excluded from Expo Doctor because Plaid's official documentation states v13 is rebuilt on Expo Modules and supports Expo 52+ and React Native 0.76+ custom builds.

## Advisory triage

The audit findings currently collapse to five transitive advisory families:

| Dependency path | Exposure in this product | Disposition |
|---|---|---|
| Metro/micromatch/braces | Local bundler processes glob configuration; it is not an API runtime dependency or shipped JavaScript feature | Track Expo/Metro upstream; do not feed untrusted glob patterns to build tooling |
| Expo code-signing/node-forge | Build/update signing tooling | Do not use untrusted certificates; use EAS-managed signing; track Expo upstream |
| Expo Router/query-string/decode-uri-component | Router/deep-link parsing | Treat untrusted, unusually long deep links as hostile; retest when the SDK-compatible Router release removes the dependency |
| Prisma CLI/deepmerge-ts | Schema/build configuration, not request processing | Keep schema/configuration trusted; track Prisma upstream |
| Xcode/uuid | iOS project generation tooling | No caller-supplied UUID buffers; track Expo config-plugin upstream |

`npm audit fix --force` is intentionally not used: its proposed Router 58 and Prisma downgrade are outside the verified Expo/Prisma compatibility set. These are open upstream risks, not silently declared fixed. Re-run the audit before each external build and update within the current Expo SDK whenever compatible patches become available.

## Application controls verified locally

- Authentication is verified server-side; provider subjects are never returned publicly.
- Persistence queries and mutations scope ownership by internal user ID, with cross-tenant HTTP tests.
- Mutation idempotency fingerprints method, route, and request content.
- Plaid secrets and access tokens remain backend-only; access tokens are encrypted with authenticated encryption in local/Sandbox environments and production refuses the local key adapter.
- Webhooks verify ES256, key ID, issued-at age, and exact raw-body SHA-256 before durable deduplication/enqueue.
- Structured logs exclude bodies, query strings, headers, tokens, merchants, amounts, and institution data.
- An HTTP test sends financial and credential-like fields while structured logging is enabled and verifies none appear in captured output.
- A mobile-source scan finds only the public Clerk publishable key, public API URL, and demo flag; no Plaid secret, Clerk secret, database URL, encryption key, or access token is referenced by the client.
- Export, deletion, and post-deletion reprovision denial are tenant-tested.
- Production still requires managed KMS, secret manager, HTTPS ingress, restricted database roles, hosted monitoring, and the external penetration/privacy review recorded in the release checklist.
