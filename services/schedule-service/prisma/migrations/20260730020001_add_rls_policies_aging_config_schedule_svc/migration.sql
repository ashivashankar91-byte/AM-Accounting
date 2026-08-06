-- S027: Row Level Security for schedule_aging_bucket_configs, same pattern
-- as migration 20260730010001_add_rls_policies_schedule_svc.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  ALTER TABLE schedule_aging_bucket_configs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE schedule_aging_bucket_configs FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_select ON schedule_aging_bucket_configs;
  CREATE POLICY tenant_isolation_select ON schedule_aging_bucket_configs FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_insert ON schedule_aging_bucket_configs;
  CREATE POLICY tenant_isolation_insert ON schedule_aging_bucket_configs FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_update ON schedule_aging_bucket_configs;
  CREATE POLICY tenant_isolation_update ON schedule_aging_bucket_configs FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

  DROP POLICY IF EXISTS tenant_isolation_delete ON schedule_aging_bucket_configs;
  CREATE POLICY tenant_isolation_delete ON schedule_aging_bucket_configs FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

  GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_aging_bucket_configs TO amacc_rls_bypass;
END $$;
