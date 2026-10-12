# App Store metadata draft

Last updated: 2026-10-11

This is the review-ready copy deck. Replace bracketed release values, complete legal review, and verify every statement against the exact signed build before submission.

## Product listing

- Name: Spending Companion
- Subtitle: Understand your monthly spending
- Primary category: Finance
- Secondary category: Utilities
- Age rating: 4+ unless App Store Connect's questionnaire produces a different result
- Copyright: © 2026 [legal owner]
- Support URL: [public HTTPS support URL]
- Privacy policy URL: [public HTTPS privacy URL]
- Marketing URL: [optional public product URL]

### Promotional text

Know what is left to spend this month, review pending purchases, and understand where your money goes.

### Description

Spending Companion helps US users understand monthly purchase spending without moving money or replacing their bank statement.

Connect supported checking and credit accounts through Plaid, or use manual entry and CSV import. See posted and pending purchases, budget availability, category and merchant breakdowns, and data freshness in one place.

You remain in control: choose which accounts count toward spending, correct categories and notes without changing bank source records, reconnect or disconnect institutions, export stored data, and delete the account in the app.

Spending Companion supports USD records in Version 1. It is a budgeting and transaction-understanding tool, not a bank, payment service, financial adviser, or accounting service.

### Keywords

budget,spending,transactions,expenses,money,monthly,bank,finance,tracker

## Screenshot plan

Use synthetic data only. Capture the exact release build at required App Store Connect dimensions.

1. Dashboard — available amount, posted/pending totals, category breakdown.
2. Monthly insights — merchant breakdown and utilities budget mode.
3. Activity — search and filter controls with synthetic transactions.
4. Bank connections — healthy synthetic Sandbox institution and freshness state.
5. Privacy controls — export and in-app deletion actions.

Do not show real names, email addresses, institutions, account masks, transaction history, request IDs, or notifications.

## Review notes draft

Spending Companion uses Plaid Link to connect financial institutions. Bank credentials are entered only in Plaid or the institution interface and are never received by the app.

Reviewer path:

1. Sign in with the dedicated review account: [review account instructions supplied privately in App Store Connect].
2. Open Banks and accept the financial-data consent.
3. Select Connect a US bank.
4. Use the configured Plaid Sandbox/review institution; no real bank credentials are required.
5. Return to Dashboard after synchronization.
6. Settings contains data export and permanent account deletion.

If Plaid review connectivity is unavailable, contact [monitored support address] and use the documented review fallback. Never place credentials in this repository or in review-note screenshots.

## App Privacy worksheet

Final answers must be reviewed against production vendors and the published policy. Expected Version 1 categories include:

- Contact info: email address, linked to identity, used for authentication/account management.
- Financial info: connected account metadata and transaction history, linked to identity, used for app functionality.
- Identifiers: internal account/session identifiers, linked to identity, used for functionality and security.
- Diagnostics: request/error metadata with financial fields and credentials excluded, used for reliability and security.

The app does not use data for third-party advertising or tracking. Confirm vendor SDK behavior and App Tracking Transparency applicability before submission.

## Submission placeholders

- [ ] Legal owner and copyright
- [ ] Published support, privacy, and terms URLs
- [ ] Dedicated review account/test path
- [ ] Final iPhone/iPad screenshot sizes required by App Store Connect
- [ ] Production vendor and privacy-label review
- [ ] Export-compliance answers
- [ ] Content-rights and age-rating questionnaires
- [ ] Signed build/version identifiers
