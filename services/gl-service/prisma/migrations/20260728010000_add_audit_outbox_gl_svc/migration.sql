-- GL-service onboarding: add the shared S007 audit_outbox table shape so this
-- legacy service can emit real audit events and drain them to audit-service.
-- Shared table name / column contract matches auth-service, tenant-service and
-- coa-service; IF NOT EXISTS keeps this safe on the shared live database where
-- another service may already have created the table first.

CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "doc_type" TEXT NOT NULL,
  "doc_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "actor" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "audit_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_outbox_published_at_retry_count_idx"
  ON "audit_outbox" ("published_at", "retry_count");
