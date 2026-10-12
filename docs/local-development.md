# Local development

## Requirements

- Node.js 22 LTS
- Docker Desktop
- npm

## Install workspaces

```powershell
cd D:\2026_Projects\spendingCompanion
npm install
npm run check
npm test
```

## Start PostgreSQL

```powershell
docker compose -f infra/compose.yaml up -d postgres
docker compose -f infra/compose.yaml ps
```

Copy `.env.example` to `.env` and replace placeholders with development credentials. `.env` files are ignored and must never be committed.

Backend secrets belong only in the root `.env`. For mobile live mode, create
`apps/mobile/.env` with only `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`EXPO_PUBLIC_API_URL`. A physical phone needs a reachable LAN/HTTPS API address;
`localhost` on a phone addresses the phone itself. Public mobile configuration
must never contain a Clerk secret, Plaid secret, access token, or encryption key.
See `docs/external-account-setup.md` when creating the required development accounts.

## Build and start the API

```powershell
npm run prisma:generate -w @spending-companion/persistence
npm run db:migrate
npm run build
npm run api:start
```

The root migration and API startup scripts load the root `.env` when present.
CI can supply `DATABASE_URL` directly. See `apps/api/README.md` for configuration.

Live database tests require an isolated database whose name ends in `_test` and
an explicit `TEST_DATABASE_URL`. Ordinary test runs must not be counted as proof
of PostgreSQL behavior when those integration tests are skipped.

## Stop services

```powershell
docker compose -f infra/compose.yaml stop
```

Stopping preserves the local database volume. Removing the volume is intentionally not part of routine instructions because it erases development data.
