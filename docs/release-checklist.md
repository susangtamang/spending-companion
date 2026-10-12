# TestFlight and App Store release checklist

## External prerequisites

- Clerk development and production instances configured with email verification and Native API.
- Plaid Sandbox gate passed, then Trial/live-account behavior tested and Production access approved.
- Expo/EAS project linked to this app.
- Active Apple Developer membership, App Store Connect application, distribution certificate, and provisioning profile.
- Final HTTPS API, webhook, privacy policy, terms, and support URLs.
- Production KMS, database, secret manager, backups, monitoring, alert routing, and incident contacts.

## Build configuration

- Bundle identifier: `com.susang.spendingcompanion` (confirm ownership before first upload).
- Scheme: `spendingcompanion`.
- Minimum supported iOS version must satisfy Plaid Link's current requirement.
- Configure the final Plaid OAuth redirect URI and associated domain/Universal Link in Plaid, Apple, and the app before the signed OAuth test.
- Build with the `production` EAS profile; never put backend secrets in EAS `EXPO_PUBLIC_*` variables.
- Archive the dependency audit, Expo Doctor output, migration version, commit identifier, and calculation fixture results with the build.

## Internal device matrix

- Minimum supported iPhone/iOS and current iPhone/iOS.
- Small and large screens; default and largest accessibility text sizes; VoiceOver.
- Wi-Fi, cellular, slow network, offline launch, interrupted Link/OAuth, app background/foreground, and expired session.
- Representative Android phone for compatibility even though iOS is first.

## Required end-to-end acceptance

- Email-code account creation, sign-in, sign-out, recovery, and session restoration.
- Consent, Plaid Sandbox/Trial connection, OAuth return, account selection, full initial sync, webhook incremental sync, manual refresh, update mode, and disconnect with each history choice.
- Posted/pending/month totals and breakdown reconciliation against known fixtures.
- Manual create/edit/delete, CSV preview/errors/duplicates/commit/history/undo, and reconciliation confirmation/rejection.
- Budget defaults/overrides, category overrides, stale/offline/error/empty/loading states.
- Authenticated export and permanent deletion, including failed Plaid removal retry.
- Confirm no secret/token appears in the mobile bundle, API response, structured log, crash report, screenshot, or clipboard.

## App Store material

- Final name, subtitle, description, keywords, category, copyright, age rating, and support/marketing URLs.
- Screenshots for every required device size using synthetic data only.
- App Privacy answers reviewed against the published policy and actual vendors/data flows.
- Review notes explain Plaid Link, provide a dedicated review account/test path, and state that no real bank credentials are needed.
- In-app account deletion and export are visible to the reviewer.

## Release decision

Release only when the phase ledger shows every gate complete, the exact signed build passes the matrix, rollback is rehearsed, dashboards/alerts are live, and product/security/legal owners record approval.
