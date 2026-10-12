CREATE TABLE "plaid_link_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "consent_version" TEXT NOT NULL,
  "consented_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "link_token_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plaid_link_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plaid_link_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "plaid_link_sessions_user_id_expires_at_idx" ON "plaid_link_sessions"("user_id", "expires_at");

ALTER TABLE "plaid_items"
  ALTER COLUMN "key_version" TYPE TEXT USING "key_version"::text,
  ADD COLUMN "disconnect_history_policy" TEXT,
  ADD COLUMN "token_purged_at" TIMESTAMP(3),
  ADD CONSTRAINT "plaid_items_history_policy" CHECK (
    "disconnect_history_policy" IS NULL
    OR "disconnect_history_policy" IN ('retain_history', 'delete_history')
  );

ALTER TABLE "sync_runs"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD CONSTRAINT "sync_runs_attempt_count_nonnegative" CHECK ("attempt_count" >= 0);

ALTER TABLE "webhook_receipts"
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "verification_key_id" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processing_error_code" TEXT,
  ADD CONSTRAINT "webhook_receipts_attempt_count_nonnegative" CHECK ("attempt_count" >= 0);
