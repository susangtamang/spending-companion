# Spending Companion progress

Last updated: 2026-10-11

The approved US-only Version 1 scope and multi-agent delivery sequence are documented in `docs/project-plan.md`.
Live phase execution is tracked in `docs/phase-status.md`.

## Current state

- Expo TypeScript app implemented in `apps/mobile`, with an explicit sample-data mode and authenticated live mode.
- Posted, pending, spent, and available amounts use integer-cent calculations.
- Domain calculations have automated tests for totals and invalid cent values.
- Manual transaction entry validates required fields and parses USD input into integer cents.
- Live transactions, edits, deletions, account inclusion, budgets, categories, imports, and reconciliation are API-backed.
- Dashboard supports budget views including and excluding utilities.
- CSV preview validates one documented format and skips duplicate source IDs.
- Pending purchases require an explicit user action before becoming posted.
- User and demo instructions are documented in `docs/user-guide.md` and `docs/demo.md`.
- Users can browse calendar months and edit or delete transactions with confirmation.
- Shared contracts, authoritative domain calculations, CSV planning, and reconciliation packages are implemented and verified (Phases 0-1).
- NestJS, Clerk verification, PostgreSQL persistence, tenant isolation, imports, reconciliation, summaries, and persistent idempotency have passed the Phase 2 integration gate.
- Plaid provider code and durable orchestration are implemented and locally tested; the live Sandbox gate still requires real Plaid credentials.
- Mobile authentication, API-backed screens, Plaid Link preparation, export, deletion, budgets, and categories are implemented; the signed physical-device journey remains the Phase 4 gate.
- Privacy and operational work includes export/deletion integration, sanitized logging, readiness, protected metrics, policies, runbooks, and a local backup/restore drill. Production monitoring, hosted backups, published URLs, and security-review closure remain outstanding.
- The complete local test gate passes 111 tests; all workspace TypeScript checks and builds pass; Expo Doctor passes 21/21 checks.
- Original branded icon, adaptive foreground, and splash assets are configured without retaining Expo's placeholder branding.
- CI configuration now reproduces migrations, checks, builds, 111 tests, Expo Doctor, and the critical dependency gate when the project is placed in a GitHub repository.
- App Store listing copy, screenshot plan, privacy worksheet, and review-note placeholders are documented in `docs/app-store-metadata.md`.

## Local development

Use Node 22 LTS. Node 23 is outside the supported engine range of the current React Native toolchain.

```powershell
cd apps/mobile
npm install
npm run check
npm start
```

## Next slice

Complete the live Plaid Sandbox and signed physical-device gates, then close the remaining production privacy, monitoring, backup, and dependency-review evidence.
