-- S046: Row Level Security for the customer-master tables, following the
-- exact pattern already shipped for vendors (S036A migration
-- 20260729010001_add_rls_policies_apar_svc — see that file's header for the
-- amacc_rls_bypass rationale, referenced here rather than repeated).
--
-- Scoped to S046's own tables only (customers, ar_customer_number_counters,
-- ar_customer_duplicate_acknowledgements). apar-service's other tables
-- (ar_entries, ap_entries, ap_payments, vendors + its own S036A tables,
-- purchase_orders, po_lines, ap_bank_accounts, outbox_events) belong to
-- other, already-shipped or already-RLS'd stories and are out of S046's
-- scope boundary.
--
-- audit_outbox is deliberately EXCLUDED — same documented reason as
-- 20260729010001 (background-poller delivery queue, outside any per-request
-- AsyncLocalStorage tenant context).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'customers', 'ar_customer_number_counters', 'ar_customer_duplicate_acknowledgements'
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
