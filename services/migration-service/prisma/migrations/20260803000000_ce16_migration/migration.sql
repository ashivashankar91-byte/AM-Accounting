-- CE-16 Accounting Migration epic (S129, S130, S131, S132) — additive migration.
--
-- Creates every migration-service table with RLS, indexes and unique
-- constraints. All tables are additive (CREATE TABLE IF NOT EXISTS); no
-- pre-existing table is modified and no historical migration is rewritten.
--
-- Design rules encoded here:
--   * Migration extraction writes ONLY to these controlled staging tables.
--     There is no DDL below that touches a production GL or schedule table.
--   * Idempotency is a database-level guarantee, not application-level
--     etiquette: source_rows is UNIQUE (source_file_id, row_hash) and
--     staging_rows is UNIQUE (staging_dataset_id, row_hash), so a rerun of
--     the same extract physically cannot double-load.
--   * Monetary columns: NUMERIC(15,2) throughout per AMACC convention.

-- ── Migration runs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "migration_runs" (
  "id"                     TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT        NOT NULL,
  "legal_entity_id"        TEXT        NOT NULL,
  "run_id"                 TEXT        NOT NULL,
  "mode"                   TEXT        NOT NULL DEFAULT 'REHEARSAL',
  "state"                  TEXT        NOT NULL DEFAULT 'DISCOVERED',
  "source_snapshot_ref"    TEXT,
  "transformation_version" TEXT        NOT NULL,
  "frozen_at"              TIMESTAMPTZ,
  "freeze_attested_by"     TEXT,
  "prepared_by"            TEXT,
  "approved_by"            TEXT,
  "approval_at"            TIMESTAMPTZ,
  "started_at"             TIMESTAMPTZ,
  "completed_at"           TIMESTAMPTZ,
  "rolled_back_at"         TIMESTAMPTZ,
  "metadata"               JSONB       NOT NULL DEFAULT '{}',
  "created_by"             TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "migration_runs_tenant_run_id_key" UNIQUE ("tenant_id", "run_id")
);
CREATE INDEX IF NOT EXISTS "migration_runs_tenant_entity_idx" ON "migration_runs" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "migration_runs_tenant_state_idx"  ON "migration_runs" ("tenant_id", "state");

ALTER TABLE "migration_runs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_runs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "migration_runs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Migration run audit trail ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "migration_run_audit" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"  TEXT        NOT NULL,
  "run_id"     TEXT        NOT NULL,
  "action"     TEXT        NOT NULL,
  "actor"      TEXT        NOT NULL,
  "from_state" TEXT,
  "to_state"   TEXT,
  "reason"     TEXT,
  "evidence"   JSONB       NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "migration_run_audit_tenant_run_idx" ON "migration_run_audit" ("tenant_id", "run_id");

ALTER TABLE "migration_run_audit" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_run_audit' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "migration_run_audit"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Source system inventory ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "source_systems" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"         TEXT        NOT NULL,
  "system_code"       TEXT        NOT NULL,
  "system_name"       TEXT        NOT NULL,
  "source_type"       TEXT        NOT NULL,
  "connection_status" TEXT        NOT NULL DEFAULT 'NOT_CONFIGURED',
  "configured_at"     TIMESTAMPTZ,
  "configured_by"     TEXT,
  "metadata"          JSONB       NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "source_systems_tenant_code_key" UNIQUE ("tenant_id", "system_code")
);

ALTER TABLE "source_systems" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_systems' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "source_systems"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Source snapshots (an immutable, uniquely identified extract) ─────────────
CREATE TABLE IF NOT EXISTS "source_snapshots" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "source_system_id" TEXT        NOT NULL,
  "snapshot_ref"     TEXT        NOT NULL,
  "extracted_at"     TIMESTAMPTZ NOT NULL,
  "file_count"       INTEGER     NOT NULL DEFAULT 0,
  "total_rows"       INTEGER     NOT NULL DEFAULT 0,
  "checksums"        JSONB       NOT NULL DEFAULT '{}',
  "status"           TEXT        NOT NULL DEFAULT 'REGISTERED',
  "is_delta"         BOOLEAN     NOT NULL DEFAULT FALSE,
  "base_snapshot_id" TEXT,
  "imported_by"      TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "source_snapshots_tenant_ref_key" UNIQUE ("tenant_id", "snapshot_ref")
);
CREATE INDEX IF NOT EXISTS "source_snapshots_tenant_system_idx" ON "source_snapshots" ("tenant_id", "source_system_id");

ALTER TABLE "source_snapshots" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_snapshots' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "source_snapshots"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Source files (checksum-unique per tenant: duplicate file import refused) ──
CREATE TABLE IF NOT EXISTS "source_files" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "snapshot_id"     TEXT        NOT NULL,
  "filename"        TEXT        NOT NULL,
  "file_path"       TEXT        NOT NULL,
  "file_size"       INTEGER     NOT NULL DEFAULT 0,
  "checksum_sha256" TEXT        NOT NULL,
  "row_count"       INTEGER     NOT NULL DEFAULT 0,
  "status"          TEXT        NOT NULL DEFAULT 'REGISTERED',
  "imported_at"     TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "source_files_tenant_checksum_key" UNIQUE ("tenant_id", "checksum_sha256")
);
CREATE INDEX IF NOT EXISTS "source_files_tenant_snapshot_idx" ON "source_files" ("tenant_id", "snapshot_id");

ALTER TABLE "source_files" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_files' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "source_files"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Source rows (row_hash unique per file: rerun cannot double-load) ─────────
CREATE TABLE IF NOT EXISTS "source_rows" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "source_file_id" TEXT        NOT NULL,
  "row_index"      INTEGER     NOT NULL,
  "row_hash"       TEXT        NOT NULL,
  "raw_data"       JSONB       NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'DISCOVERED',
  "error_reason"   TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "source_rows_file_hash_key" UNIQUE ("source_file_id", "row_hash")
);
CREATE INDEX IF NOT EXISTS "source_rows_tenant_file_idx"   ON "source_rows" ("tenant_id", "source_file_id");
CREATE INDEX IF NOT EXISTS "source_rows_tenant_status_idx" ON "source_rows" ("tenant_id", "status");

ALTER TABLE "source_rows" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_rows' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "source_rows"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Mapping sets (versioned; immutable once frozen/used) ─────────────────────
CREATE TABLE IF NOT EXISTS "mapping_sets" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "source_system_id" TEXT        NOT NULL,
  "version"          INTEGER     NOT NULL DEFAULT 1,
  "status"           TEXT        NOT NULL DEFAULT 'DRAFT',
  "frozen_at"        TIMESTAMPTZ,
  "frozen_by"        TEXT,
  "approved_at"      TIMESTAMPTZ,
  "approved_by"      TEXT,
  "used_by_run_id"   TEXT,
  "evidence_refs"    JSONB       NOT NULL DEFAULT '[]',
  "created_by"       TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "mapping_sets_tenant_entity_system_version_key"
    UNIQUE ("tenant_id", "legal_entity_id", "source_system_id", "version")
);
CREATE INDEX IF NOT EXISTS "mapping_sets_tenant_status_idx" ON "mapping_sets" ("tenant_id", "status");

ALTER TABLE "mapping_sets" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mapping_sets' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "mapping_sets"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Mapping entries (ALIGN | MAP | DIVERGE classification) ───────────────────
CREATE TABLE IF NOT EXISTS "mapping_entries" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "mapping_set_id"  TEXT        NOT NULL,
  "source_field"    TEXT        NOT NULL,
  "source_value"    TEXT        NOT NULL,
  "target_field"    TEXT,
  "target_value"    TEXT,
  "classification"  TEXT,
  "provenance_note" TEXT,
  "decided_by"      TEXT,
  "decided_at"      TIMESTAMPTZ,
  "approved_by"     TEXT,
  "approved_at"     TIMESTAMPTZ,
  "evidence_ref"    TEXT,
  "status"          TEXT        NOT NULL DEFAULT 'MANUAL_REVIEW_REQUIRED',
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "mapping_entries_set_field_value_key"
    UNIQUE ("mapping_set_id", "source_field", "source_value")
);
CREATE INDEX IF NOT EXISTS "mapping_entries_tenant_set_idx"    ON "mapping_entries" ("tenant_id", "mapping_set_id");
CREATE INDEX IF NOT EXISTS "mapping_entries_tenant_status_idx" ON "mapping_entries" ("tenant_id", "status");

ALTER TABLE "mapping_entries" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mapping_entries' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "mapping_entries"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Staging datasets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staging_datasets" (
  "id"                     TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT           NOT NULL,
  "legal_entity_id"        TEXT           NOT NULL,
  "run_id"                 TEXT           NOT NULL,
  "dataset_type"           TEXT           NOT NULL,
  "state"                  TEXT           NOT NULL DEFAULT 'STAGED',
  "row_count"              INTEGER        NOT NULL DEFAULT 0,
  "accepted_count"         INTEGER        NOT NULL DEFAULT 0,
  "rejected_count"         INTEGER        NOT NULL DEFAULT 0,
  "skipped_count"          INTEGER        NOT NULL DEFAULT 0,
  "total_debit"            NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "total_credit"           NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "control_checksum"       TEXT,
  "source_ref"             TEXT,
  "mapping_set_id"         TEXT,
  "transformation_version" TEXT           NOT NULL,
  "promoted_at"            TIMESTAMPTZ,
  "promoted_by"            TEXT,
  "created_at"             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT "staging_datasets_tenant_run_type_key" UNIQUE ("tenant_id", "run_id", "dataset_type")
);
CREATE INDEX IF NOT EXISTS "staging_datasets_tenant_run_idx" ON "staging_datasets" ("tenant_id", "run_id");

ALTER TABLE "staging_datasets" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staging_datasets' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "staging_datasets"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Staging rows (row_hash unique per dataset: idempotent restage) ───────────
CREATE TABLE IF NOT EXISTS "staging_rows" (
  "id"                  TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"           TEXT        NOT NULL,
  "staging_dataset_id"  TEXT        NOT NULL,
  "source_row_id"       TEXT,
  "row_hash"            TEXT        NOT NULL,
  "staged_data"         JSONB       NOT NULL,
  "validation_errors"   JSONB       NOT NULL DEFAULT '[]',
  "state"               TEXT        NOT NULL DEFAULT 'STAGED',
  "promoted_at"         TIMESTAMPTZ,
  "promoted_record_id"  TEXT,
  "lineage_ref"         JSONB       NOT NULL DEFAULT '{}',
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "staging_rows_dataset_hash_key" UNIQUE ("staging_dataset_id", "row_hash")
);
CREATE INDEX IF NOT EXISTS "staging_rows_tenant_dataset_idx" ON "staging_rows" ("tenant_id", "staging_dataset_id");
CREATE INDEX IF NOT EXISTS "staging_rows_tenant_state_idx"   ON "staging_rows" ("tenant_id", "state");

ALTER TABLE "staging_rows" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staging_rows' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "staging_rows"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Exception queue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exception_queue" (
  "id"                 TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT        NOT NULL,
  "legal_entity_id"    TEXT        NOT NULL,
  "run_id"             TEXT        NOT NULL,
  "source_row_id"      TEXT,
  "staging_row_id"     TEXT,
  "exception_type"     TEXT        NOT NULL,
  "source_field"       TEXT,
  "source_value"       TEXT,
  "reason"             TEXT        NOT NULL,
  "blocking"           BOOLEAN     NOT NULL DEFAULT TRUE,
  "evidence"           JSONB       NOT NULL DEFAULT '{}',
  "disposition"        TEXT        NOT NULL DEFAULT 'PENDING',
  "dispositioned_by"   TEXT,
  "dispositioned_at"   TIMESTAMPTZ,
  "disposition_reason" TEXT,
  "dedupe_key"         TEXT        NOT NULL,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Replaying an extraction must not enqueue the same defect twice.
CREATE UNIQUE INDEX IF NOT EXISTS "exception_queue_run_dedupe_key"   ON "exception_queue" ("run_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "exception_queue_tenant_run_idx"         ON "exception_queue" ("tenant_id", "run_id");
CREATE INDEX IF NOT EXISTS "exception_queue_tenant_disposition_idx" ON "exception_queue" ("tenant_id", "disposition");

ALTER TABLE "exception_queue" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exception_queue' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "exception_queue"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Gate results (S129 G1–G5) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gate_results" (
  "id"                 TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT        NOT NULL,
  "run_id"             TEXT        NOT NULL,
  "staging_dataset_id" TEXT,
  "gate_code"          TEXT        NOT NULL,
  "result"             TEXT        NOT NULL,
  "details"            JSONB       NOT NULL DEFAULT '{}',
  "evaluated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "evaluated_by"       TEXT,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "gate_results_tenant_run_idx" ON "gate_results" ("tenant_id", "run_id");

ALTER TABLE "gate_results" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gate_results' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "gate_results"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Control totals (per phase: EXTRACT | STAGING | TRANSFORM | LOAD) ─────────
CREATE TABLE IF NOT EXISTS "control_totals" (
  "id"                 TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT           NOT NULL,
  "run_id"             TEXT           NOT NULL,
  "staging_dataset_id" TEXT,
  "phase"              TEXT           NOT NULL,
  "row_count"          INTEGER        NOT NULL DEFAULT 0,
  "accepted_count"     INTEGER        NOT NULL DEFAULT 0,
  "rejected_count"     INTEGER        NOT NULL DEFAULT 0,
  "total_debit"        NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "total_credit"       NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "open_item_total"    NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "schedule_balance"   NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "document_count"     INTEGER        NOT NULL DEFAULT 0,
  "exception_count"    INTEGER        NOT NULL DEFAULT 0,
  "duplicate_count"    INTEGER        NOT NULL DEFAULT 0,
  "captured_at"        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "created_at"         TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "control_totals_tenant_run_idx" ON "control_totals" ("tenant_id", "run_id");

ALTER TABLE "control_totals" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'control_totals' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "control_totals"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Lineage: source system -> file -> row -> staging -> mapping ->
--    transformation -> target -> posting -> journal -> reconciliation ────────
CREATE TABLE IF NOT EXISTS "migration_lineage" (
  "id"                     TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT        NOT NULL,
  "run_id"                 TEXT        NOT NULL,
  "source_system_ref"      TEXT,
  "source_file_ref"        TEXT,
  "source_row_ref"         TEXT,
  "staging_record_id"      TEXT,
  "mapping_decision_ref"   TEXT,
  "transformation_version" TEXT,
  "target_record_id"       TEXT,
  "target_record_type"     TEXT,
  "posting_execution_ref"  TEXT,
  "journal_ref"            TEXT,
  "open_item_ref"          TEXT,
  "reconciliation_ref"     TEXT,
  "evidence"               JSONB       NOT NULL DEFAULT '{}',
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "migration_lineage_run_staging_key" ON "migration_lineage" ("run_id", "staging_record_id");
CREATE INDEX IF NOT EXISTS "migration_lineage_tenant_run_idx"     ON "migration_lineage" ("tenant_id", "run_id");
CREATE INDEX IF NOT EXISTS "migration_lineage_tenant_source_idx"  ON "migration_lineage" ("tenant_id", "source_row_ref");
CREATE INDEX IF NOT EXISTS "migration_lineage_tenant_journal_idx" ON "migration_lineage" ("tenant_id", "journal_ref");

ALTER TABLE "migration_lineage" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_lineage' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "migration_lineage"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Parallel-run comparison harness (S131) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "comparison_runs" (
  "id"                  TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"           TEXT        NOT NULL,
  "legal_entity_id"     TEXT        NOT NULL,
  "run_id"              TEXT        NOT NULL,
  "period_year"         INTEGER     NOT NULL,
  "period_month"        INTEGER     NOT NULL,
  "legacy_snapshot_ref" TEXT,
  "comparison_version"  INTEGER     NOT NULL DEFAULT 1,
  "state"               TEXT        NOT NULL DEFAULT 'PENDING',
  "operator_id"         TEXT,
  "signed_off_by"       TEXT,
  "signed_off_at"       TIMESTAMPTZ,
  "signed_off_evidence" JSONB       NOT NULL DEFAULT '{}',
  "total_diffs"         INTEGER     NOT NULL DEFAULT 0,
  "unexplained_diffs"   INTEGER     NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "comparison_runs_tenant_run_period_version_key"
    UNIQUE ("tenant_id", "run_id", "period_year", "period_month", "comparison_version")
);
CREATE INDEX IF NOT EXISTS "comparison_runs_tenant_run_idx" ON "comparison_runs" ("tenant_id", "run_id");

ALTER TABLE "comparison_runs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comparison_runs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "comparison_runs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "comparison_diffs" (
  "id"                TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"         TEXT           NOT NULL,
  "comparison_run_id" TEXT           NOT NULL,
  "diff_type"         TEXT           NOT NULL,
  "dimension"         TEXT           NOT NULL,
  "source_value"      NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "target_value"      NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "variance"          NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "classification"    TEXT           NOT NULL DEFAULT 'UNEXPLAINED',
  "classified_by"     TEXT,
  "classified_at"     TIMESTAMPTZ,
  "reason"            TEXT,
  "disposition"       TEXT           NOT NULL DEFAULT 'PENDING',
  "approved_by"       TEXT,
  "approved_at"       TIMESTAMPTZ,
  "evidence"          JSONB          NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "comparison_diffs_tenant_run_idx"            ON "comparison_diffs" ("tenant_id", "comparison_run_id");
CREATE INDEX IF NOT EXISTS "comparison_diffs_tenant_classification_idx" ON "comparison_diffs" ("tenant_id", "classification");

ALTER TABLE "comparison_diffs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comparison_diffs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "comparison_diffs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Cutover ceremony (irreversible domain authority, dual SoD) ──────────────
CREATE TABLE IF NOT EXISTS "cutover_ceremonies" (
  "id"                            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"                     TEXT        NOT NULL,
  "legal_entity_id"               TEXT        NOT NULL,
  "run_id"                        TEXT        NOT NULL,
  "source_system_ids"             JSONB       NOT NULL DEFAULT '[]',
  "run_ids"                       JSONB       NOT NULL DEFAULT '[]',
  "freeze_timestamp"              TIMESTAMPTZ,
  "transformation_versions"       JSONB       NOT NULL DEFAULT '[]',
  "target_environment"            TEXT        NOT NULL DEFAULT 'PRODUCTION',
  "irreversible_effect_statement" TEXT        NOT NULL,
  "rollback_boundary"             TEXT,
  "backup_evidence"               JSONB       NOT NULL DEFAULT '{}',
  "rollback_plan_evidence"        JSONB       NOT NULL DEFAULT '{}',
  "prepared_by"                   TEXT        NOT NULL,
  "prepared_at"                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "approver_identity"             TEXT,
  "approved_at"                   TIMESTAMPTZ,
  "approval_evidence"             JSONB       NOT NULL DEFAULT '{}',
  "execution_started_at"          TIMESTAMPTZ,
  "execution_completed_at"        TIMESTAMPTZ,
  "state"                         TEXT        NOT NULL DEFAULT 'PREPARED',
  "created_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "cutover_ceremonies_tenant_run_id_key" UNIQUE ("tenant_id", "run_id")
);
CREATE INDEX IF NOT EXISTS "cutover_ceremonies_tenant_entity_idx" ON "cutover_ceremonies" ("tenant_id", "legal_entity_id");

ALTER TABLE "cutover_ceremonies" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cutover_ceremonies' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "cutover_ceremonies"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Legacy statement archive (S132a — immutable, WORM-retained) ─────────────
CREATE TABLE IF NOT EXISTS "archive_statements" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT        NOT NULL,
  "legal_entity_id"  TEXT        NOT NULL,
  "period_year"      INTEGER     NOT NULL,
  "period_month"     INTEGER     NOT NULL,
  "statement_type"   TEXT        NOT NULL,
  "source_system"    TEXT        NOT NULL,
  "filename"         TEXT        NOT NULL,
  "file_size"        INTEGER     NOT NULL DEFAULT 0,
  "checksum_sha256"  TEXT        NOT NULL,
  "imported_by"      TEXT        NOT NULL,
  "imported_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "worm_class"       TEXT        NOT NULL DEFAULT 'STATUTORY_STATEMENT',
  "retention_until"  TIMESTAMPTZ,
  "metadata"         JSONB       NOT NULL DEFAULT '{}',
  "access_count"     INTEGER     NOT NULL DEFAULT 0,
  "last_accessed_at" TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "archive_statements_tenant_checksum_key" UNIQUE ("tenant_id", "checksum_sha256")
);
CREATE INDEX IF NOT EXISTS "archive_statements_tenant_period_idx" ON "archive_statements" ("tenant_id", "legal_entity_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "archive_statements_tenant_type_idx"   ON "archive_statements" ("tenant_id", "statement_type");

ALTER TABLE "archive_statements" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'archive_statements' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "archive_statements"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Runbooks (S132b) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "runbook_templates" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"  TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "version"    INTEGER     NOT NULL DEFAULT 1,
  "steps"      JSONB       NOT NULL DEFAULT '[]',
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "runbook_templates_tenant_name_version_key" UNIQUE ("tenant_id", "name", "version")
);

ALTER TABLE "runbook_templates" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'runbook_templates' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "runbook_templates"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "runbook_instances" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "legal_entity_id" TEXT        NOT NULL,
  "template_id"     TEXT        NOT NULL,
  "run_id"          TEXT        NOT NULL,
  "state"           TEXT        NOT NULL DEFAULT 'ACTIVE',
  "steps"           JSONB       NOT NULL DEFAULT '[]',
  "created_by"      TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "runbook_instances_tenant_run_idx" ON "runbook_instances" ("tenant_id", "run_id");

ALTER TABLE "runbook_instances" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'runbook_instances' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "runbook_instances"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ── Shared audit_outbox (CREATE TABLE IF NOT EXISTS — first service wins) ────
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"    TEXT        NOT NULL,
  "doc_type"     TEXT        NOT NULL,
  "doc_id"       TEXT        NOT NULL,
  "action"       TEXT        NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT        NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retry_count"  INTEGER     NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_outbox_publish_idx" ON "audit_outbox" ("published_at", "retry_count");

-- ── Migration domain-event outbox (durability for migration.* events) ───────
CREATE TABLE IF NOT EXISTS "migration_outbox" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT        NOT NULL,
  "event_type"     TEXT        NOT NULL,
  "payload"        JSONB       NOT NULL,
  "correlation_id" TEXT,
  "published_at"   TIMESTAMPTZ,
  "retry_count"    INTEGER     NOT NULL DEFAULT 0,
  "last_error"     TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "migration_outbox_publish_idx" ON "migration_outbox" ("published_at", "retry_count");

ALTER TABLE "migration_outbox" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'migration_outbox' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "migration_outbox"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
