# ADR 0001: Bank disconnection and data retention

Status: Accepted

## Decision

Disconnecting a bank and deleting a Spending Companion account are separate operations.

When disconnecting a bank, the user must choose one of two clearly explained options:

1. Disconnect and retain imported transaction history.
2. Disconnect and delete that connection's imported transactions.

Both options call Plaid `/item/remove`, stop synchronization and billing, purge the encrypted Plaid access token, and retain only a non-sensitive audit result required to demonstrate completion.

Deleting a Spending Companion account follows a durable, retryable state machine: reauthenticate; block normal access; remove every Plaid Item and purge token ciphertext; erase tenant data and queued artifacts; delete the Clerk identity; then retain only a non-identifying completion tombstone for 90 days. Provider outages pause and retry deletion rather than skipping cleanup. An export is offered before final confirmation.

## Rationale

Users may want historical budgeting data after changing banks, but disconnecting access must never leave a usable provider token behind. Making the choice explicit avoids surprising data loss or retention.

## Consequences

- Disconnect UI and API require an explicit history policy.
- Retained records are labeled disconnected and cannot silently resume synchronization.
- Account deletion remains comprehensive regardless of earlier disconnect choices.
- The public privacy and retention policy must specify operational deletion timing and narrowly defined backup expiration.
- The completion tombstone contains only a random operation ID, status, and timestamps; it never contains email, identity-provider subject, Plaid IDs, transactions, webhook payloads, or token material.
