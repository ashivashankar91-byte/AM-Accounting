-- CE-13 — Row Level Security for every tenant-owned payroll-service table.
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc and
-- services/schedule-service's 20260730010001_add_rls_policies_schedule_svc
-- migrations.
--
-- outbox_events is deliberately EXCLUDED here: it is a shared physical
-- table backing six services' own OutboxEvent Prisma models (apar-service,
-- eom-service, group-service, gl-service, payroll-service, schedule-
-- service) — RLS policy ownership for that table belongs to whichever
-- service's migration establishes it first; this migration must not risk
-- conflicting with another service's outbox RLS posture.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'employees',
    'payroll_batches',
    'payroll_items',
    'payroll_gl_mappings',
    'payroll_tax_rates',
    'employee_ytd',
    'commission_plans',
    'commission_records',
    'payroll_tenant_config',
    'payroll_rule_pack_version',
    'clawback_records',
    'accrual_entries',
    'tech_flag_bridge_entries',
    'commission_disputes',
    'payroll_sensitive_read_audit'
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
