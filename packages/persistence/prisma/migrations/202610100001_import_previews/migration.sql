ALTER TABLE "import_batches"
  ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "import_context" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour');

CREATE INDEX "import_batches_user_id_expires_at_idx" ON "import_batches"("user_id", "expires_at");
