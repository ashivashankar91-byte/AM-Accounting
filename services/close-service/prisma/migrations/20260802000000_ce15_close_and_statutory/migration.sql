-- CE-15 Close & Statutory epic — additive migration.
-- Creates all close-service tables with RLS, indexes, and unique constraints.
-- All tables are additive (CREATE TABLE IF NOT EXISTS). No existing table modified.
-- Monetary columns: NUMERIC(15,2) throughout per AMACC convention.

-- ── Close period state machine ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "close_period_states" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "period_year"      INTEGER     NOT NULL,
  "period_month"     INTEGER     NOT NULL,
  "state"            TEXT        NOT NULL DEFAULT 'NOT_READY',
  "previous_state"   TEXT,
  "transition_by"    TEXT,
  "transition_at"    TIMESTAMPTZ,
  "transition_reason" TEXT,
  "version"          INTEGER     NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "close_period_states_tenant_entity_period_key"
    UNIQUE ("tenant_id", "legal_entity_id", "period_year", "period_month")
);
CREATE INDEX IF NOT EXISTS "close_period_states_tenant_entity_idx"
  ON "close_period_states" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "close_period_states_state_idx"
  ON "close_period_states" ("tenant_id", "state");

ALTER TABLE "close_period_states" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'close_period_states' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "close_period_states"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Close tasks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "close_tasks" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "period_year"      INTEGER     NOT NULL,
  "period_month"     INTEGER     NOT NULL,
  "template_code"    TEXT        NOT NULL,
  "title"            TEXT        NOT NULL,
  "description"      TEXT,
  "owner_id"         TEXT,
  "due_offset"       INTEGER     NOT NULL DEFAULT 0,
  "due_date_actual"  TIMESTAMPTZ,
  "status"           TEXT        NOT NULL DEFAULT 'OPEN',
  "priority"         TEXT        NOT NULL DEFAULT 'NORMAL',
  "is_mandatory"     BOOLEAN     NOT NULL DEFAULT TRUE,
  "depends_on_ids"   JSONB       NOT NULL DEFAULT '[]',
  "escalation_config" JSONB      NOT NULL DEFAULT '{}',
  "completed_at"     TIMESTAMPTZ,
  "completed_by"     TEXT,
  "verified_at"      TIMESTAMPTZ,
  "verified_by"      TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "close_tasks_period_idx"
  ON "close_tasks" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "close_tasks_status_idx"
  ON "close_tasks" ("tenant_id", "status");

ALTER TABLE "close_tasks" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'close_tasks' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "close_tasks"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Close task evidence ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "close_task_evidence" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"     TEXT        NOT NULL,
  "close_task_id" TEXT        NOT NULL,
  "file_name"     TEXT        NOT NULL,
  "file_ref"      TEXT        NOT NULL,
  "uploaded_by"   TEXT        NOT NULL,
  "uploaded_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "content_hash"  TEXT        NOT NULL,
  CONSTRAINT "fk_close_task_evidence_task"
    FOREIGN KEY ("close_task_id") REFERENCES "close_tasks" ("id")
);
CREATE INDEX IF NOT EXISTS "close_task_evidence_task_idx"
  ON "close_task_evidence" ("close_task_id");
CREATE INDEX IF NOT EXISTS "close_task_evidence_tenant_idx"
  ON "close_task_evidence" ("tenant_id");

ALTER TABLE "close_task_evidence" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'close_task_evidence' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "close_task_evidence"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Exception override log (SoD enforcement) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "exception_overrides" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "legal_entity_id" TEXT       NOT NULL,
  "period_year"    INTEGER     NOT NULL,
  "period_month"   INTEGER     NOT NULL,
  "finding_id"     TEXT        NOT NULL,
  "overridden_by"  TEXT        NOT NULL,
  "reason"         TEXT        NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "exception_overrides_period_idx"
  ON "exception_overrides" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "exception_overrides_by_idx"
  ON "exception_overrides" ("tenant_id", "overridden_by");

ALTER TABLE "exception_overrides" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exception_overrides' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "exception_overrides"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Reconciliation register ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reconciliation_register" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "period_year"      INTEGER     NOT NULL,
  "period_month"     INTEGER     NOT NULL,
  "module_code"      TEXT        NOT NULL,
  "account_code"     TEXT        NOT NULL,
  "status"           TEXT        NOT NULL DEFAULT 'UNRECONCILED',
  "is_mandatory"     BOOLEAN     NOT NULL DEFAULT TRUE,
  "preparer_id"      TEXT,
  "reviewer_id"      TEXT,
  "tie_evidence_ref" TEXT,
  "prepared_at"      TIMESTAMPTZ,
  "reviewed_at"      TIMESTAMPTZ,
  "signed_at"        TIMESTAMPTZ,
  "notes"            TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "recon_register_unique"
    UNIQUE ("tenant_id", "legal_entity_id", "period_year", "period_month", "module_code", "account_code")
);
CREATE INDEX IF NOT EXISTS "recon_register_period_idx"
  ON "reconciliation_register" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "recon_register_status_idx"
  ON "reconciliation_register" ("tenant_id", "status");

ALTER TABLE "reconciliation_register" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reconciliation_register' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "reconciliation_register"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── PBC exports ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pbc_exports" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "legal_entity_id" TEXT       NOT NULL,
  "period_year"    INTEGER     NOT NULL,
  "period_month"   INTEGER     NOT NULL,
  "exported_by"    TEXT        NOT NULL,
  "exported_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "content_hash"   TEXT        NOT NULL,
  "object_ref"     TEXT        NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'COMPLETE'
);
CREATE INDEX IF NOT EXISTS "pbc_exports_period_idx"
  ON "pbc_exports" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "pbc_exports" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pbc_exports' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "pbc_exports"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Scrub runs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scrub_runs" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "legal_entity_id" TEXT       NOT NULL,
  "period_year"    INTEGER     NOT NULL,
  "period_month"   INTEGER     NOT NULL,
  "run_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "run_by"         TEXT        NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'COMPLETE',
  "findings_count" INTEGER     NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scrub_runs_period_idx"
  ON "scrub_runs" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "scrub_runs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scrub_runs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "scrub_runs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Scrub findings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scrub_findings" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "scrub_run_id"    TEXT        NOT NULL,
  "rule_code"       TEXT        NOT NULL,
  "severity"        TEXT        NOT NULL DEFAULT 'WARNING',
  "description"     TEXT        NOT NULL,
  "source_ref"      TEXT,
  "deep_link"       TEXT,
  "status"          TEXT        NOT NULL DEFAULT 'OPEN',
  "overridden_by"   TEXT,
  "override_reason" TEXT,
  "deferred_until"  TIMESTAMPTZ,
  "resolved_at"     TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fk_scrub_findings_run"
    FOREIGN KEY ("scrub_run_id") REFERENCES "scrub_runs" ("id")
);
CREATE INDEX IF NOT EXISTS "scrub_findings_run_idx"
  ON "scrub_findings" ("scrub_run_id");
CREATE INDEX IF NOT EXISTS "scrub_findings_status_idx"
  ON "scrub_findings" ("tenant_id", "status");

ALTER TABLE "scrub_findings" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scrub_findings' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "scrub_findings"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Year-end run ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "year_end_runs" (
  "id"               TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT          NOT NULL,
  "legal_entity_id"  TEXT          NOT NULL,
  "fiscal_year"      INTEGER       NOT NULL,
  "status"           TEXT          NOT NULL DEFAULT 'PENDING',
  "preview_data"     JSONB         NOT NULL DEFAULT '{}',
  "preview_amount"   NUMERIC(15,2) NOT NULL DEFAULT 0,
  "posted_journal_id" TEXT,
  "posted_at"        TIMESTAMPTZ,
  "posted_by"        TEXT,
  "approved_by"      TEXT,
  "approved_at"      TIMESTAMPTZ,
  "idempotency_key"  TEXT          NOT NULL,
  "initiated_by"     TEXT          NOT NULL,
  "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT "year_end_runs_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "year_end_runs_entity_year_key"
    UNIQUE ("tenant_id", "legal_entity_id", "fiscal_year")
);
CREATE INDEX IF NOT EXISTS "year_end_runs_entity_idx"
  ON "year_end_runs" ("tenant_id", "legal_entity_id");

ALTER TABLE "year_end_runs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'year_end_runs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "year_end_runs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Statement snapshots ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "statement_snapshots" (
  "id"                   TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"            TEXT          NOT NULL,
  "legal_entity_id"      TEXT          NOT NULL,
  "period_year"          INTEGER       NOT NULL,
  "period_month"         INTEGER       NOT NULL,
  "statement_type"       TEXT          NOT NULL,
  "definition_version"   TEXT          NOT NULL,
  "source_tb_hash"       TEXT          NOT NULL,
  "journal_lineage"      JSONB         NOT NULL DEFAULT '[]',
  "rendered_content"     TEXT          NOT NULL,
  "rendered_hash"        TEXT          NOT NULL,
  "primary_signer_id"    TEXT,
  "primary_signed_at"    TIMESTAMPTZ,
  "primary_attestation"  TEXT,
  "secondary_signer_id"  TEXT,
  "secondary_signed_at"  TIMESTAMPTZ,
  "secondary_attestation" TEXT,
  "is_verified"          BOOLEAN       NOT NULL DEFAULT FALSE,
  "integrity_alert_at"   TIMESTAMPTZ,
  "integrity_alert_hash" TEXT,
  "version"              INTEGER       NOT NULL DEFAULT 1,
  "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "statement_snapshots_period_idx"
  ON "statement_snapshots" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "statement_snapshots_hash_idx"
  ON "statement_snapshots" ("tenant_id", "rendered_hash");

ALTER TABLE "statement_snapshots" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'statement_snapshots' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "statement_snapshots"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── KPI formula registry ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kpi_formula_versions" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"     TEXT        NOT NULL,
  "formula_code"  TEXT        NOT NULL,
  "version"       INTEGER     NOT NULL DEFAULT 1,
  "definition"    JSONB       NOT NULL,
  "effective_from" TIMESTAMPTZ NOT NULL,
  "effective_to"  TIMESTAMPTZ,
  "created_by"    TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "kpi_formula_versions_unique"
    UNIQUE ("tenant_id", "formula_code", "version")
);
CREATE INDEX IF NOT EXISTS "kpi_formula_versions_code_idx"
  ON "kpi_formula_versions" ("tenant_id", "formula_code");

ALTER TABLE "kpi_formula_versions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_formula_versions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "kpi_formula_versions"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── KPI computed results ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kpi_computed_results" (
  "id"              TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT          NOT NULL,
  "legal_entity_id" TEXT          NOT NULL,
  "period_year"     INTEGER       NOT NULL,
  "period_month"    INTEGER       NOT NULL,
  "formula_code"    TEXT          NOT NULL,
  "formula_version" INTEGER       NOT NULL,
  "result"          NUMERIC(15,2) NOT NULL,
  "source_labels"   JSONB         NOT NULL DEFAULT '{}',
  "computed_at"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kpi_results_period_idx"
  ON "kpi_computed_results" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "kpi_results_formula_idx"
  ON "kpi_computed_results" ("tenant_id", "formula_code");

ALTER TABLE "kpi_computed_results" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_computed_results' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "kpi_computed_results"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── WORM archive ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "archive_objects" (
  "id"              TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT          NOT NULL,
  "object_key"      TEXT          NOT NULL,
  "object_class"    TEXT          NOT NULL,
  "content_hash"    TEXT          NOT NULL,
  "size_bytes"      INTEGER       NOT NULL,
  "retention_class" TEXT,
  "hold_until"      TIMESTAMPTZ,
  "is_held"         BOOLEAN       NOT NULL DEFAULT TRUE,
  "held_by"         TEXT,
  "held_at"         TIMESTAMPTZ,
  "deleted_at"      TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "created_by"      TEXT          NOT NULL,
  CONSTRAINT "archive_objects_object_key_key" UNIQUE ("object_key")
);
CREATE INDEX IF NOT EXISTS "archive_objects_class_idx"
  ON "archive_objects" ("tenant_id", "object_class");
CREATE INDEX IF NOT EXISTS "archive_objects_held_idx"
  ON "archive_objects" ("tenant_id", "is_held");

ALTER TABLE "archive_objects" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'archive_objects' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "archive_objects"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Retention schedules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "retention_schedules" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "record_class"    TEXT        NOT NULL,
  "retention_days"  INTEGER     NOT NULL,
  "effective_from"  TIMESTAMPTZ NOT NULL,
  "created_by"      TEXT        NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "retention_schedules_tenant_class_key"
    UNIQUE ("tenant_id", "record_class")
);
CREATE INDEX IF NOT EXISTS "retention_schedules_tenant_idx"
  ON "retention_schedules" ("tenant_id");

ALTER TABLE "retention_schedules" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'retention_schedules' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "retention_schedules"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Shred ceremonies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shred_ceremonies" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"         TEXT        NOT NULL,
  "subject_ref"       TEXT        NOT NULL,
  "primary_author_id" TEXT        NOT NULL,
  "primary_author_at" TIMESTAMPTZ NOT NULL,
  "secondary_auth_id" TEXT        NOT NULL,
  "secondary_auth_at" TIMESTAMPTZ NOT NULL,
  "affected_count"    INTEGER     NOT NULL,
  "evidence_ref"      TEXT        NOT NULL,
  "completed_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "shred_ceremonies_tenant_idx"
  ON "shred_ceremonies" ("tenant_id");

ALTER TABLE "shred_ceremonies" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'shred_ceremonies' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "shred_ceremonies"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Currency config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "currency_configs" (
  "id"                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"            TEXT        NOT NULL,
  "legal_entity_id"      TEXT        NOT NULL,
  "functional_currency"  TEXT        NOT NULL,
  "policy_election"      TEXT        NOT NULL,
  "policy_elected_by"    TEXT        NOT NULL,
  "policy_elected_at"    TIMESTAMPTZ NOT NULL,
  "rate_source_status"   TEXT        NOT NULL DEFAULT 'NOT_CONFIGURED',
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "currency_configs_entity_key"
    UNIQUE ("tenant_id", "legal_entity_id")
);
CREATE INDEX IF NOT EXISTS "currency_configs_tenant_idx"
  ON "currency_configs" ("tenant_id");

ALTER TABLE "currency_configs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'currency_configs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "currency_configs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Translation rates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "translation_rates" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"     TEXT        NOT NULL,
  "from_currency" TEXT        NOT NULL,
  "to_currency"   TEXT        NOT NULL,
  "rate_date"     DATE        NOT NULL,
  "rate"          NUMERIC(18,6) NOT NULL,
  "source_ref"    TEXT,
  "version"       INTEGER     NOT NULL DEFAULT 1,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "translation_rates_unique"
    UNIQUE ("tenant_id", "from_currency", "to_currency", "rate_date", "version")
);
CREATE INDEX IF NOT EXISTS "translation_rates_pair_idx"
  ON "translation_rates" ("tenant_id", "from_currency", "to_currency");

ALTER TABLE "translation_rates" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'translation_rates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "translation_rates"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Translation runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "translation_runs" (
  "id"               TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT          NOT NULL,
  "legal_entity_id"  TEXT          NOT NULL,
  "period_year"      INTEGER       NOT NULL,
  "period_month"     INTEGER       NOT NULL,
  "status"           TEXT          NOT NULL DEFAULT 'PREVIEW',
  "cta_amount"       NUMERIC(15,2) NOT NULL DEFAULT 0,
  "posted_journal_id" TEXT,
  "idempotency_key"  TEXT          NOT NULL,
  "preview_data"     JSONB         NOT NULL DEFAULT '{}',
  "approved_by"      TEXT,
  "approved_at"      TIMESTAMPTZ,
  "posted_at"        TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "initiated_by"     TEXT          NOT NULL,
  CONSTRAINT "translation_runs_idempotency_key_key" UNIQUE ("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "translation_runs_period_idx"
  ON "translation_runs" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "translation_runs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'translation_runs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "translation_runs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Close audit log (immutable) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "close_audit_logs" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "legal_entity_id" TEXT       NOT NULL,
  "period_year"    INTEGER,
  "period_month"   INTEGER,
  "action"         TEXT        NOT NULL,
  "actor"          TEXT        NOT NULL,
  "before"         JSONB,
  "after"          JSONB,
  "metadata"       JSONB       NOT NULL DEFAULT '{}',
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "close_audit_logs_entity_idx"
  ON "close_audit_logs" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "close_audit_logs_action_idx"
  ON "close_audit_logs" ("tenant_id", "action");
CREATE INDEX IF NOT EXISTS "close_audit_logs_created_idx"
  ON "close_audit_logs" ("created_at");

-- Audit logs are INSERT-only; no RLS write restriction needed (append-only by design)
ALTER TABLE "close_audit_logs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'close_audit_logs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "close_audit_logs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Close outbox events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "close_outbox_events" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "event_type"     TEXT        NOT NULL,
  "tenant_id"      TEXT        NOT NULL,
  "payload"        JSONB       NOT NULL,
  "correlation_id" TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "published_at"   TIMESTAMPTZ,
  "retry_count"    INTEGER     NOT NULL DEFAULT 0,
  "last_error"     TEXT
);
CREATE INDEX IF NOT EXISTS "close_outbox_events_publish_idx"
  ON "close_outbox_events" ("published_at", "retry_count");
CREATE INDEX IF NOT EXISTS "close_outbox_events_tenant_idx"
  ON "close_outbox_events" ("tenant_id");

-- ── Shared audit_outbox (CREATE TABLE IF NOT EXISTS — first service wins) ─────
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"   TEXT        NOT NULL,
  "doc_type"    TEXT        NOT NULL,
  "doc_id"      TEXT        NOT NULL,
  "action"      TEXT        NOT NULL,
  "before"      JSONB,
  "after"       JSONB,
  "actor"       TEXT        NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retry_count" INTEGER     NOT NULL DEFAULT 0,
  "last_error"  TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_outbox_publish_idx"
  ON "audit_outbox" ("published_at", "retry_count");
