-- CE-07 / S023 narrow S019/S020 engine change, authorized by D-S023-22 and
-- D-S023-25: adds the dual-version replay-evidence table
-- (posting_execution_replay) required by the approved replay policy
-- (S023_DECISION_REGISTER.md D-S023-25). Does NOT add a second row per
-- (tenantId, eventId) — a replay updates the existing posting_execution row
-- in place (same idempotency-identity contract as today) and this table
-- records the before/after pack-version evidence alongside it.
--
-- No new failure-taxonomy enum column is added: posting_exception.reason_code
-- was already a free-form string (previously only NO_RULE_MATCH and
-- EVENT_IDENTITY_CONFLICT were ever written); the application layer now also
-- writes AMBIGUOUS_RULE_PACK_MATCH, UNBALANCED_BLUEPRINT, INVALID_ACCOUNT,
-- MISSING_MANDATORY_FIELD and RULE_PACK_EVALUATION_ERROR to the same column
-- (see posting-engine-service.ts) — additive application behavior, no schema
-- change required for that part.

-- D-S023-21 — closed, deterministic failure taxonomy. The original
-- posting_exception_reason_code_chk (20260729010000_add_posting_engine) only
-- allowed NO_RULE_MATCH/EVENT_IDENTITY_CONFLICT (the only 2 of ~5+ failure
-- kinds that got a distinct code before this change). Expanded, additive
-- only — no existing allowed value is removed.
ALTER TABLE "posting_exception" DROP CONSTRAINT "posting_exception_reason_code_chk";
ALTER TABLE "posting_exception" ADD CONSTRAINT "posting_exception_reason_code_chk" CHECK ("reason_code" IN (
  'NO_RULE_MATCH', 'EVENT_IDENTITY_CONFLICT', 'AMBIGUOUS_RULE_PACK_MATCH',
  'UNBALANCED_BLUEPRINT', 'INVALID_ACCOUNT', 'MISSING_MANDATORY_FIELD',
  'PERIOD_CLOSED', 'RULE_PACK_EVALUATION_ERROR', 'POSTING_ENGINE_FAILURE'
));

CREATE TABLE "posting_execution_replay" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "original_rule_pack_version_id" TEXT,
  "replay_rule_pack_version_id" TEXT,
  "original_failure_reason_code" TEXT,
  "original_failure_reason_detail" TEXT,
  "replay_actor" TEXT NOT NULL,
  "replay_reason" TEXT NOT NULL,
  "original_business_date" DATE NOT NULL,
  "original_attempted_period_id" TEXT,
  "current_posting_period_id" TEXT,
  "resulting_status" TEXT NOT NULL,
  "resulting_journal_entry_id" TEXT,
  "resulting_journal_number" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "posting_execution_replay_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_execution_replay_tenant_id_execution_id_idx" ON "posting_execution_replay"("tenant_id", "execution_id");

ALTER TABLE "posting_execution_replay" ADD CONSTRAINT "posting_execution_replay_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "posting_execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Row Level Security (ADR-001 pattern; matches 20260729010000_add_posting_engine) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  ALTER TABLE "posting_execution_replay" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "posting_execution_replay" FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_select ON "posting_execution_replay";
  CREATE POLICY tenant_isolation_select ON "posting_execution_replay" FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_insert ON "posting_execution_replay";
  CREATE POLICY tenant_isolation_insert ON "posting_execution_replay" FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_update ON "posting_execution_replay";
  CREATE POLICY tenant_isolation_update ON "posting_execution_replay" FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_delete ON "posting_execution_replay";
  CREATE POLICY tenant_isolation_delete ON "posting_execution_replay" FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

  GRANT SELECT, INSERT, UPDATE, DELETE ON "posting_execution_replay" TO amacc_rls_bypass;
END $$;
