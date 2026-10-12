-- Prisma creates the tables, enums, indexes, and foreign keys declared in
-- schema.prisma. These PostgreSQL-only constraints supplement that generated
-- baseline and are intentionally kept as explicit SQL.

ALTER TABLE "users"
  ADD CONSTRAINT "users_currency_usd" CHECK ("currency_code" = 'USD');

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_system_owner" CHECK (
    ("is_system" AND "user_id" IS NULL AND "archived_at" IS NULL)
    OR (NOT "is_system" AND "user_id" IS NOT NULL)
  );

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_nonnegative_cents" CHECK ("amount_cents" >= 0),
  ADD CONSTRAINT "budgets_month_format" CHECK ("month" IS NULL OR "month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "budgets_scope_consistent" CHECK (
    ("month" IS NULL AND "scope_key" = 'default') OR "scope_key" = "month"
  );

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_currency_usd" CHECK ("currency_code" = 'USD');

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_nonnegative_cents" CHECK ("amount_cents" >= 0),
  ADD CONSTRAINT "transactions_currency_usd" CHECK ("currency_code" = 'USD'),
  ADD CONSTRAINT "transactions_posted_date" CHECK ("status" <> 'POSTED' OR "posted_date" IS NOT NULL),
  ADD CONSTRAINT "transactions_reconciliation_not_self" CHECK (
    "reconciled_to_transaction_id" IS DISTINCT FROM "id"
  );

ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_counts_nonnegative" CHECK (
    "total_rows" >= 0 AND "imported_rows" >= 0 AND "duplicate_rows" >= 0 AND "invalid_rows" >= 0
  ),
  ADD CONSTRAINT "import_batches_counts_bounded" CHECK (
    "imported_rows" + "duplicate_rows" + "invalid_rows" <= "total_rows"
  );

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_positive_row" CHECK ("row_number" > 0);

ALTER TABLE "sync_runs"
  ADD CONSTRAINT "sync_runs_counts_nonnegative" CHECK (
    "added_count" >= 0 AND "modified_count" >= 0 AND "removed_count" >= 0
  );

ALTER TABLE "deletion_jobs"
  ADD CONSTRAINT "deletion_jobs_retry_nonnegative" CHECK ("retry_count" >= 0);

-- Enforce same-tenant category overrides, including system categories (owner NULL).
CREATE OR REPLACE FUNCTION enforce_override_category_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = NEW.category_id AND (c.is_system OR c.user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'category override crosses tenant boundary';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_overrides_category_tenant
BEFORE INSERT OR UPDATE ON transaction_overrides
FOR EACH ROW EXECUTE FUNCTION enforce_override_category_tenant();

-- Self-referential Prisma relations cannot express compound user/account checks.
CREATE OR REPLACE FUNCTION enforce_reconciliation_tenant_account() RETURNS trigger AS $$
DECLARE
  related transactions%ROWTYPE;
BEGIN
  IF NEW.reconciled_to_transaction_id IS NOT NULL THEN
    SELECT * INTO related FROM transactions WHERE id = NEW.reconciled_to_transaction_id;
    IF related.user_id IS DISTINCT FROM NEW.user_id OR related.account_id IS DISTINCT FROM NEW.account_id THEN
      RAISE EXCEPTION 'reconciliation crosses tenant or account boundary';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_reconciliation_tenant_account
BEFORE INSERT OR UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION enforce_reconciliation_tenant_account();
