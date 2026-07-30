-- S026: schedule-service had no audit mechanism at all before this.
-- audit_outbox is a table shared physically across every service
-- (tenant-service/auth-service/coa-service/gl-service/apar-service all
-- `CREATE TABLE IF NOT EXISTS audit_outbox` with this identical shape;
-- whichever service's migration runs first in a given environment is the
-- one that actually creates it) — CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS throughout so this is a safe no-op wherever another service
-- already created/extended it.
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "doc_type"     TEXT NOT NULL,
  "doc_id"       TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT NOT NULL,
  "correlation_id" TEXT,
  "published_at" TIMESTAMP(3),
  "retry_count"  INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "audit_outbox" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
ALTER TABLE "audit_outbox" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "audit_outbox" ADD COLUMN IF NOT EXISTS "last_error" TEXT;

CREATE INDEX IF NOT EXISTS "audit_outbox_published_at_retry_count_idx"
  ON "audit_outbox" ("published_at", "retry_count");

-- audit_outbox is deliberately excluded from schedule-service's own RLS
-- migration (20260730010001) — same documented reason every other service
-- excludes it: AuditOutboxDrainer runs outside any per-request tenant
-- context. If another service already enabled RLS on this shared table, do
-- not disturb that here.
