-- S039: Row Level Security for the vendor-invoice/goods-receipt/match
-- tables, following the exact pattern shipped for S036A/S038/S046 (see
-- 20260729010001_add_rls_policies_apar_svc for the amacc_rls_bypass
-- rationale, referenced here rather than repeated).
--
-- vendor_invoice_lines, goods_receipt_lines and vendor_invoice_match_results
-- are child tables without their own tenant_id column — RLS is enforced via
-- the parent (vendor_invoices/goods_receipts), same convention as po_lines
-- (no RLS — parent purchase_orders carries it) and ap_payments' relationship
-- to ap_entries. They are intentionally excluded from this policy loop.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'goods_receipts', 'vendor_invoices',
    'ap_invoice_match_tolerance_configs', 'ap_invoice_match_overrides'
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
