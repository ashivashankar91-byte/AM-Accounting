-- R0 Stabilization Phase 4: support retry/backoff and non-silent failure
-- for the audit outbox drainer. Additive-only.
ALTER TABLE "audit_outbox" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "audit_outbox" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
CREATE INDEX IF NOT EXISTS "audit_outbox_published_at_retry_count_idx"
  ON "audit_outbox" ("published_at", "retry_count");
