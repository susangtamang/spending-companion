# Spending Companion user guide

Spending Companion shows how much of a monthly budget remains and where purchase spending is going. Version 1 is US-only and accepts USD records only.

## Choose a mode

### Sample-data demo

The demo needs no Clerk or Plaid account and can run in Expo Go. Set `EXPO_PUBLIC_DEMO_MODE=true` in `apps/mobile/.env`, run `npm start` from `apps/mobile`, and open the displayed Expo URL in Expo Go. The yellow demo banner means displayed information is synthetic and is not connected to a bank.

### Live development mode

Live mode requires the backend, PostgreSQL, a Clerk development instance, Plaid Sandbox credentials, and a custom Expo development build. Plaid Link cannot run in Expo Go because it contains native code. Follow `docs/local-development.md` and `docs/external-account-setup.md`. Never place Clerk secret keys, Plaid secrets, access tokens, or encryption keys in the mobile `.env` file.

## Sign in

In live mode, enter an email address in Clerk's sign-in screen and complete the email verification code. The session is stored using the platform's encrypted secure storage. Sign out from Settings.

## Dashboard

The Dashboard loads authoritative server calculations for the current calendar month:

- Available is the selected budget minus eligible posted and unreconciled pending purchases.
- Posted and Pending show the two active purchase totals.
- Category and merchant rows reconcile to the same eligible records as the headline total.
- A stale warning means bank data may need a refresh.

Pull down to refresh. Refunds, payments, transfers, cash movements, removed records, and replaced pending records do not reduce the purchase budget.
Use **Previous** and **Next** to browse months, and switch between budgets that include or exclude utilities.

## Connect and maintain a bank

1. Open Banks, review the financial-data explanation, and enable the consent switch.
2. Select **Connect a US bank**. Bank credentials are entered only in Plaid or the institution interface.
3. Complete Plaid Link. The backend exchanges the temporary token, encrypts the access token, queues an initial sync, and refreshes the connection list.
4. Use **Sync now** for a manual refresh.
5. If the connection says `requires update`, select **Reconnect** and finish Plaid update mode.
6. To disconnect, choose whether to retain or delete imported history. Both choices remove the Plaid Item and stop future synchronization/billing.

Only checking and credit behavior is part of the initial spending scope. Non-USD accounts or transactions are rejected with an explanation.

## Activity and manual transactions

Activity lists live transactions with date, source, status, and amount. Pull down to refresh.

To add a manual purchase, select **Add manual transaction**, enter the merchant, non-negative USD amount, and date in `YYYY-MM-DD`, then save. Open a transaction to change its display merchant, category, or note. Only manually entered transactions can be deleted; Plaid and CSV source records retain their audit history.

## Import a CSV file

1. Open Activity and select **Import CSV**.
2. Choose a file with the exact header below.
3. Review ready, duplicate, and invalid row counts and correct any errors.
4. Select **Confirm import**. Nothing is committed during preview.

```text
sourceId,date,merchant,amount,status,category,kind
```

Example:

```csv
sourceId,date,merchant,amount,status,category,kind
bank-1001,2026-10-09,Neighborhood Market,63.24,posted,groceries,purchase
bank-1002,2026-10-09,"Corner Cafe, Inc.",8.75,pending,dining,purchase
```

Supported statuses are `posted` and `pending`. Supported kinds are `purchase`, `refund`, `payment`, `transfer`, and `cash`. A source ID is deduplicated within its user/account/import scope. Committed batches appear under **CSV import history**, where they can be atomically undone.

## Budgets and categories

Settings shows the default monthly budget including utilities. Enter dollars and cents and select **Save budget**. The built-in defaults are $2,500 including utilities and $1,700 excluding utilities until the user saves replacements. Add personal categories in Settings and mark stable utility categories with the utility switch.

## Export data

Select **Export and share my data** in Settings. The backend creates a tenant-scoped export with an expiring authenticated download, and the phone opens its share sheet. Do not send an export through an untrusted app because it contains financial history.

## Delete the account

Select **Delete account**, read the warning, and confirm. The app sends a current verified identity token and the literal `DELETE` confirmation. The backend removes every active Plaid Item first, then deletes transactions, budgets, categories, imports, tokens, jobs, sessions, and the user. A one-way non-financial tombstone prevents the deleted identity from being silently recreated. If Plaid removal fails, deletion is marked blocked and can be retried.

## Troubleshooting

- QR says “no usable data”: start Expo with a LAN or tunnel address reachable by the phone; a manifest containing `127.0.0.1` works only on the development computer.
- Plaid is unavailable: use a custom development build, not Expo Go, and verify that backend-only Sandbox variables are configured.
- API is unreachable on a phone: `localhost` refers to the phone; use the computer's LAN address or HTTPS endpoint in `EXPO_PUBLIC_API_URL`.
- Totals look old: pull to refresh, open Banks and sync, then check the freshness line.
- A request fails: record the on-screen request ID and approximate time, but never send passwords, codes, tokens, or a full statement.

## Developer verification

From the repository root, start PostgreSQL, apply migrations, then run the checks documented in `docs/local-development.md`. Live Plaid and signed-device gates remain separate and must be recorded in `docs/phase-status.md` rather than inferred from unit tests.
