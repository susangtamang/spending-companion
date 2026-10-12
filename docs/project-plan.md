# Spending Companion — US Version 1 project plan

Last updated: 2026-10-11

## Product objective

Help a US user answer:

> How much can I still spend this month, and where is my money going?

Plaid is the primary transaction source. Manual entry and CSV import remain available as fallbacks. All authoritative financial calculations run on the backend using normalized USD integer-cent values.

## Decisions made

- Launch market: United States only.
- Currency: USD only in Version 1.
- Bank connectivity: Plaid Transactions.
- Mobile: React Native with Expo, iOS first with Android compatibility.
- Backend: NestJS.
- Database: PostgreSQL.
- Plaid secrets and access tokens never enter the mobile app.
- Spending totals are deterministic; AI never calculates authoritative totals.
- Manual entry and CSV import remain supported when Plaid is unavailable.
- Plaid requires a custom Expo development build; Expo Go remains useful only for non-Plaid screens.

## Version 1 user journey

1. User creates a Spending Companion account.
2. User reviews the financial-data consent and privacy summary.
3. User connects a US institution through Plaid Link.
4. Backend exchanges the temporary Plaid token and starts transaction synchronization.
5. User chooses accounts and establishes monthly budgets.
6. Dashboard displays verified posted, pending, available, category, and merchant totals.
7. Plaid webhooks keep transactions current.
8. User can correct categories without overwriting source data.
9. User can use manual entry or CSV import as a fallback.
10. User can reconnect or remove a bank, export data, and delete the account.

## Version 1 functionality

### Account and onboarding

- Create account, sign in, sign out, and recover access.
- Explain that bank authentication occurs in Plaid or the institution UI.
- Allow bank connection to be skipped initially.
- Obtain explicit consent before connecting financial data.
- Isolate every record and operation by authenticated user ID.

### Bank connections

- Connect one or more US institutions using Plaid Link.
- Select which accounts participate in spending calculations.
- Display institution, masked account, connection health, and last successful sync.
- Support reconnect/update mode for expired credentials or consent.
- Disconnect an institution and stop Plaid billing through `/item/remove`.
- Clearly distinguish disconnecting a bank from deleting transaction history.

### Transactions

- Import Plaid added, modified, and removed transactions idempotently.
- Retain raw source identity and normalized display fields separately.
- Search and filter by account, date, merchant, category, status, and source.
- Allow category and note overrides without modifying the Plaid source record.
- Support manual create, edit, and delete.
- Preserve CSV source IDs and import history.
- Reject non-USD records in Version 1 with a visible explanation.

### Budgets and dashboard

- Default monthly budgets: $2,500 including utilities and $1,700 excluding utilities.
- Allow editable defaults and per-month overrides.
- Show posted purchases, active pending purchases, available amount, and overspending.
- Show category and normalized-merchant breakdowns.
- Browse calendar months using the user's selected US timezone.
- Every breakdown must reconcile to the same eligible transaction set as the headline total.
- Show data freshness and stale/offline states.

### CSV fallback

- Select a file from device storage.
- Support one documented format initially.
- Preview valid rows, errors, duplicates, and category suggestions.
- Confirm before committing any rows.
- Group records into an import batch and support undo.
- Dedupe source IDs within the correct institution/account/import scope.

### Pending-to-posted reconciliation

- Prefer Plaid's explicit `pending_transaction_id` relationship.
- Mark replaced pending records without erasing their audit history.
- Count one logical purchase at most once.
- Suggest unmatched candidates using account, amount, merchant similarity, and date window.
- Require manual confirmation for ambiguous matches.
- Never merge solely because merchant and amount match.

### Privacy and account controls

- Export the user's stored data.
- Remove individual bank connections.
- Delete the entire account in-app after reauthentication and confirmation.
- Remove Plaid Items, encrypted tokens, transactions, budgets, sessions, and queued work according to the published retention policy.
- Publish privacy-policy and support URLs before external testing.

## Canonical financial rules

1. Monetary values are safe integer cents; no authoritative floating-point arithmetic.
2. Domain amounts are non-negative; transaction kind determines their meaning.
3. Only active `purchase` records reduce the purchase budget.
4. Posted and unreconciled pending purchases count once.
5. Refunds, payments, transfers, cash movements, removed records, and replaced pending records do not reduce the purchase budget.
6. Posted purchases use their posted date for month assignment; pending purchases use their occurrence date.
7. Month boundaries use the user's configured US timezone, not raw UTC dates.
8. Utilities use a stable category identifier or flag, not category-name text comparison.
9. Category and merchant totals equal the headline spent amount for identical filters.
10. Import and synchronization retries are idempotent.

## Canonical transaction shape

The shared contract must represent:

- Internal ID and owning user ID
- Optional financial account ID
- Source: Plaid, CSV, or manual
- Scoped source transaction ID
- Status: pending, posted, or removed
- Kind: purchase, refund, payment, transfer, or cash
- Non-negative amount in USD cents
- Raw, display, and normalized merchant values
- Source category and optional user category override
- Occurrence date and optional posted date
- Pending/reconciled transaction linkage
- Optional import batch
- Created and updated timestamps
- Source/audit metadata with a documented retention policy

## Backend boundary

### Mobile-facing endpoints

- Authentication and session endpoints
- `POST /v1/plaid/link-token`
- `POST /v1/plaid/exchange`
- `GET /v1/plaid/items`
- `POST /v1/plaid/items/:id/update-link-token`
- `POST /v1/plaid/items/:id/sync`
- `DELETE /v1/plaid/items/:id`
- `GET /v1/accounts`
- `GET /v1/transactions`
- Transaction/category/budget CRUD endpoints
- Summary and breakdown endpoints
- CSV preview/commit/undo endpoints
- Export and account-deletion endpoints

### Plaid-facing endpoint

- `POST /v1/webhooks/plaid`

The webhook endpoint verifies Plaid's signature, acknowledges after durable enqueue, and processes events idempotently. Sync workers serialize work per Plaid Item, traverse every `/transactions/sync` page, and advance the cursor only after the complete update commits successfully.

### Security requirements

- Plaid client secret stored in an environment-specific secret manager.
- Plaid access tokens encrypted with envelope encryption/KMS at rest.
- Tokens decrypted only inside the Plaid service immediately before calls.
- Link, public, and access tokens redacted from logs and errors.
- HTTPS everywhere and least-privilege service/database roles.
- Cross-user access tests for every resource type.
- Separate sandbox, trial, and production configuration and databases.

## Delivery plan and agent ownership

Work begins only after the contract milestone. Up to three implementation agents can run alongside the integration lead.

### Phase 0 — Contracts and fixtures

Owner: integration lead

- Finalize transaction, category, budget, connection, and sync-state contracts.
- Decide authentication provider and token/session model.
- Decide disconnect-history retention policy.
- Produce OpenAPI contract and shared Plaid/transaction fixtures.
- Define database migrations and environment boundaries.

Exit gate: mobile, domain, and backend agents can implement against the same versioned contract without inventing fields independently.

Status: **Complete**. Shared contracts compile, OpenAPI validates, security review passes, and migration guidance is recorded. Track subsequent work in `docs/phase-status.md`.

### Phase 1 — Domain engine

Owner: domain agent

- Normalization and cent conversion.
- Eligibility rules, monthly totals, category and merchant breakdowns.
- Pending-to-posted reconciliation.
- CSV validation, scoped deduplication, and import batches.
- Unit and property-style tests for invariants and US timezone boundaries.

Exit gate: shared fixtures produce exact expected totals, and retries/reconciliation cannot double-count.

Status: **Complete**. The monorepo gate passes 55 tests across mobile and the three authoritative domain packages.

### Phase 2 — Backend foundation

Owner: backend agent

- NestJS service, PostgreSQL migrations, authentication enforcement, and health checks.
- User, category, budget, account, transaction, and import APIs.
- Tenant isolation and integration tests.
- Local Docker development environment and secret placeholders.

Exit gate: authenticated API persists and returns normalized fixtures with cross-user access denied.

Status: **Complete**. The authenticated persistent API, tenant-isolation tests, CSV workflow, reconciliation, and restart/idempotency gate pass against the isolated PostgreSQL test database.

### Phase 3 — Plaid Sandbox

Owner: Plaid/backend agent

- Link-token and public-token exchange.
- Encrypted access-token storage.
- Initial and incremental `/transactions/sync` worker.
- Signature-verified webhook intake.
- Connection health, update mode, manual refresh, and removal.
- Plaid Sandbox integration tests, including replayed webhooks.

Exit gate: connect Sandbox institution, sync all pages once, process added/modified/removed transactions, reconcile pending-to-posted once, reconnect, and disconnect.

### Phase 4 — Mobile product

Owner: mobile agent

- Structured navigation, account onboarding, and consent.
- Custom Expo development build with native Plaid Link.
- Dashboard, transaction details/search/filtering, budgets, connections, and freshness states.
- Manual entry, device CSV picker, preview, undo, and review queue.
- Loading, empty, stale, offline, reconnect, and institution-error states.
- Accessibility: dynamic text, screen-reader labels, focus, contrast, and 44-point targets.

Exit gate: complete primary journey on physical iPhone against Sandbox without Expo Go.

### Phase 5 — Privacy and operational readiness

Owner: integration/platform lead

- Export, bank disconnect, and account deletion end to end.
- Structured logging with financial-data redaction.
- Monitoring, alerting, backups, restore test, and incident runbooks.
- Dependency and security review.
- Privacy policy, terms, support route, and retention documentation.

Exit gate: deletion and restore drills pass; no Plaid secret/access token appears in client bundles, API responses, logs, or crash reports.

### Phase 6 — Trial, TestFlight, and App Store

Owner: release agent with integration lead

- Plaid Trial/live-account testing and production-access preparation.
- Apple signing, stable bundle identifier, Universal Links, icons, and splash screen.
- Internal and external TestFlight device matrix.
- App privacy labels, screenshots, review notes, and test account.
- Signed-build OAuth validation and final release checklist.

Exit gate: external TestFlight acceptance, production Plaid readiness, working account deletion/export, and approved release checklist.

### Phase 7 — AI companion

Deferred until the verified core is stable.

- Narrow backend tools returning verified summaries and transactions.
- Category suggestions requiring confirmation.
- Evaluation fixtures with known answers.
- Explicit labeling, provider failure states, privacy minimization, and cost controls.

## Required test matrix

- Unit: cents, dates, month boundaries, types/statuses, negative availability, utilities, refunds, breakdown reconciliation.
- Database: constraints, migrations, scoped uniqueness, tenant isolation, atomic sync/import behavior.
- API: authentication, authorization, pagination, idempotency, validation, export, and deletion.
- Plaid: Sandbox Link, MFA/cancel/error, duplicate connection, pagination mutation, webhook verification/replay, reconnect, disconnect, and pending replacement.
- Mobile: loading, offline, stale, empty, accessibility, interrupted OAuth, and preserved form input.
- End to end: account creation through bank connection, verified dashboard, manual and CSV fallbacks, reconciliation, export, disconnect, and deletion.
- Devices: minimum and current supported iOS, representative Android, small and large displays, large text, slow and interrupted networks.

## Definition of Version 1 done

Version 1 is done when a US user can securely create an account, connect a supported bank, synchronize and understand transactions, manage budgets and categories, use manual/CSV fallbacks, recover a broken connection, export or delete their data, and complete the core flows on a signed TestFlight build with verified calculations and operational monitoring.

## Deferred beyond Version 1

- Non-US institutions and non-USD currencies
- Money movement or payment initiation
- Investment and liability products
- Shared household accounts
- Automatic budget recommendations
- AI chat and category automation
- Kubernetes production hosting unless actual scale and cost justify it

## Immediate decision gates

1. Authentication: managed identity provider or custom NestJS credentials. Recommendation: managed provider to reduce credential risk.
2. Disconnect retention: retain imported history by default or delete it with the Plaid Item. Recommendation: offer an explicit choice and explain the effect.
3. Hosting/KMS vendor: choose before token persistence. Recommendation: align API, PostgreSQL, queue, secret manager, and KMS within one cloud.
4. Supported Plaid accounts: checking and credit accounts first. Recommendation: defer savings inclusion in spending totals until rules are explicit.
