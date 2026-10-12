# Spending Companion privacy policy (release draft)

Last updated: 2026-10-10

Spending Companion uses the financial accounts a user explicitly connects to show spending transactions, budgets, and summaries. Bank authentication occurs in Plaid or the financial institution interface; Spending Companion does not receive the user's bank password.

We store the user's account identity, preferences, budgets, categories, connected-account metadata, imported transactions, user corrections, CSV import history, consent records, synchronization state, and security/audit records needed to operate the service. Plaid access tokens are encrypted and remain on the backend. Version 1 supports United States institutions and USD records only.

We use this information to provide the requested product, synchronize connected accounts, prevent duplicate processing, secure accounts, diagnose failures, and meet legal obligations. We do not sell personal or financial data. Service providers such as the authentication, bank-connectivity, hosting, database, monitoring, and email vendors process only the data required for their role under appropriate agreements.

Users can export stored data, disconnect an institution while choosing whether imported transaction history is retained or deleted, or permanently delete the Spending Companion account in the app. Account deletion first asks Plaid to remove active Items, then removes user data and stores only a one-way identity tombstone needed to prevent accidental reprovisioning and replay. Operational backups expire under the backup schedule and are not restored selectively for ordinary product use.

Data is protected in transit, tenant-scoped by authenticated user ID, and subject to least-privilege access. No security system is perfect; suspected incidents should be reported through the support contact published with the release.

This draft must receive legal review and be published at the final public privacy URL before external TestFlight testing.
