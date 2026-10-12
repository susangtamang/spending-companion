# PostgreSQL logical data model

## Identity and preferences

- `users`: internal UUID, identity provider, immutable issuer and subject, mutable email metadata, timezone, lifecycle and deletion-state timestamps.
- `user_preferences`: default budget mode and display preferences.
- `categories`: system/user category, stable slug, utilities flag, owner, lifecycle timestamps.
- `budgets`: user, mode (`including_utilities` or `excluding_utilities`), calendar month or default scope, amount cents, lifecycle timestamps. Exactly one row exists per user/mode/scope.

## Bank connections

- `plaid_items`: user, Plaid Item ID, institution, encrypted access token envelope, key version, sync cursor, health, consent expiration, sync timestamps, disconnection timestamp.
- `accounts`: user, Item, Plaid account ID, display name, mask, type/subtype, selected-for-budget flag, currency.
- `sync_runs`: Item, starting/ending cursor, state, counts, errors, timestamps.
- `webhook_receipts`: dedupe hash, Item, webhook type/code, received/processed timestamps.
- `deletion_jobs`: random operation ID, state, retry metadata, and timestamps while deletion is active.
- `deletion_tombstones`: random operation ID, final status, and timestamps only; no user, email, provider, Plaid, transaction, or payload identifiers.

## Transactions and user overlays

- `transactions`: user, account, source, scoped source ID, status, kind, USD cents, raw/display/normalized merchant, source category, occurrence/posted dates, pending/reconciled linkage, removal timestamp, source timestamps.
- `transaction_overrides`: transaction, user category, display merchant, note, update timestamp.
- `transaction_audit`: transaction, action, actor/source, before/after metadata, timestamp.

Source truth and user overrides remain separate so a Plaid modification does not erase a user's categorization.

## Imports

- `import_batches`: user, filename, status, format version, imported/undone timestamps, row counts.
- `import_rows`: batch, row number, source ID, raw record, validation state/errors, resulting transaction.

## Required constraints

- `(identity_provider, issuer, subject)` is unique; email is never an authorization key.
- Plaid Item ID and account ID are unique within their provider scope.
- Transaction source identity is unique within source connection/account scope.
- Monetary fields are integer database values with non-negative checks and application safe-integer validation.
- Currency is `USD` in Version 1.
- Every tenant-owned table carries or derives internal user ID. Compound constraints prevent cross-user account, category, transaction, import, budget, and reconciliation relationships.
- Reconciliation links cannot cross user or account boundaries.
- A sync cursor advances only with the full corresponding transaction update.
- Foreign-key deletion behavior follows the retention policy.

Repository operations require authenticated internal-user context rather than accepting ownership identifiers from request bodies. IDOR integration tests cover transactions, budgets, imports, Plaid Items/accounts, export, and deletion.

## Deletion state machine

1. Reauthenticate and create an idempotent deletion job.
2. Mark the user `deleting` and block normal access and new synchronization.
3. Retry Plaid `/item/remove` for every Item and purge token ciphertext after successful removal.
4. Delete tenant data and queued work while retaining only the minimum encrypted Clerk user identifier in the active deletion job.
5. Delete the Clerk identity and invalidate its sessions, then erase the encrypted identifier and provider linkage.
6. Replace the job with a non-identifying completion tombstone.

Provider outages leave the job retryable in a blocked state; they never skip token revocation silently. Tombstones contain only a random operation ID, state, and timestamps, expire after 90 days, and do not retain transaction audit, webhook payload, identity, or financial identifiers.

## Index priorities

- Transactions by user, occurrence/posted month, status, and kind.
- Transactions by account and scoped source ID.
- Transactions by pending source ID.
- Items by user and health.
- Budgets by user and month.
- Import batches by user and timestamp.

Physical types, indexes, and cascades will be encoded in migrations during Phase 2 and verified against this logical model.
