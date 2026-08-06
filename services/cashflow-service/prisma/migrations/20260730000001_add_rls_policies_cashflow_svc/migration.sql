-- cashflow-service — Row Level Security for both tenant-owned tables,
-- completing the "Prisma baseline" (20260730000000_cashflow_baseline
-- created the tables with app-level `WHERE tenantId = ...` scoping only —
-- correct per CLAUDE.md's rule 2, but every other tenant-owned table in
-- this codebase also gets DB-level RLS as defense-in-depth; cashflow-service
-- had none). Follows the shared 4-policy pattern verbatim (SELECT/INSERT/
-- UPDATE/DELETE keyed on app.current_tenant_id, FORCE ROW LEVEL SECURITY),
-- mirroring services/gl-service's 20260728010001_add_rls_policies_gl_svc
-- and posting-recovery-service's equivalent migration.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['cashflow_forecasts', 'daily_cash_actuals'];
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
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO amacc_app', t);
  END LOOP;
END $$;
