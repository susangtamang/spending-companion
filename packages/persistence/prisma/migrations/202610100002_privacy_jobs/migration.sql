ALTER TABLE "deletion_tombstones" ADD COLUMN "identity_hash" TEXT;
UPDATE "deletion_tombstones" SET "identity_hash" = "operation_id"::text WHERE "identity_hash" IS NULL;
ALTER TABLE "deletion_tombstones" ALTER COLUMN "identity_hash" SET NOT NULL;
CREATE UNIQUE INDEX "deletion_tombstones_identity_hash_key" ON "deletion_tombstones"("identity_hash");

CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "format" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "export_jobs_user_id_created_at_idx" ON "export_jobs"("user_id", "created_at");
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs"("expires_at");
