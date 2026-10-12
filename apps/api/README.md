# Spending Companion API

Build and start from this directory with Node 22:

```powershell
npm run build
npm start
```

`npm start` loads `../../.env` when it exists. Production startup requires `DATABASE_URL`, `CLERK_ISSUER`, and either `CLERK_JWT_KEY` (preferred) or `CLERK_SECRET_KEY`; it fails closed without them and never prints their values. `API_USE_IN_MEMORY=true` is reserved for local automated tests and must not be used for deployed environments.

Apply the PostgreSQL migration and generate the Prisma client through `packages/persistence` before startup. Plaid routes intentionally return `501 not_configured` until Phase 3.
