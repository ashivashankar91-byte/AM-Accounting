-- CE-11 (S059-S065) — Row Level Security for every tenant-owned table.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc migration.
--
-- Legal-entity scoping: several tables below also carry a legal_entity_id
-- column, but RLS policies stay tenant_id-keyed exactly like the tax-service
-- precedent — application-layer queries additionally filter by
-- legalEntityId, rather than duplicating that scoping into the RLS policy
-- itself.
--
-- audit_outbox_event / outbox_events are EXCLUDED from RLS in the final
-- statements below — the background drainer/publisher runs outside tenant
-- request context, exactly like tax_audit_reference's exclusion.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'wip_mode_election',
    'repair_order',
    'ro_close_submission',
    'ro_distribution_line',
    'ro_reversal',
    'tech_guarantee_config',
    'tech_time_absorption',
    'deferred_maintenance_contract',
    'deferred_maintenance_redemption',
    'sublet_purchase_order',
    'sublet_invoice_match',
    'warranty_claim_item',
    'warranty_claim_remittance',
    'warranty_claim_disposition',
    'fixedops_account_mapping',
    'fixedops_posting_exception'
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

-- fixedops_audit_outbox_event: excluded from RLS (background drainer),
-- same rationale/pattern as tax_audit_reference.
ALTER TABLE "fixedops_audit_outbox_event" DISABLE ROW LEVEL SECURITY;
