-- CreateEnum
CREATE TYPE "UserState" AS ENUM ('ACTIVE', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "BudgetMode" AS ENUM ('INCLUDING_UTILITIES', 'EXCLUDING_UTILITIES');

-- CreateEnum
CREATE TYPE "ConnectionHealth" AS ENUM ('HEALTHY', 'SYNCING', 'REQUIRES_UPDATE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('PLAID', 'CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('PURCHASE', 'REFUND', 'PAYMENT', 'TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'UNDONE');

-- CreateEnum
CREATE TYPE "ImportRowState" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'IMPORTED');

-- CreateEnum
CREATE TYPE "SyncRunState" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeletionState" AS ENUM ('PENDING', 'PROCESSING', 'BLOCKED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "identity_provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "timezone" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "state" "UserState" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleting_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "default_budget_mode" "BudgetMode" NOT NULL DEFAULT 'INCLUDING_UTILITIES',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_utility" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" "BudgetMode" NOT NULL,
    "month" CHAR(7),
    "scope_key" TEXT NOT NULL DEFAULT 'default',
    "amount_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plaid_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_item_id" TEXT NOT NULL,
    "institution_id" TEXT,
    "institution_name" TEXT NOT NULL,
    "encrypted_access_token" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "sync_cursor" TEXT,
    "health" "ConnectionHealth" NOT NULL DEFAULT 'HEALTHY',
    "consent_version" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "consent_expires_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plaid_item_id" UUID NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "official_name" TEXT,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "include_in_spending" BOOLEAN NOT NULL DEFAULT true,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "source" "TransactionSource" NOT NULL,
    "source_scope" TEXT NOT NULL,
    "source_transaction_id" TEXT,
    "status" "TransactionStatus" NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "raw_merchant" TEXT,
    "display_merchant" TEXT NOT NULL,
    "normalized_merchant" TEXT NOT NULL,
    "source_category_id" UUID,
    "occurrence_date" DATE NOT NULL,
    "posted_date" DATE,
    "pending_source_transaction_id" TEXT,
    "reconciled_to_transaction_id" UUID,
    "removed_at" TIMESTAMP(3),
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_overrides" (
    "transaction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "display_merchant" TEXT,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_overrides_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "transaction_audit" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "format_version" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "source_id" TEXT,
    "raw_record" JSONB NOT NULL,
    "state" "ImportRowState" NOT NULL,
    "errors" JSONB,
    "transaction_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "plaid_item_id" UUID NOT NULL,
    "starting_cursor" TEXT,
    "ending_cursor" TEXT,
    "state" "SyncRunState" NOT NULL,
    "added_count" INTEGER NOT NULL DEFAULT 0,
    "modified_count" INTEGER NOT NULL DEFAULT 0,
    "removed_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_receipts" (
    "id" UUID NOT NULL,
    "dedupe_hash" TEXT NOT NULL,
    "plaid_item_id" UUID,
    "webhook_type" TEXT NOT NULL,
    "webhook_code" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "state" "DeletionState" NOT NULL,
    "encrypted_identity" BYTEA,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "deletion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_tombstones" (
    "operation_id" UUID NOT NULL,
    "state" "DeletionState" NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deletion_tombstones_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body_fingerprint" TEXT NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_provider_issuer_subject_key" ON "users"("identity_provider", "issuer", "subject");

-- CreateIndex
CREATE INDEX "categories_user_id_archived_at_idx" ON "categories"("user_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_slug_key" ON "categories"("user_id", "slug");

-- CreateIndex
CREATE INDEX "budgets_user_id_month_idx" ON "budgets"("user_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_user_id_mode_scope_key_key" ON "budgets"("user_id", "mode", "scope_key");

-- CreateIndex
CREATE INDEX "plaid_items_user_id_health_idx" ON "plaid_items"("user_id", "health");

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_user_id_provider_item_id_key" ON "plaid_items"("user_id", "provider_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_id_user_id_key" ON "plaid_items"("id", "user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_include_in_spending_idx" ON "accounts"("user_id", "include_in_spending");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_provider_account_id_key" ON "accounts"("user_id", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_user_id_key" ON "accounts"("id", "user_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_occurrence_date_posted_date_status_kin_idx" ON "transactions"("user_id", "occurrence_date", "posted_date", "status", "kind");

-- CreateIndex
CREATE INDEX "transactions_account_id_source_transaction_id_idx" ON "transactions"("account_id", "source_transaction_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_account_id_pending_source_transaction__idx" ON "transactions"("user_id", "account_id", "pending_source_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_user_id_source_source_scope_source_transaction_key" ON "transactions"("user_id", "source", "source_scope", "source_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_id_user_id_key" ON "transactions"("id", "user_id");

-- CreateIndex
CREATE INDEX "transaction_overrides_user_id_idx" ON "transaction_overrides"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_overrides_transaction_id_user_id_key" ON "transaction_overrides"("transaction_id", "user_id");

-- CreateIndex
CREATE INDEX "transaction_audit_transaction_id_created_at_idx" ON "transaction_audit"("transaction_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_user_id_created_at_idx" ON "import_batches"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_id_user_id_key" ON "import_batches"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE INDEX "sync_runs_plaid_item_id_created_at_idx" ON "sync_runs"("plaid_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipts_dedupe_hash_key" ON "webhook_receipts"("dedupe_hash");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_jobs_user_id_idempotency_key_key" ON "deletion_jobs"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deletion_tombstones_expires_at_idx" ON "deletion_tombstones"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_key_key" ON "idempotency_records"("user_id", "key");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_user_id_fkey" FOREIGN KEY ("plaid_item_id", "user_id") REFERENCES "plaid_items"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_category_id_fkey" FOREIGN KEY ("source_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciled_to_transaction_id_fkey" FOREIGN KEY ("reconciled_to_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_overrides" ADD CONSTRAINT "transaction_overrides_transaction_id_user_id_fkey" FOREIGN KEY ("transaction_id", "user_id") REFERENCES "transactions"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_overrides" ADD CONSTRAINT "transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_audit" ADD CONSTRAINT "transaction_audit_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_plaid_item_id_fkey" FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_plaid_item_id_fkey" FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_jobs" ADD CONSTRAINT "deletion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
