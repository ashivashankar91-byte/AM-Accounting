-- AMACC-CH04 S036A: Row Level Security for the vendor-master tables,
-- following the exact pattern already shipped for tenant-service/
-- coa-service/gl-service/auth-service (packages/shared-kernel/src/tenancy/
-- rls-middleware.ts sets app.current_tenant_id before every Prisma query;
-- FORCE ROW LEVEL SECURITY so it applies even to the app's own connection
-- role).
--
-- Scoped to S036A's own tables only (vendors, ap_vendor_number_counters,
-- ap_vendor_duplicate_acknowledgements) — apar-service's other tables
-- (ar_entries, ap_entries, ap_payments, customers, purchase_orders, po_lines,
-- ap_bank_accounts, outbox_events) belong to other, already-shipped stories
-- (S2-xx/S3-08/S5-01/S6-xx/S7-xx) and are out of S036A's scope boundary; a
-- follow-up story should extend RLS to them the same way S201's ADR-001
-- called for "pattern to extend to all new tables."
--
-- audit_outbox is deliberately EXCLUDED — it is a background-poller delivery
-- queue (AuditOutboxDrainer runs outside any per-request AsyncLocalStorage
-- tenant context), the same documented reason tenant-service/coa-service/
-- gl-service exclude their own audit_outbox/tenant_outbox_events tables from
-- RLS (see 20260727000001_exclude_outbox_tables_from_rls_tenant_svc).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'vendors', 'ap_vendor_number_counters', 'ap_vendor_duplicate_acknowledgements'
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
