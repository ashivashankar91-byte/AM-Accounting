-- R0 Stabilization Phase 5 (ADR-001): PostgreSQL Row Level Security.
-- See services/tenant-service/prisma/migrations/20260726000003_add_rls_policies
-- for the full design rationale. audit_logs has an immutable trigger
-- blocking UPDATE/DELETE already (make_auditlog_immutable.sql) — the
-- tenant_isolation_update/delete policies below are still added for
-- consistency and defense-in-depth (a caller that somehow reached UPDATE/
-- DELETE would be blocked by RLS before even reaching the trigger), but in
-- practice the trigger is the primary immutability control, not these
-- policies.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_select ON audit_logs;
  CREATE POLICY tenant_isolation_select ON audit_logs
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_insert ON audit_logs;
  CREATE POLICY tenant_isolation_insert ON audit_logs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_update ON audit_logs;
  CREATE POLICY tenant_isolation_update ON audit_logs
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_delete ON audit_logs;
  CREATE POLICY tenant_isolation_delete ON audit_logs
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

  GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO amacc_rls_bypass;
END $$;
