# Spending Companion Web Plan

## Goal

Run Spending Companion in a desktop browser with the same core transaction experience as mobile, including Clerk authentication, manual transactions, CSV import, spending summaries, and Plaid Link Web for US bank connections.

## Work packages

### 1. Web baseline

- Confirm the Expo Router web entry point builds and loads in a browser.
- Audit native-only imports, permissions, storage, navigation, and styling.
- Add platform-safe fallbacks for camera, native Plaid Link, and mobile-only UI.
- Define the web API base URL and local HTTPS/development configuration.

### 2. Authentication

- Verify Clerk sign-in, sign-up, sign-out, session restoration, and protected routes on web.
- Confirm the web publishable key is supplied only through `EXPO_PUBLIC_*` environment configuration.
- Test refresh, expired sessions, and unauthenticated redirects.

### 3. Plaid Link Web

- Add the browser Plaid Link integration without replacing the native iOS/Android path.
- Request link tokens from the existing backend and exchange public tokens server-side.
- Handle success, cancel, exit, institution errors, reconnect, and duplicate-item states.
- Verify that access tokens and secrets never enter browser storage or logs.

### 4. Transaction experience

- Reuse the transaction list, filters, totals, manual entry, and CSV import components.
- Make tables, forms, empty states, loading states, and errors responsive for desktop and narrow browser widths.
- Verify server-backed data is scoped to the authenticated user.

### 5. Testing

- Add web-focused unit/component tests for platform branching and Plaid callbacks.
- Run TypeScript checks and the existing API/package tests.
- Test Chrome and Safari at desktop and mobile viewport sizes.
- Complete a Sandbox flow: sign in, link a test institution, sync transactions, refresh, disconnect, and reconnect.

### 6. Deployment

- Choose the web host and configure production HTTPS.
- Set Clerk production and Plaid production environment variables through the host secret manager.
- Configure allowed origins, redirect URLs, privacy/terms/support URLs, and Plaid webhook URL.
- Add a CI build check and document local and production web commands.

## Completion criteria

- `npm run web` (or the documented equivalent) loads the app without native-module errors.
- A user can authenticate, add/import transactions, view totals, and sign out in a browser.
- Plaid Sandbox Link Web completes successfully and transactions sync through the backend.
- No secret, access token, or credential is shipped to browser code or committed to Git.
- Web checks pass in CI and the demo flow is documented.

## Suggested sequence

1. Web baseline and platform guards
2. Clerk web verification
3. Responsive transaction screens
4. Plaid Link Web
5. Browser/Sandbox testing
6. HTTPS deployment and production configuration

