-- AI Agents dashboard backing store (see AgentActionLog model comment in
-- schema.prisma). Shared across all 5 agent runtime services (agent-gl,
-- agent-eom, agent-payroll, agent-apar, agent-t1) via a plain `pg` client —
-- unlike audit_logs above, this table is intentionally NOT immutable, since
-- resolveHumanRequired() must update human_required/human_resolved_at.
--
-- RLS follows the same tenant_isolation pattern as every other tenant-owned
-- table (see 20260726000002_add_rls_policies_audit_svc), with UPDATE
-- included (unlike the append-only audit_logs, which only added UPDATE/
-- DELETE policies for defense-in-depth around its immutability trigger).

-- CreateTable
CREATE TABLE "agent_action_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "input_summary" TEXT NOT NULL DEFAULT '',
    "action_taken" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "human_required" BOOLEAN NOT NULL DEFAULT false,
    "human_resolved_at" TIMESTAMP(3),
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_created_at_idx" ON "agent_action_logs"("tenant_id", "created_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  ALTER TABLE agent_action_logs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agent_action_logs FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_select ON agent_action_logs;
  CREATE POLICY tenant_isolation_select ON agent_action_logs
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_insert ON agent_action_logs;
  CREATE POLICY tenant_isolation_insert ON agent_action_logs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_update ON agent_action_logs;
  CREATE POLICY tenant_isolation_update ON agent_action_logs
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_delete ON agent_action_logs;
  CREATE POLICY tenant_isolation_delete ON agent_action_logs
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

  GRANT SELECT, INSERT, UPDATE, DELETE ON agent_action_logs TO amacc_rls_bypass;
END $$;

-- Matches infra/postgres/init/01-create-app-role.sql's ALTER DEFAULT
-- PRIVILEGES, which only covers tables created AFTER that init script ran.
-- Explicit GRANT here so a fresh environment doesn't depend on ordering.
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_action_logs TO amacc_app;
