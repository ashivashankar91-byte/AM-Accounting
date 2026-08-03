-- CE-17 Accounting Automation epic — additive migration.
--
-- Creates every automation-service table with row-level security, indexes and
-- unique constraints. Additive only (CREATE TABLE IF NOT EXISTS): no
-- pre-existing table is reshaped and no historical migration is rewritten.
--
-- Invariants encoded in DDL rather than left to application etiquette:
--   * Money is NUMERIC(15,2) everywhere. Confidence and match scores are
--     NUMERIC(5,4); LIFO index values NUMERIC(10,6); chargeback rates
--     NUMERIC(7,6). There is no double-precision column in this schema.
--   * automation_items.idempotency_key and automation_executions.idempotency_key
--     are UNIQUE at the database level, so a replayed execution physically
--     cannot post twice — the second insert fails on the constraint.
--   * Every tenant-scoped table has RLS enabled with the same
--     app.current_tenant_id policy used by the rest of the fleet.
--   * Nothing here creates, alters or references a general-ledger table. All
--     financial effects travel through the CE-07 governed posting path and are
--     recorded here only as references (posting_execution_id, journal_entry_id).
--   * audit_outbox is the fleet-shared table: created IF NOT EXISTS with the
--     identical shape used by the other services and deliberately left without
--     an RLS policy, exactly as the services that may have created it first.

CREATE TABLE IF NOT EXISTS "automation_capabilities" (
  "id"                           TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"                    TEXT         NOT NULL,
  "legal_entity_id"              TEXT         NOT NULL,
  "capability_code"              TEXT         NOT NULL,
  "story_id"                     TEXT         NOT NULL,
  "current_authority"            TEXT         NOT NULL DEFAULT 'OBSERVE_ONLY',
  "authority_granted_by"         TEXT,
  "authority_granted_at"         TIMESTAMPTZ,
  "authority_activated_by"       TEXT,
  "authority_activated_at"       TIMESTAMPTZ,
  "policy_version"               TEXT         NOT NULL DEFAULT '1.0',
  "baseline_evidence_ref"        TEXT,
  "baseline_measured_at"         TIMESTAMPTZ,
  "circuit_breaker_count"        INTEGER      NOT NULL DEFAULT 0,
  "circuit_breaker_suspended_at" TIMESTAMPTZ,
  "suspended_by"                 TEXT,
  "suspended_at"                 TIMESTAMPTZ,
  "suspend_reason"               TEXT,
  "version"                      INTEGER      NOT NULL DEFAULT 0,
  "created_at"                   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"                   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "automation_capabilities_tenant_entity_code_key" UNIQUE ("tenant_id", "legal_entity_id", "capability_code")
);
CREATE INDEX IF NOT EXISTS "automation_capabilities_tenant_entity_idx" ON "automation_capabilities" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "automation_capabilities_tenant_story_idx" ON "automation_capabilities" ("tenant_id", "story_id");

ALTER TABLE "automation_capabilities" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_capabilities' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_capabilities"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "automation_grants" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT         NOT NULL,
  "capability_id"  TEXT         NOT NULL,
  "from_authority" TEXT         NOT NULL,
  "to_authority"   TEXT         NOT NULL,
  "granted_by"     TEXT         NOT NULL,
  "granted_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "activated_by"   TEXT,
  "activated_at"   TIMESTAMPTZ,
  "revoked"        BOOLEAN      NOT NULL DEFAULT false,
  "revoked_by"     TEXT,
  "revoked_at"     TIMESTAMPTZ,
  "evidence_refs"  JSONB        NOT NULL DEFAULT '[]',
  "policy_version" TEXT         NOT NULL,
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "automation_grants_tenant_capability_idx" ON "automation_grants" ("tenant_id", "capability_id");

ALTER TABLE "automation_grants" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_grants' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_grants"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "policy_gates" (
  "id"                           TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"                    TEXT           NOT NULL,
  "legal_entity_id"              TEXT           NOT NULL,
  "capability_code"              TEXT           NOT NULL,
  "monetary_limit"               NUMERIC(15,2),
  "confidence_min"               NUMERIC(5,4),
  "allowed_exception_categories" JSONB          NOT NULL DEFAULT '[]',
  "high_risk_categories"         JSONB          NOT NULL DEFAULT '[]',
  "circuit_breaker_threshold"    INTEGER        NOT NULL DEFAULT 5,
  "policy_version"               TEXT           NOT NULL DEFAULT '1.0',
  "authored_by"                  TEXT           NOT NULL,
  "activated_by"                 TEXT,
  "effective_date"               TIMESTAMPTZ    NOT NULL,
  "created_at"                   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"                   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT "policy_gates_tenant_entity_code_version_key" UNIQUE ("tenant_id", "legal_entity_id", "capability_code", "policy_version")
);
CREATE INDEX IF NOT EXISTS "policy_gates_tenant_entity_code_idx" ON "policy_gates" ("tenant_id", "legal_entity_id", "capability_code");

ALTER TABLE "policy_gates" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'policy_gates' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "policy_gates"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "automation_items" (
  "id"                      TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"               TEXT           NOT NULL,
  "legal_entity_id"         TEXT           NOT NULL,
  "capability_id"           TEXT           NOT NULL,
  "capability_code"         TEXT           NOT NULL,
  "story_id"                TEXT           NOT NULL,
  "state"                   TEXT           NOT NULL DEFAULT 'RECOMMENDATION_READY',
  "idempotency_key"         TEXT           NOT NULL,
  "automation_identity"     TEXT           NOT NULL,
  "source_evidence_refs"    JSONB          NOT NULL DEFAULT '[]',
  "recommendation_evidence" JSONB          NOT NULL DEFAULT '{}',
  "rule_version"            TEXT,
  "model_version"           TEXT,
  "confidence"              NUMERIC(5,4),
  "proposed_amount"         NUMERIC(15,2),
  "policy_eval_trace"       JSONB          NOT NULL DEFAULT '{}',
  "approval_required"       BOOLEAN        NOT NULL DEFAULT false,
  "approved_by"             TEXT,
  "approved_at"             TIMESTAMPTZ,
  "rejected_by"             TEXT,
  "rejected_at"             TIMESTAMPTZ,
  "rejection_reason"        TEXT,
  "execution_id"            TEXT,
  "failure_reason"          TEXT,
  "retry_count"             INTEGER        NOT NULL DEFAULT 0,
  "claimed_by"              TEXT,
  "claimed_at"              TIMESTAMPTZ,
  "completed_at"            TIMESTAMPTZ,
  "correction_of"           TEXT,
  "reversal_of"             TEXT,
  "version"                 INTEGER        NOT NULL DEFAULT 0,
  "created_at"              TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT "automation_items_idem_key" UNIQUE ("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "automation_items_tenant_entity_code_state_idx" ON "automation_items" ("tenant_id", "legal_entity_id", "capability_code", "state");
CREATE INDEX IF NOT EXISTS "automation_items_tenant_state_idx" ON "automation_items" ("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "automation_items_tenant_idem_idx" ON "automation_items" ("tenant_id", "idempotency_key");

ALTER TABLE "automation_items" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_items"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "automation_executions" (
  "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"             TEXT         NOT NULL,
  "item_id"               TEXT         NOT NULL,
  "idempotency_key"       TEXT         NOT NULL,
  "executed_by"           TEXT         NOT NULL,
  "approved_by"           TEXT,
  "policy_version"        TEXT         NOT NULL,
  "rule_version"          TEXT,
  "model_version"         TEXT,
  "source_transaction_id" TEXT,
  "posting_execution_id"  TEXT,
  "journal_entry_id"      TEXT,
  "schedule_effect_refs"  JSONB        NOT NULL DEFAULT '[]',
  "recon_effect_refs"     JSONB        NOT NULL DEFAULT '[]',
  "outcome"               TEXT         NOT NULL,
  "failure_reason"        TEXT,
  "lineage_trace"         JSONB        NOT NULL DEFAULT '{}',
  "reversal_of"           TEXT,
  "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "automation_executions_idem_key" UNIQUE ("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "automation_executions_tenant_item_idx" ON "automation_executions" ("tenant_id", "item_id");
CREATE INDEX IF NOT EXISTS "automation_executions_tenant_idem_idx" ON "automation_executions" ("tenant_id", "idempotency_key");

ALTER TABLE "automation_executions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_executions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_executions"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "rule_model_versions" (
  "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"             TEXT         NOT NULL,
  "capability_code"       TEXT         NOT NULL,
  "version_tag"           TEXT         NOT NULL,
  "version_type"          TEXT         NOT NULL,
  "description"           TEXT,
  "training_window_start" TIMESTAMPTZ,
  "training_window_end"   TIMESTAMPTZ,
  "deployed_at"           TIMESTAMPTZ  NOT NULL,
  "deployed_by"           TEXT         NOT NULL,
  "adopted_by"            TEXT,
  "adopted_at"            TIMESTAMPTZ,
  "superseded_at"         TIMESTAMPTZ,
  "artifact_ref"          TEXT,
  "metadata"              JSONB        NOT NULL DEFAULT '{}',
  "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "rule_model_versions_tenant_code_tag_key" UNIQUE ("tenant_id", "capability_code", "version_tag")
);
CREATE INDEX IF NOT EXISTS "rule_model_versions_tenant_code_idx" ON "rule_model_versions" ("tenant_id", "capability_code");

ALTER TABLE "rule_model_versions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rule_model_versions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "rule_model_versions"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "automation_health_metrics" (
  "id"                   TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"            TEXT          NOT NULL,
  "legal_entity_id"      TEXT          NOT NULL,
  "capability_code"      TEXT          NOT NULL,
  "period_date"          DATE          NOT NULL,
  "total_items"          INTEGER       NOT NULL DEFAULT 0,
  "accepted"             INTEGER       NOT NULL DEFAULT 0,
  "rejected"             INTEGER       NOT NULL DEFAULT 0,
  "executed"             INTEGER       NOT NULL DEFAULT 0,
  "failed_closed"        INTEGER       NOT NULL DEFAULT 0,
  "drift_flagged"        BOOLEAN       NOT NULL DEFAULT false,
  "accuracy_vs_baseline" NUMERIC(5,4),
  "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT "automation_health_metrics_tenant_entity_code_period_key" UNIQUE ("tenant_id", "legal_entity_id", "capability_code", "period_date")
);
CREATE INDEX IF NOT EXISTS "automation_health_metrics_tenant_entity_code_idx" ON "automation_health_metrics" ("tenant_id", "legal_entity_id", "capability_code");

ALTER TABLE "automation_health_metrics" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_health_metrics' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_health_metrics"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "simulation_sandboxes" (
  "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"         TEXT         NOT NULL,
  "legal_entity_id"   TEXT         NOT NULL,
  "name"              TEXT         NOT NULL,
  "description"       TEXT,
  "scenario_type"     TEXT         NOT NULL,
  "input_spec"        JSONB        NOT NULL DEFAULT '{}',
  "rule_pack_version" TEXT,
  "state"             TEXT         NOT NULL DEFAULT 'PENDING',
  "result_ref"        TEXT,
  "diff_report_ref"   TEXT,
  "mutation_proof"    JSONB        NOT NULL DEFAULT '{}',
  "created_by"        TEXT         NOT NULL,
  "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "simulation_sandboxes_tenant_entity_idx" ON "simulation_sandboxes" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "simulation_sandboxes_tenant_state_idx" ON "simulation_sandboxes" ("tenant_id", "state");

ALTER TABLE "simulation_sandboxes" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'simulation_sandboxes' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "simulation_sandboxes"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sandbox_results" (
  "id"                  TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"           TEXT         NOT NULL,
  "sandbox_id"          TEXT         NOT NULL,
  "proposed_journals"   JSONB        NOT NULL DEFAULT '[]',
  "diff_vs_actual"      JSONB        NOT NULL DEFAULT '{}',
  "rule_hits"           JSONB        NOT NULL DEFAULT '[]',
  "exportable_baseline" BOOLEAN      NOT NULL DEFAULT false,
  "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sandbox_results_tenant_sandbox_idx" ON "sandbox_results" ("tenant_id", "sandbox_id");

ALTER TABLE "sandbox_results" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sandbox_results' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "sandbox_results"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ingestion_drafts" (
  "id"                   TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"            TEXT          NOT NULL,
  "legal_entity_id"      TEXT          NOT NULL,
  "channel"              TEXT          NOT NULL,
  "source_image_ref"     TEXT,
  "edi_transaction_ref"  TEXT,
  "extracted_fields"     JSONB         NOT NULL DEFAULT '{}',
  "field_confidence"     JSONB         NOT NULL DEFAULT '{}',
  "overall_confidence"   NUMERIC(5,4),
  "dedup_key"            TEXT,
  "is_duplicate_suspect" BOOLEAN       NOT NULL DEFAULT false,
  "vendor_match_ref"     TEXT,
  "po_match_ref"         TEXT,
  "suggested_coding"     JSONB         NOT NULL DEFAULT '{}',
  "state"                TEXT          NOT NULL DEFAULT 'DRAFT',
  "reviewed_by"          TEXT,
  "reviewed_at"          TIMESTAMPTZ,
  "s039_invoice_id"      TEXT,
  "extractor_version"    TEXT,
  "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ingestion_drafts_tenant_entity_state_idx" ON "ingestion_drafts" ("tenant_id", "legal_entity_id", "state");
CREATE INDEX IF NOT EXISTS "ingestion_drafts_tenant_dedup_idx" ON "ingestion_drafts" ("tenant_id", "dedup_key");

ALTER TABLE "ingestion_drafts" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ingestion_drafts' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "ingestion_drafts"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lockbox_files" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"       TEXT         NOT NULL,
  "legal_entity_id" TEXT         NOT NULL,
  "file_ref"        TEXT         NOT NULL,
  "file_hash"       TEXT         NOT NULL,
  "source_bank"     TEXT,
  "deposit_date"    DATE         NOT NULL,
  "state"           TEXT         NOT NULL DEFAULT 'INGESTED',
  "processed_at"    TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "lockbox_files_tenant_hash_key" UNIQUE ("tenant_id", "file_hash")
);
CREATE INDEX IF NOT EXISTS "lockbox_files_tenant_entity_idx" ON "lockbox_files" ("tenant_id", "legal_entity_id");

ALTER TABLE "lockbox_files" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lockbox_files' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "lockbox_files"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lockbox_lines" (
  "id"                 TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT           NOT NULL,
  "file_id"            TEXT           NOT NULL,
  "line_ref"           TEXT           NOT NULL,
  "amount"             NUMERIC(15,2)  NOT NULL,
  "apply_number"       TEXT,
  "remittance_ref"     TEXT,
  "match_type"         TEXT,
  "match_score"        NUMERIC(5,4),
  "matched_ar_item_id" TEXT,
  "match_version"      TEXT,
  "state"              TEXT           NOT NULL DEFAULT 'PENDING',
  "reviewed_by"        TEXT,
  "reviewed_at"        TIMESTAMPTZ,
  "receipt_posting_id" TEXT,
  "created_at"         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "lockbox_lines_tenant_file_idx" ON "lockbox_lines" ("tenant_id", "file_id");
CREATE INDEX IF NOT EXISTS "lockbox_lines_tenant_state_idx" ON "lockbox_lines" ("tenant_id", "state");

ALTER TABLE "lockbox_lines" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lockbox_lines' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "lockbox_lines"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lifo_pool_definitions" (
  "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"         TEXT         NOT NULL,
  "legal_entity_id"   TEXT         NOT NULL,
  "pool_code"         TEXT         NOT NULL,
  "pool_name"         TEXT         NOT NULL,
  "method_election"   TEXT         NOT NULL,
  "index_source"      TEXT         NOT NULL,
  "effective_date"    DATE         NOT NULL,
  "elected_by"        TEXT         NOT NULL,
  "election_evidence" TEXT,
  "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "lifo_pool_definitions_tenant_entity_pool_key" UNIQUE ("tenant_id", "legal_entity_id", "pool_code")
);
CREATE INDEX IF NOT EXISTS "lifo_pool_definitions_tenant_entity_idx" ON "lifo_pool_definitions" ("tenant_id", "legal_entity_id");

ALTER TABLE "lifo_pool_definitions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lifo_pool_definitions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "lifo_pool_definitions"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lifo_layers" (
  "id"                 TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT           NOT NULL,
  "pool_id"            TEXT           NOT NULL,
  "layer_year"         INTEGER        NOT NULL,
  "layer_month"        INTEGER        NOT NULL,
  "base_quantity"      NUMERIC(15,2)  NOT NULL,
  "base_cost"          NUMERIC(15,2)  NOT NULL,
  "index_value"        NUMERIC(10,6)  NOT NULL,
  "index_evidence_ref" TEXT,
  "reserve_amount"     NUMERIC(15,2)  NOT NULL DEFAULT 0,
  "approved"           BOOLEAN        NOT NULL DEFAULT false,
  "approved_by"        TEXT,
  "approved_at"        TIMESTAMPTZ,
  "posting_item_id"    TEXT,
  "created_at"         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT "lifo_layers_tenant_pool_year_month_key" UNIQUE ("tenant_id", "pool_id", "layer_year", "layer_month")
);
CREATE INDEX IF NOT EXISTS "lifo_layers_tenant_pool_idx" ON "lifo_layers" ("tenant_id", "pool_id");

ALTER TABLE "lifo_layers" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lifo_layers' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "lifo_layers"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "chargeback_model_outputs" (
  "id"                    TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"             TEXT          NOT NULL,
  "legal_entity_id"       TEXT          NOT NULL,
  "model_version"         TEXT          NOT NULL,
  "training_window_start" TIMESTAMPTZ   NOT NULL,
  "training_window_end"   TIMESTAMPTZ   NOT NULL,
  "cohort_data"           JSONB         NOT NULL DEFAULT '[]',
  "fit_diagnostics"       JSONB         NOT NULL DEFAULT '{}',
  "recommended_rate"      NUMERIC(7,6)  NOT NULL,
  "flat_rate_comparison"  NUMERIC(7,6),
  "state"                 TEXT          NOT NULL DEFAULT 'RECOMMENDATION_READY',
  "adopted_by"            TEXT,
  "adopted_at"            TIMESTAMPTZ,
  "s091_config_version"   TEXT,
  "drift_flagged"         BOOLEAN       NOT NULL DEFAULT false,
  "created_at"            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "chargeback_model_outputs_tenant_entity_state_idx" ON "chargeback_model_outputs" ("tenant_id", "legal_entity_id", "state");

ALTER TABLE "chargeback_model_outputs" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chargeback_model_outputs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "chargeback_model_outputs"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_statements" (
  "id"               TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"        TEXT           NOT NULL,
  "legal_entity_id"  TEXT           NOT NULL,
  "statement_date"   DATE           NOT NULL,
  "lender_ref"       TEXT           NOT NULL,
  "total_amount"     NUMERIC(15,2)  NOT NULL,
  "evidence_ref"     TEXT           NOT NULL,
  "allocation_basis" TEXT           NOT NULL,
  "state"            TEXT           NOT NULL DEFAULT 'ENTERED',
  "allocations"      JSONB          NOT NULL DEFAULT '[]',
  "approved_by"      TEXT,
  "approved_at"      TIMESTAMPTZ,
  "posting_item_id"  TEXT,
  "created_at"       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portfolio_statements_tenant_entity_state_idx" ON "portfolio_statements" ("tenant_id", "legal_entity_id", "state");

ALTER TABLE "portfolio_statements" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'portfolio_statements' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "portfolio_statements"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "cession_statements" (
  "id"                     TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT           NOT NULL,
  "legal_entity_id"        TEXT           NOT NULL,
  "statement_date"         DATE           NOT NULL,
  "program_admin_ref"      TEXT           NOT NULL,
  "treaty_code"            TEXT           NOT NULL,
  "premium_cession"        NUMERIC(15,2)  NOT NULL,
  "reserve_cession"        NUMERIC(15,2)  NOT NULL,
  "claim_cession"          NUMERIC(15,2)  NOT NULL,
  "statement_evidence_ref" TEXT           NOT NULL,
  "state"                  TEXT           NOT NULL DEFAULT 'ENTERED',
  "approved_by"            TEXT,
  "approved_at"            TIMESTAMPTZ,
  "posting_item_id"        TEXT,
  "position_tracking_ref"  TEXT,
  "created_at"             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cession_statements_tenant_entity_state_idx" ON "cession_statements" ("tenant_id", "legal_entity_id", "state");

ALTER TABLE "cession_statements" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cession_statements' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "cession_statements"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "oem_match_suggestions" (
  "id"                    TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"             TEXT           NOT NULL,
  "legal_entity_id"       TEXT           NOT NULL,
  "s101a_session_id"      TEXT           NOT NULL,
  "claim_number"          TEXT,
  "amount"                NUMERIC(15,2)  NOT NULL,
  "match_type"            TEXT           NOT NULL,
  "match_score"           NUMERIC(5,4),
  "match_version"         TEXT           NOT NULL,
  "suggested_disposition" TEXT,
  "automation_identity"   TEXT           NOT NULL,
  "is_judgment_class"     BOOLEAN        NOT NULL DEFAULT false,
  "state"                 TEXT           NOT NULL DEFAULT 'SUGGESTED',
  "disposed_by"           TEXT,
  "disposed_at"           TIMESTAMPTZ,
  "created_at"            TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "oem_match_suggestions_tenant_entity_state_idx" ON "oem_match_suggestions" ("tenant_id", "legal_entity_id", "state");
CREATE INDEX IF NOT EXISTS "oem_match_suggestions_tenant_session_idx" ON "oem_match_suggestions" ("tenant_id", "s101a_session_id");

ALTER TABLE "oem_match_suggestions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oem_match_suggestions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "oem_match_suggestions"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "incentive_accrual_recommendations" (
  "id"                        TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"                 TEXT           NOT NULL,
  "legal_entity_id"           TEXT           NOT NULL,
  "program_ref"               TEXT           NOT NULL,
  "period_year"               INTEGER        NOT NULL,
  "period_month"              INTEGER        NOT NULL,
  "attainment_pace"           NUMERIC(5,4)   NOT NULL,
  "weighting_method"          TEXT           NOT NULL,
  "tier_data"                 JSONB          NOT NULL DEFAULT '[]',
  "weighting_inputs"          JSONB          NOT NULL DEFAULT '{}',
  "recommended_amount"        NUMERIC(15,2)  NOT NULL,
  "rule_version"              TEXT           NOT NULL,
  "state"                     TEXT           NOT NULL DEFAULT 'RECOMMENDATION_READY',
  "approved_by"               TEXT,
  "approved_at"               TIMESTAMPTZ,
  "posting_item_id"           TEXT,
  "is_double_accrual_guarded" BOOLEAN        NOT NULL DEFAULT false,
  "created_at"                TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "incentive_accrual_recommendations_tenant_entity_year_month_idx" ON "incentive_accrual_recommendations" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "incentive_accrual_recommendations" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incentive_accrual_recommendations' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "incentive_accrual_recommendations"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "composite_exports" (
  "id"                     TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT         NOT NULL,
  "legal_entity_id"        TEXT         NOT NULL,
  "export_type"            TEXT         NOT NULL,
  "format_profile_version" TEXT         NOT NULL,
  "period_year"            INTEGER      NOT NULL,
  "period_month"           INTEGER      NOT NULL,
  "state"                  TEXT         NOT NULL DEFAULT 'PENDING',
  "export_file_ref"        TEXT,
  "export_hash"            TEXT,
  "generated_by"           TEXT,
  "approved_by"            TEXT,
  "approved_at"            TIMESTAMPTZ,
  "response_record"        JSONB,
  "retention_ref"          TEXT,
  "created_at"             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "composite_exports_tenant_entity_year_month_idx" ON "composite_exports" ("tenant_id", "legal_entity_id", "period_year", "period_month");

ALTER TABLE "composite_exports" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'composite_exports' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "composite_exports"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "gaap_bridge_memos" (
  "id"                 TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"          TEXT         NOT NULL,
  "legal_entity_id"    TEXT         NOT NULL,
  "period_year"        INTEGER      NOT NULL,
  "period_month"       INTEGER      NOT NULL,
  "state"              TEXT         NOT NULL DEFAULT 'DRAFT',
  "scaffold"           JSONB        NOT NULL DEFAULT '{}',
  "policy_differences" JSONB        NOT NULL DEFAULT '[]',
  "editor_history"     JSONB        NOT NULL DEFAULT '[]',
  "finalized_by"       TEXT,
  "finalized_at"       TIMESTAMPTZ,
  "s016_snapshot_ref"  TEXT,
  "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "gaap_bridge_memos_tenant_entity_year_month_key" UNIQUE ("tenant_id", "legal_entity_id", "period_year", "period_month")
);
CREATE INDEX IF NOT EXISTS "gaap_bridge_memos_tenant_entity_idx" ON "gaap_bridge_memos" ("tenant_id", "legal_entity_id");

ALTER TABLE "gaap_bridge_memos" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gaap_bridge_memos' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "gaap_bridge_memos"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "dsar_cases" (
  "id"                        TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"                 TEXT         NOT NULL,
  "subject_identifier"        TEXT         NOT NULL,
  "verification_evidence"     JSONB        NOT NULL DEFAULT '{}',
  "request_type"              TEXT         NOT NULL,
  "state"                     TEXT         NOT NULL DEFAULT 'INTAKE',
  "scan_result"               JSONB        NOT NULL DEFAULT '{}',
  "disclosure_package_ref"    TEXT,
  "erasure_approval1_by"      TEXT,
  "erasure_approval1_at"      TIMESTAMPTZ,
  "erasure_approval2_by"      TEXT,
  "erasure_approval2_at"      TIMESTAMPTZ,
  "s017_shred_event_ref"      TEXT,
  "financial_integrity_proof" JSONB        NOT NULL DEFAULT '{}',
  "statutory_deadline"        TIMESTAMPTZ,
  "closed_at"                 TIMESTAMPTZ,
  "created_at"                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"                TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dsar_cases_tenant_state_idx" ON "dsar_cases" ("tenant_id", "state");

ALTER TABLE "dsar_cases" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dsar_cases' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "dsar_cases"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "unclaimed_property_items" (
  "id"                    TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"             TEXT           NOT NULL,
  "legal_entity_id"       TEXT           NOT NULL,
  "source_queue"          TEXT           NOT NULL,
  "source_item_id"        TEXT           NOT NULL,
  "holder_state"          TEXT           NOT NULL,
  "property_type"         TEXT           NOT NULL,
  "amount"                NUMERIC(15,2)  NOT NULL,
  "dormancy_date"         DATE           NOT NULL,
  "state"                 TEXT           NOT NULL DEFAULT 'CANDIDATE',
  "due_diligence_refs"    JSONB          NOT NULL DEFAULT '[]',
  "notice_attempts"       INTEGER        NOT NULL DEFAULT 0,
  "remittance_export_ref" TEXT,
  "posting_item_id"       TEXT,
  "created_at"            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "unclaimed_property_items_tenant_entity_state_idx" ON "unclaimed_property_items" ("tenant_id", "legal_entity_id", "state");
CREATE INDEX IF NOT EXISTS "unclaimed_property_items_tenant_source_item_idx" ON "unclaimed_property_items" ("tenant_id", "source_item_id");

ALTER TABLE "unclaimed_property_items" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'unclaimed_property_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "unclaimed_property_items"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "control_registries" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT         NOT NULL,
  "control_code"   TEXT         NOT NULL,
  "control_name"   TEXT         NOT NULL,
  "control_type"   TEXT         NOT NULL,
  "system_mapping" JSONB        NOT NULL DEFAULT '{}',
  "evidence_query" TEXT,
  "active"         BOOLEAN      NOT NULL DEFAULT true,
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "control_registries_tenant_control_key" UNIQUE ("tenant_id", "control_code")
);
CREATE INDEX IF NOT EXISTS "control_registries_tenant_idx" ON "control_registries" ("tenant_id");

ALTER TABLE "control_registries" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'control_registries' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "control_registries"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "evidence_binders" (
  "id"                     TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"              TEXT         NOT NULL,
  "legal_entity_id"        TEXT         NOT NULL,
  "control_id"             TEXT         NOT NULL,
  "period_year"            INTEGER      NOT NULL,
  "period_month"           INTEGER      NOT NULL,
  "state"                  TEXT         NOT NULL DEFAULT 'ASSEMBLING',
  "evidence_records"       JSONB        NOT NULL DEFAULT '[]',
  "binder_hash"            TEXT,
  "missing_evidence_flags" JSONB        NOT NULL DEFAULT '[]',
  "assembled_by"           TEXT,
  "attested_by"            TEXT,
  "attested_at"            TIMESTAMPTZ,
  "s017_class_ref"         TEXT,
  "created_at"             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "evidence_binders_tenant_entity_control_year_month_key" UNIQUE ("tenant_id", "legal_entity_id", "control_id", "period_year", "period_month")
);
CREATE INDEX IF NOT EXISTS "evidence_binders_tenant_entity_state_idx" ON "evidence_binders" ("tenant_id", "legal_entity_id", "state");

ALTER TABLE "evidence_binders" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evidence_binders' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "evidence_binders"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- Automation domain-event outbox. Deliberately service-owned rather than the
-- shared outbox_events table, whose existing column set is incompatible; see
-- the comment on model OutboxEvent in schema.prisma.
CREATE TABLE IF NOT EXISTS "automation_outbox" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"      TEXT         NOT NULL,
  "aggregate_id"   TEXT         NOT NULL,
  "event_type"     TEXT         NOT NULL,
  "payload"        JSONB        NOT NULL,
  "correlation_id" TEXT,
  "published"      BOOLEAN      NOT NULL DEFAULT false,
  "published_at"   TIMESTAMPTZ,
  "retry_count"    INTEGER      NOT NULL DEFAULT 0,
  "last_error"     TEXT,
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "automation_outbox_published_created_at_idx" ON "automation_outbox" ("published", "created_at");
CREATE INDEX IF NOT EXISTS "automation_outbox_tenant_event_type_idx" ON "automation_outbox" ("tenant_id", "event_type");

ALTER TABLE "automation_outbox" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automation_outbox' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "automation_outbox"
      USING ("tenant_id" = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- Shared audit_outbox (CREATE TABLE IF NOT EXISTS — first service wins)
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenant_id"    TEXT         NOT NULL,
  "doc_type"     TEXT         NOT NULL,
  "doc_id"       TEXT         NOT NULL,
  "action"       TEXT         NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT         NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retry_count"  INTEGER      NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_outbox_publish_idx" ON "audit_outbox" ("published_at", "retry_count");
