-- CE-12 (S074-S077) — Row Level Security for every tenant-owned table.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc migration,
-- which itself mirrors services/posting-recovery-service's
-- 20260729010001_add_rls_policies_posting_recovery_svc migration.
--
-- audit_outbox (this service's audit outbox) is EXCLUDED from RLS in the
-- final statement below — the background AuditOutboxDrainer runs outside
-- tenant request context, exactly like posting-recovery's
-- posting_recovery_audit_reference / coa-service's audit_outbox exclusion.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'vehicle_unit',
    'vehicle_cost_component',
    'vehicle_stock_in_event',
    'vehicle_recon_cost_event',
    'vehicle_cost_component_event',
    'vehicle_pack_policy_config',
    'demo_reclass',
    'demo_depreciation_basis_config',
    'demo_value_adjustment',
    'lcnrv_threshold_config',
    'lcnrv_market_evidence',
    'lcnrv_write_down',
    'dealer_trade',
    'dealer_trade_settlement'
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

-- audit_outbox: excluded from RLS (background drainer), same rationale/
-- pattern as tax_audit_reference / posting_recovery_audit_reference /
-- coa-service's audit_outbox exclusion.
ALTER TABLE "audit_outbox" DISABLE ROW LEVEL SECURITY;
