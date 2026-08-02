-- CE-12 (Workstream R: S091/S092/S093/S094) — Row Level Security for every
-- tenant-owned table in fni-reserve-service.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc migration,
-- which itself mirrors services/posting-recovery-service's
-- 20260729010001_add_rls_policies_posting_recovery_svc migration.
--
-- fni_reserve_audit_outbox is EXCLUDED from RLS in the final statement below — the
-- background audit drainer runs outside tenant request context, exactly like
-- every other service's own audit-outbox table.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'lender_program_config',
    'provider_program_config',
    'deferral_mode_config',
    'fni_schedule_mapping',
    'reserve_remittance',
    'remittance_shortpay_disposition',
    'chargeback_reserve_accrual',
    'chargeback_draw',
    'remit_liability_tracking',
    'product_remit_run',
    'product_remit_run_item',
    'provider_statement_reconciliation',
    'provider_statement_line',
    'product_cancellation',
    'deferral_booking',
    'recognition_run_batch',
    'recognition_run_line'
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

-- fni_reserve_audit_outbox: excluded from RLS (background drainer), same rationale as
-- every other service's own audit-outbox table.
ALTER TABLE "fni_reserve_audit_outbox" DISABLE ROW LEVEL SECURITY;
