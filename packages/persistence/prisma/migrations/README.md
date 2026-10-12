# Migration setup

`schema.prisma` is the authoritative model. `202610090001_initial/migration.sql` is the generated deployable baseline. `202610090002_constraints/migration.sql` adds PostgreSQL checks and cross-row tenant triggers that Prisma schema syntax cannot express. Both are applied by `prisma migrate deploy`.

Required environment variable:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/spending_companion
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/spending_companion_persistence_test
```

Deployment must run `prisma migrate deploy`; production must never use `db push`. CI should start an empty PostgreSQL database, deploy all migrations, and run the repository and constraint integration suite.
