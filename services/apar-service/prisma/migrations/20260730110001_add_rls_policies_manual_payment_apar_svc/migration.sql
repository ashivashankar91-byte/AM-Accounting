-- S043A: Row Level Security for ap_manual_payments, following the exact
-- pattern shipped for S036A/S038/S046/S039/S041 (see
-- 20260729010001_add_rls_policies_apar_svc for the amacc_rls_bypass
-- rationale, referenced here rather than repeated).

DO $$
DECLARE
  t TEXT := 'ap_manual_payments';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

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
END $$;
