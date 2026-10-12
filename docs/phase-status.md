# Spending Companion delivery status

Last updated: 2026-10-11

| Phase | Status | Exit gate |
|---|---|---|
| 0. Contracts and fixtures | Complete | Shared contracts, OpenAPI, authentication, retention, database, and environments agreed |
| 1. Domain engine | Complete | Exact totals and idempotent reconciliation pass shared fixtures |
| 2. Backend foundation | Complete | Authenticated persistent API with tenant isolation |
| 3. Plaid Sandbox | In progress | Link, sync, webhook, reconnect, and disconnect pass Sandbox tests |
| 4. Mobile product | In progress | Primary journey passes on physical iPhone development build |
| 5. Privacy and operations | In progress | Export/deletion, security, backup/restore, and monitoring gates pass |
| 6. Trial, TestFlight, App Store | Not started | External TestFlight and release checklists pass |
| 7. AI companion | Deferred | Begins only after verified core is stable |

## Active work

- Phase 3 live Plaid Sandbox validation (local durable orchestration is complete; external gate remains pending)
- Phase 4 signed physical-device validation (the product screens and flows are implemented)
- Phase 5 operational readiness and release documentation

## Phase 2 verification so far

- Entire current workspace build and TypeScript checks pass.
- Authentication boundary: 8 tests passed.
- PostgreSQL migrations: all 6 deployed to the isolated test database.
- PostgreSQL repositories/constraints: 11 tests passed against the live database.
- Cross-package import, reconciliation, summary, and undo workflows: 2 tests passed.
- Persistent authenticated HTTP gate: purchase survives an API restart, idempotent replay returns the original record, totals remain correct, and a second tenant receives 404.
- CSV preview, commit, history/detail, tenant isolation, idempotent replay, and atomic undo are persisted and verified.
- Phase 2/5 API suite: 13/13 tests pass against the isolated PostgreSQL database where applicable, including public DTO redaction, non-destructive imported-transaction overrides, protected operations endpoints, stale reauthentication rejection, and log redaction.

## Phase 3 preparation

- Official Plaid provider adapter, token-encryption port, verified webhook parser, and pagination planner implemented.
- Provider package: 6 tests passed with generated keys and synthetic fixtures.
- Durable banking orchestration, PostgreSQL adapter, bounded background worker, retry/stale-job recovery, and connection-health transitions are implemented; all 16 banking tests pass, including four PostgreSQL orchestration scenarios.
- NestJS endpoints now fail closed when unconfigured and activate from backend-only environment values; the OpenAPI link-session contract and mobile callback agree.
- Live Plaid Sandbox connection has not been verified; real Sandbox credentials are required.

## Phase 4 preparation

- Expo Router, Clerk native authentication gate, encrypted session cache, authenticated API client, and explicit sample-data mode are implemented.
- Live dashboard totals/breakdowns/freshness and bank connection/manual-sync screens now call the authenticated API.
- Activity supports month navigation, search/status filters, transaction detail/edit/delete, CSV selection, and an explicit reconciliation review queue; account inclusion toggles and accessibility states are wired to the API.
- Plaid Link uses the backend-issued consent session ID and the app configuration resolves successfully for a custom development build.
- Physical-device Plaid Link remains gated on Clerk and Plaid Sandbox accounts plus a signed custom development build.
- Original Spending Companion icon, Android adaptive foreground, and configured splash assets replace the Expo placeholders; Expo validates the supported splash-screen plugin configuration.
- Offline/interrupted manual-entry drafts persist locally until a successful save; Activity supports month, merchant, status, source, account, and category filtering with paginated API traversal.
- The complete local suite passes 111 tests, all workspace TypeScript checks and builds pass, and Expo Doctor passes all 21 checks.

## Phase 5 progress

- Tenant-scoped JSON/CSV exports use authenticated, expiring download routes.
- Account deletion verifies a matching identity token, removes active Plaid Items first, cascades user data, and records a non-financial identity tombstone that prevents silent reprovisioning.
- PostgreSQL privacy integration test covers cross-tenant export denial, exported transaction contents, completed deletion status, and post-deletion access denial.
- Mobile Settings exposes authenticated export sharing, permanent deletion confirmation, budget editing, category creation, and sign-out.
- Expo dependency versions are deduplicated; Expo Doctor passes after excluding only React Native Directory's stale Plaid metadata. Plaid's official v13 documentation states the SDK is built on Expo Modules and supports Expo 52+/React Native 0.76+ custom builds.
- Structured request logging excludes bodies, queries, headers, and financial fields; readiness and bearer-protected metrics endpoints are implemented.
- Local backup/restore drill passed on 2026-10-10: all 6 migrations and 19 public tables restored into the isolated `spending_companion_restore_test` database. The disposable database and temporary dump were removed afterward.
- Draft privacy policy, terms, support instructions, retention/backup policy, alert thresholds, and incident/Plaid-outage runbooks are checked in.
- The refreshed production dependency audit reports 32 findings (20 high, 12 moderate, 0 critical); all remain tracked upstream/tooling chains and forced incompatible downgrades are prohibited.
- A least-privilege GitHub Actions workflow provisions isolated PostgreSQL, applies migrations, and runs checks, builds, all tests, the pinned Expo Doctor, and the critical-severity dependency gate. It becomes enforceable after a repository/remote is created.
- Remaining gate evidence: dependency/security review resolution, production backup/monitor integration, and real published policy/support URLs.

## Phase 6 preparation

- EAS development, preview, and production profiles, stable bundle/package identifiers, build numbers, branded store assets, release checklist, and an App Store metadata/privacy/review-notes draft are checked in.
- Remaining gate evidence requires Expo/EAS and Apple Developer access, final public URLs and legal copy, signed-build screenshots, Plaid Trial/Production readiness, and the physical-device/TestFlight matrix.

## Completed Phase 1

- Authoritative domain engine: 20 tests
- CSV import planning: 9 tests
- Pending/posting reconciliation: 7 tests
- Existing mobile calculations: 19 tests
- Combined monorepo gate: 55 tests and all TypeScript checks passing
- Production dependency audit reviewed; Expo/Metro advisories are tracked for Phase 5 because the suggested forced fix is a breaking Expo downgrade

## Completed Phase 0 decisions

- Managed authentication: Clerk email verification codes (`docs/adr/0003-authentication.md`)
- Disconnect retention policy (`docs/adr/0001-data-retention.md`)
- Version 1 account scope (`docs/adr/0002-account-scope.md`)
- Logical PostgreSQL model and environment boundaries
- OpenAPI 3.1 contract includes the implemented readiness, protected metrics, and authenticated export-download routes in addition to the Version 1 product API.
- Shared TypeScript contracts and deterministic fixtures
- Mobile v1-to-v2 contract migration plan

## Resolved Phase 0 gate findings

- Align OpenAPI and TypeScript field/enum vocabulary.
- Separate internal persistence contracts from public DTOs.
- Add reconciliation, import-history, and deletion-status API surfaces.
- Standardize idempotency, consent audit, and public error contracts.
- Migrate the local prototype safely from unversioned v1 storage to the canonical model.
