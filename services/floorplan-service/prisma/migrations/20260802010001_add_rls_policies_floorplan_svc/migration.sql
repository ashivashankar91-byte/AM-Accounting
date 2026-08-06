-- CE-12 (S079/S080/S081/S082) — Row Level Security for every tenant-owned
-- table.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc migration,
-- which itself mirrors services/posting-recovery-service's
-- 20260729010001_add_rls_policies_posting_recovery_svc migration.
--
-- floorplan_audit_reference (this service's audit outbox) is EXCLUDED from
-- RLS in the final statement below — the background audit drainer runs
-- outside tenant request context, exactly like tax_audit_reference /
-- posting_recovery_audit_reference / gl-service's outbox_events exclusion.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'floorplan_lender_profile',
    'floorplan_import_batch',
    'floorplan_staged_row',
    'floorplan_liability_item',
    'floorplan_liability_application',
    'floorplan_match',
    'floorplan_break',
    'floorplan_break_disposition',
    'floorplan_delivery_event',
    'floorplan_sot_exception',
    'floorplan_sot_escalation_history',
    'floorplan_interest_statement',
    'floorplan_interest_allocation',
    'floorplan_curtailment_schedule_config',
    'floorplan_curtailment_payment',
    'floorplan_tenant_config'
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

-- floorplan_audit_reference: excluded from RLS (background drainer), same
-- rationale/pattern as tax_audit_reference / posting_recovery_audit_reference.
ALTER TABLE "floorplan_audit_reference" DISABLE ROW LEVEL SECURITY;
