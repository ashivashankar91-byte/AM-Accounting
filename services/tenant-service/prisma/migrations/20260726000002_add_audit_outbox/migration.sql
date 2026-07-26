-- R0 Stabilization Phase 4: tenant-service had no audit mechanism at all
-- (not even a stub) — this table did not exist before. Additive-only.
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "doc_type"     TEXT NOT NULL,
  "doc_id"       TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT NOT NULL,
  "published_at" TIMESTAMP(3),
  "retry_count"  INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_outbox_published_at_retry_count_idx"
  ON "audit_outbox" ("published_at", "retry_count");
