-- FINAL-R0 Foundation Completion: renamed from an original migration folder
-- that collided, by literal name, with an identically-named migration in
-- another service's own prisma/migrations directory. Because every AMACC
-- service shares ONE physical Postgres database/schema (and therefore ONE
-- shared `_prisma_migrations` tracking table), `prisma migrate deploy`
-- matches purely on migration_name — whichever service applied a given name
-- FIRST caused every other service with an identically-named migration to be
-- silently SKIPPED (treated as already applied) on a clean deploy, even
-- though the SQL bodies differ per service. This was found by actually
-- deploying all four services' migrations onto one clean database in
-- sequence: tenant-service's own RLS-enabling migration for
-- legal_entities/stores/departments/franchises never ran (relrowsecurity
-- was false for all of them), and audit-service's own RLS-enabling
-- migration for audit_logs never ran either — both are real, previously
-- uncertified tenant-isolation gaps, not just a cosmetic renaming issue.
-- Content below is unchanged from the original; only the folder (and hence
-- the tracked migration_name) was renamed to be unique across services.
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
