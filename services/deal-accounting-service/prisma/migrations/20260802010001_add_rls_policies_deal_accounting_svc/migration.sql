-- CE-12 (Workstream D — deal-accounting-service) — Row Level Security for
-- every tenant-owned table. Follows the shared 4-policy pattern verbatim
-- (SELECT/INSERT/UPDATE/DELETE keyed off app.current_tenant_id, FORCE ROW
-- LEVEL SECURITY) — mirrors services/tax-service's
-- 20260801010001_add_rls_policies_tax_svc migration exactly.
--
-- deal_audit_reference (this service's audit outbox) and deal_outbox_event
-- (this service's generic PUTR-event outbox) are EXCLUDED from RLS in the
-- final statements below — the background audit/outbox drainers run outside
-- tenant request context, exactly like tax-service's tax_audit_reference /
-- posting-recovery-service's posting_recovery_audit_reference exclusion.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'deal',
    'deal_recap',
    'deal_review_case',
    'deal_posting_record',
    'deal_open_item',
    'deal_open_item_application',
    'cit_funding_receipt',
    'payoff_issuance',
    'wholesale_disposition',
    'arbitration_case',
    'deal_unwind',
    'deal_recontract',
    'deal_tenant_config'
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

-- Background-drainer tables: excluded from RLS, same rationale/pattern as
-- tax_audit_reference / posting_recovery_audit_reference.
ALTER TABLE "deal_audit_reference" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_outbox_event" DISABLE ROW LEVEL SECURITY;
