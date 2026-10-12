# Operations runbook

## Health and monitoring

- `GET /health` proves the HTTP process is alive.
- `GET /ready` proves PostgreSQL is reachable.
- `GET /internal/metrics` exposes request counts and in-flight work only when `Authorization: Bearer <OPERATIONS_TOKEN>` matches the server secret.
- Set `STRUCTURED_LOGGING=true` outside tests. Request logs contain only request ID, method, normalized path, status, and duration. Bodies, query strings, authorization headers, Clerk tokens, Plaid tokens, merchants, amounts, and institution data are deliberately excluded.

Alert when readiness fails for two consecutive minutes, HTTP 5xx exceeds 2% for five minutes, a sync remains `RUNNING` for ten minutes, a deletion is `BLOCKED`, or no successful database backup has completed within 25 hours.

## Backup policy

- Use encrypted PostgreSQL custom-format backups at least daily.
- Store backups in a separate encrypted account/bucket with versioning and access logging.
- Keep daily backups for 35 days and monthly backups for 12 months, subject to the published deletion policy.
- Restrict restore and delete permissions to the operations role; the API runtime must not have backup-administration permissions.
- Test a restore into an isolated database at least monthly and record the migration count, table count, restore duration, and operator.

## Local restore drill

The target must be exactly `spending_companion_restore_test`; never use the development or production database as a restore target.

```powershell
docker compose -f infra/compose.yaml exec -T postgres sh -c "pg_dump -U spending_companion -Fc spending_companion > /tmp/spending_companion_restore_test.dump"
docker compose -f infra/compose.yaml exec -T postgres dropdb -U spending_companion --if-exists spending_companion_restore_test
docker compose -f infra/compose.yaml exec -T postgres createdb -U spending_companion spending_companion_restore_test
docker compose -f infra/compose.yaml exec -T postgres pg_restore -U spending_companion -d spending_companion_restore_test /tmp/spending_companion_restore_test.dump
docker compose -f infra/compose.yaml exec -T postgres psql -U spending_companion -d spending_companion_restore_test -c "SELECT count(*) AS migrations FROM _prisma_migrations WHERE finished_at IS NOT NULL;"
```

After recording the result, the isolated restore database may be removed with:

```powershell
docker compose -f infra/compose.yaml exec -T postgres dropdb -U spending_companion --if-exists spending_companion_restore_test
```

## Incident response

1. Stop the affected deployment or disable Plaid synchronization without deleting evidence.
2. Rotate exposed Clerk, Plaid, database, monitoring, and encryption credentials as applicable.
3. Preserve sanitized request IDs, provider request IDs, timestamps, deployment version, and audit records. Never paste tokens into tickets or chat.
4. Determine affected users and data classes, follow legal notification timelines, and document decisions.
5. Restore service from a verified build and backup, verify tenant isolation and totals, then monitor elevated error rates.
6. Publish a blameless review with corrective actions and owners.

## Plaid outage

Keep existing data readable, mark freshness as stale, retain queued sync jobs, and retry with bounded backoff. Do not advance cursors after a partial sync. Manual entry and CSV fallback remain available. Never repeatedly call `/item/remove`; blocked deletion stays retryable.
