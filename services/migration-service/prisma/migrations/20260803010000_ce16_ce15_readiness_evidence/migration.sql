-- CE-16 additive migration: CE-15 readiness evidence table.
--
-- Persists every real close-service readiness signal captured before cutover.
-- Evidence is immutable after capture. Stale evidence (capturedAt > 1 h old)
-- must not authorise cutover — enforced in application layer.
-- Removes the PENDING_UPSTREAM_TECHNICAL_RECONCILIATION marker for CE-15 only.

CREATE TABLE IF NOT EXISTS "ce15_readiness_evidence" (
  "id"                      TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"               TEXT        NOT NULL,
  "legal_entity_id"         TEXT        NOT NULL,
  "run_id"                  TEXT        NOT NULL,
  "period_year"             INTEGER     NOT NULL,
  "period_month"            INTEGER     NOT NULL,
  "close_state"             TEXT        NOT NULL,
  "previous_state"          TEXT,
  "close_version"           INTEGER,
  "transition_by"           TEXT,
  "transition_at"           TIMESTAMPTZ,
  "all_tasks_verified"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "has_unreconciled"        BOOLEAN     NOT NULL DEFAULT TRUE,
  "has_open_exceptions"     BOOLEAN     NOT NULL DEFAULT TRUE,
  "preliminary_closed"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "finally_closed"          BOOLEAN     NOT NULL DEFAULT FALSE,
  "reopen_pending"          BOOLEAN     NOT NULL DEFAULT FALSE,
  "approved"                BOOLEAN     NOT NULL DEFAULT FALSE,
  "upstream_signals"        JSONB       NOT NULL DEFAULT '[]',
  "raw_state_payload"       JSONB       NOT NULL DEFAULT '{}',
  "raw_readiness_payload"   JSONB       NOT NULL DEFAULT '{}',
  "certification_identity"  TEXT,
  "evidence_ref"            TEXT,
  "captured_at"             TIMESTAMPTZ NOT NULL,
  "captured_by"             TEXT        NOT NULL,
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ce15_readiness_evidence_run_idx"
  ON "ce15_readiness_evidence" ("tenant_id", "run_id", "captured_at" DESC);

CREATE INDEX IF NOT EXISTS "ce15_readiness_evidence_period_idx"
  ON "ce15_readiness_evidence" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "ce15_readiness_evidence" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ce15_readiness_evidence' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "ce15_readiness_evidence"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
