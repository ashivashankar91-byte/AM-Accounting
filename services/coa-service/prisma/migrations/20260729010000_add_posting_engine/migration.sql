-- S019/S020 — Posting Engine: DSL rule packs + idempotent posting
-- orchestration. Additive only. This slice never writes journal_entry/
-- journal_line directly — posting_execution.journal_entry_id/journal_number
-- are read-only pointers to rows created exclusively through the existing
-- PostingService.post() accepted path (no FK is added to journal_entry so
-- this schema cannot itself become a second write path into the ledger).

-- CreateTable
CREATE TABLE "posting_rule_pack" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pack_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_rule_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rule_pack_version" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_pack_id" TEXT NOT NULL,
    "pack_key" TEXT NOT NULL,
    "semver" TEXT NOT NULL,
    "dsl_version" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_schema_versions" TEXT[],
    "entity_id" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "journal_source_code" TEXT NOT NULL,
    "match_strategy" TEXT NOT NULL,
    "no_match_behavior" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validation_findings" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMP(3),
    "activated_by" TEXT,
    "activated_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "posting_rule_pack_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posting_rule_pack_version_status_chk" CHECK ("status" IN ('DRAFT','VALIDATED','ACTIVE','SUPERSEDED','REJECTED')),
    CONSTRAINT "posting_rule_pack_version_match_strategy_chk" CHECK ("match_strategy" IN ('FIRST_MATCH')),
    CONSTRAINT "posting_rule_pack_version_no_match_behavior_chk" CHECK ("no_match_behavior" IN ('NO_RULE_MATCH_EXCEPTION'))
);

-- CreateTable
CREATE TABLE "posting_execution" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_schema_version" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_entity_type" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "business_date" DATE NOT NULL,
    "event_hash" TEXT NOT NULL,
    "event_envelope" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "rule_pack_version_id" TEXT,
    "rule_id" TEXT,
    "blueprint_hash" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_execution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posting_execution_status_chk" CHECK ("status" IN ('POSTED','NO_RULE_MATCH','IDENTITY_CONFLICT','REJECTED','FAILED'))
);

-- CreateTable
CREATE TABLE "posting_execution_attempt" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_execution_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posting_execution_attempt_outcome_chk" CHECK ("outcome" IN ('STARTED','POSTED','DUPLICATE','NO_RULE_MATCH','IDENTITY_CONFLICT','REJECTED','FAILED'))
);

-- CreateTable
CREATE TABLE "posting_exception" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_detail" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_schema_version" TEXT NOT NULL,
    "rule_pack_versions_considered" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_exception_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posting_exception_reason_code_chk" CHECK ("reason_code" IN ('NO_RULE_MATCH','EVENT_IDENTITY_CONFLICT'))
);

-- CreateIndex
CREATE INDEX "posting_rule_pack_tenant_id_idx" ON "posting_rule_pack"("tenant_id");
CREATE UNIQUE INDEX "posting_rule_pack_tenant_id_pack_key_key" ON "posting_rule_pack"("tenant_id", "pack_key");

CREATE INDEX "posting_rule_pack_version_tenant_id_event_type_status_idx" ON "posting_rule_pack_version"("tenant_id", "event_type", "status");
CREATE INDEX "posting_rule_pack_version_tenant_id_rule_pack_id_idx" ON "posting_rule_pack_version"("tenant_id", "rule_pack_id");
CREATE UNIQUE INDEX "posting_rule_pack_version_tenant_id_pack_key_semver_key" ON "posting_rule_pack_version"("tenant_id", "pack_key", "semver");

CREATE INDEX "posting_execution_tenant_id_event_type_status_idx" ON "posting_execution"("tenant_id", "event_type", "status");
CREATE INDEX "posting_execution_tenant_id_correlation_id_idx" ON "posting_execution"("tenant_id", "correlation_id");
CREATE INDEX "posting_execution_tenant_id_source_entity_id_idx" ON "posting_execution"("tenant_id", "source_entity_id");
CREATE UNIQUE INDEX "posting_execution_tenant_id_event_id_key" ON "posting_execution"("tenant_id", "event_id");

CREATE INDEX "posting_execution_attempt_tenant_id_idx" ON "posting_execution_attempt"("tenant_id");
CREATE UNIQUE INDEX "posting_execution_attempt_execution_id_attempt_number_key" ON "posting_execution_attempt"("execution_id", "attempt_number");

CREATE INDEX "posting_exception_tenant_id_reason_code_idx" ON "posting_exception"("tenant_id", "reason_code");
CREATE INDEX "posting_exception_tenant_id_execution_id_idx" ON "posting_exception"("tenant_id", "execution_id");

-- AddForeignKey
ALTER TABLE "posting_rule_pack_version" ADD CONSTRAINT "posting_rule_pack_version_rule_pack_id_fkey" FOREIGN KEY ("rule_pack_id") REFERENCES "posting_rule_pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "posting_execution" ADD CONSTRAINT "posting_execution_rule_pack_version_id_fkey" FOREIGN KEY ("rule_pack_version_id") REFERENCES "posting_rule_pack_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "posting_execution_attempt" ADD CONSTRAINT "posting_execution_attempt_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "posting_execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "posting_exception" ADD CONSTRAINT "posting_exception_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "posting_execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Activated-version immutability (BR S019-19) ──────────────────────────────
-- A DB trigger backstop, matching the enforce_period_postable() precedent
-- (20260728010000_s008_period_close_control): the application-layer guard in
-- PostingEngineService is not trusted alone. Once a version is ACTIVE or
-- SUPERSEDED, its content can never change, and it can never move back to
-- DRAFT/VALIDATED.
CREATE OR REPLACE FUNCTION enforce_posting_rule_pack_version_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('ACTIVE', 'SUPERSEDED') THEN
    IF NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.event_type IS DISTINCT FROM OLD.event_type
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
       OR NEW.journal_source_code IS DISTINCT FROM OLD.journal_source_code
    THEN
      RAISE EXCEPTION 'posting_rule_pack_version % is % and immutable — content cannot change', OLD.id, OLD.status
        USING ERRCODE = 'AMPG1';
    END IF;
    IF NEW.status IN ('DRAFT', 'VALIDATED') THEN
      RAISE EXCEPTION 'posting_rule_pack_version % cannot revert from % back to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'AMPG2';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posting_rule_pack_version_immutability ON "posting_rule_pack_version";
CREATE TRIGGER trg_posting_rule_pack_version_immutability
  BEFORE UPDATE ON "posting_rule_pack_version"
  FOR EACH ROW EXECUTE FUNCTION enforce_posting_rule_pack_version_immutability();

-- ── Row Level Security (ADR-001 pattern; see 20260726000002_add_rls_policies) ─
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'posting_rule_pack', 'posting_rule_pack_version', 'posting_execution',
    'posting_execution_attempt', 'posting_exception'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = current_setting(''app.current_tenant_id'', true))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = current_setting(''app.current_tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = current_setting(''app.current_tenant_id'', true))',
      t
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO amacc_rls_bypass', t);
  END LOOP;
END $$;
