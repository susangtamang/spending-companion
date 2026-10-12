# Mobile contract migration: local v1 to shared-contract v2

Last updated: 2026-10-09

## Purpose

Move the Expo app from its original device-only `AppData` and transaction types to `@spending-companion/contracts` without losing local data or changing verified totals. The migration must be reversible for at least one release.

The existing `spending-companion:v1` AsyncStorage value has no embedded schema version and is currently trusted through a TypeScript assertion. TypeScript does not validate stored JSON at runtime, so the app must decode and validate old data before transforming it.

## Important model changes

| Local v1 | Shared-contract v2 | Migration behavior |
|---|---|---|
| `merchant` | `rawMerchant`, `displayMerchant`, `normalizedMerchant` | Preserve the original value; trim for display and normalize deterministically for grouping. |
| `category` string | `sourceCategoryId`, `categoryOverrideId`, `Category` | Resolve to a stable category record; create a deterministic user category for unknown values. |
| `date` | `occurrenceDate`, `postedDate` | Copy to `occurrenceDate`; also copy to `postedDate` for legacy posted records. |
| `source: "import"` | `source: "csv"` | Rename during migration. |
| `sourceId` | `sourceTransactionId` | Preserve the exact value. Future uniqueness is scoped by user, source, and account/import context. |
| `importedAt` | import batch/audit timestamps | Preserve when known; do not invent detailed provenance. |
| two budget scalars | `Budget` records | Create two default budget records with no monthly override. |
| `latestImportAt` | import history/freshness | Preserve as legacy metadata; it is not a substitute for full import history. |

V2 also requires ownership, USD currency, and creation/update timestamps. These are backfilled explicitly during migration.

## Ordered migration plan

### 1. Introduce runtime decoders

Create separate runtime validators for the complete v1 storage envelope and v2 envelope. Do not cast parsed JSON directly to either type.

- Validate every required v1 field and enum.
- Require safe, non-negative integer cents.
- Validate actual calendar dates, not only `YYYY-MM-DD` shape.
- Return row-level errors so one malformed transaction does not erase valid data.
- Define the v2 envelope as `{ schemaVersion: 2, data: ... }`.

### 2. Add a separate v2 storage key

Write v2 to `spending-companion:v2`. Do not overwrite or remove `spending-companion:v1` during the initial rollout.

At startup:

1. Read and validate v2 if it exists.
2. Otherwise, read and validate v1.
3. If neither exists, initialize new v2 data normally.
4. If v1 is corrupt, show a recoverable migration error and preserve its bytes for support/export.

### 3. Establish user ownership deliberately

Legacy device data has no owner. After authentication, ask the user whether to import local data into the signed-in account. Never silently attach shared-device data to the first user who signs in.

Use the authenticated backend user ID for all migrated user-owned records. Record that the migration was user-confirmed.

### 4. Create stable categories first

Create system categories with stable IDs, including a utility category whose `isUtility` value is `true`. Map known legacy names case-insensitively after trimming.

For an unknown legacy category, create one deterministic user category and reuse it for matching legacy values. Preserve the original category label. Utility exclusion must use category metadata, never category-name comparison.

### 5. Transform transactions

For each valid legacy transaction:

1. Preserve its internal ID when it does not collide; otherwise create a new ID and record the legacy ID in sanitized audit metadata.
2. Add the confirmed `userId` and `currencyCode: "USD"`.
3. Rename `source: "import"` to `source: "csv"`; retain `manual` unchanged.
4. Rename `sourceId` to `sourceTransactionId` without modifying its value.
5. Populate raw, display, and normalized merchant fields deterministically.
6. Resolve the legacy category to its stable category ID.
7. Copy `date` to `occurrenceDate`; for a posted transaction also set `postedDate` to the same date.
8. Preserve `amountCents`, `status`, `kind`, and note-like values without changing their financial meaning.
9. Use the best known legacy timestamp for `createdAt` and `updatedAt`; otherwise use one migration timestamp shared by the whole run.
10. Preserve known import timestamps in sanitized legacy audit metadata.

Do not generate financial-account IDs for records whose account is unknown. Do not infer reconciliation from equal merchant and amount values.

### 6. Migrate budgets

Create two default `Budget` records:

- `including_utilities` from `budgetIncludingUtilitiesCents`
- `excluding_utilities` from `budgetExcludingUtilitiesCents`

Leave `month` absent. Legacy values represent defaults, not monthly overrides.

### 7. Represent legacy import history honestly

Old data cannot reconstruct file names, raw CSV rows, preview errors, undo state, or reliable batch boundaries. Either leave `importBatchId` absent and mark provenance as legacy, or create a single clearly named legacy migration batch. Do not claim that an inferred batch is an original import batch.

New CSV imports must use scoped deduplication rather than the old global source-ID set. At minimum, scope uniqueness by user, source, financial account when known, and import/source context.

### 8. Update financial eligibility before enabling v2 statuses

Centralize one eligibility predicate and use it for headline, category, and merchant totals.

An eligible spending transaction is:

- a `purchase`;
- in the requested month using `postedDate` when posted and `occurrenceDate` when pending;
- `posted`, or pending and not reconciled/replaced;
- not `removed`; and
- associated with an included account when account information exists.

When utilities are excluded, use `Category.isUtility`. Explicit status checks are required because the old implementation treated every non-posted purchase as pending, which would incorrectly count v2 `removed` records.

Month assignment must use the user's configured US timezone. Calendar dates should remain date-only values; UTC timestamps must not be truncated to determine their month.

### 9. Verify before switching storage

Perform the entire transform in memory, validate the resulting v2 envelope, and verify financial invariants. Then:

1. Write `spending-companion:v2`.
2. Read it back from AsyncStorage.
3. Decode it again with the v2 validator.
4. Recalculate and compare expected totals.
5. Only then mark v2 as active.

If any step fails, continue using v1 where safe and show a recoverable error. Never replace failed migration data with sample transactions.

### 10. Retain rollback and add cleanup later

Keep the v1 value unchanged through at least one successful app release and until v2 has loaded successfully on subsequent launches. Remove it only in a later, separately tested cleanup migration. Account deletion must delete both keys while the rollback window exists.

## Acceptance tests

### Storage and recovery

- A valid v1 payload migrates once and subsequent launches load the same v2 records without duplicating them.
- A valid existing v2 payload bypasses v1 migration.
- A partially written, invalid, or wrong-version v2 payload does not delete or overwrite valid v1 data.
- Invalid JSON produces a recoverable error and preserves the original stored value.
- One malformed transaction is reported with its index/ID and does not silently disappear.
- A failed write or failed read-back leaves v1 available for rollback.
- Sample/demo data is never substituted after a migration failure.

### Transaction mapping

- Manual transactions remain `manual`; imported transactions become `csv`.
- Every migrated record has the confirmed user ID, USD currency, and deterministic timestamps.
- `merchant` maps to preserved raw, trimmed display, and deterministic normalized merchant values.
- `sourceId` is preserved exactly as `sourceTransactionId`.
- Pending records receive `occurrenceDate` but no fabricated `postedDate`.
- Posted records receive both dates from the legacy date.
- Invalid calendar dates such as `2026-02-30` are rejected or quarantined.
- IDs remain stable unless they collide; collisions are traceable in audit metadata.

### Categories and utilities

- `Utilities`, `utilities`, and whitespace variants map to the same stable utility category.
- Utility exclusion uses `isUtility`, not display text.
- Unknown category labels create stable user categories and repeated labels reuse them.
- Renaming a category does not change whether it is treated as a utility.

### Financial invariants

- The standard fixture remains posted `4,900`, pending `2,999`, spent `7,899` cents.
- Headline spent equals the sum of category breakdowns and the sum of merchant breakdowns for identical filters.
- Refunds, payments, transfers, cash movements, removed transactions, and replaced pending transactions do not reduce the purchase budget.
- A reconciled pending-to-posted pair counts once.
- Posted transactions use posted date and pending transactions use occurrence date for month assignment.
- Month-boundary tests pass for representative US timezones and daylight-saving transitions.
- Overspending produces negative availability without corrupting cent validation.

### Budgets and imports

- Both legacy budget scalars become default budget records with no `month` value.
- Migration does not invent monthly budget overrides.
- Duplicate CSV source IDs in different valid scopes do not collide.
- Duplicate source IDs within the same scope are rejected idempotently.
- Legacy imported transactions remain traceable without fabricated file or batch details.

### Ownership and deletion

- Local data is not assigned until the authenticated user confirms the import.
- A second user on the device cannot see or claim data already assigned to another user.
- Account deletion removes v2 data and the retained v1 rollback value.

## Release gate

The migration is ready when all acceptance tests pass, fixture totals remain exact, v1 rollback has been exercised on a physical device, and no code path trusts persisted JSON through a type assertion alone.
