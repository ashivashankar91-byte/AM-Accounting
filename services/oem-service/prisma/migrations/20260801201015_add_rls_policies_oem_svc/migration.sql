-- CE-14: Row Level Security for oem-service, following the exact pattern
-- shipped for tenant-service/coa-service/gl-service/auth-service/apar-service
-- /tax-service/schedule-service (packages/shared-kernel/src/tenancy/
-- rls-middleware.ts sets app.current_tenant_id before every Prisma query;
-- FORCE ROW LEVEL SECURITY so it applies even to the app's own connection
-- role). Scoped to every tenant-owned table this service defines.
--
-- oem_integration_profiles (not oem_profiles): fs-service's pre-existing
-- Stream 4 financial-statement module already owns the "oem_profiles" /
-- "oem_account_mappings" table names in this shared physical database
-- (services/fs-service/prisma/schema.prisma) for a different, earlier,
-- non-governed OEM statement feature. CE-14's tables are named distinctly
-- to avoid the collision; see the epic's final report for the two
-- modules' relationship (not a CE-14 dependency — fs-service's Stream 4
-- predates this epic package and is out of CE-14's scope).
--
-- outbox_events / audit_outbox are deliberately EXCLUDED — shared
-- background-poller delivery queue tables (OutboxProcessor/AuditOutboxDrainer
-- run outside any per-request tenant context), same documented reason every
-- other service excludes them.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'oem_integration_profiles', 'oem_dealer_codes', 'oem_staged_documents', 'oem_staged_document_rows',
    'oem_diff_alerts', 'oem_match_sessions', 'oem_match_session_rows',
    'oem_incentive_programs', 'oem_incentive_accruals', 'oem_incentive_true_ups',
    'oem_statement_profiles', 'oem_statement_account_mappings', 'oem_statement_renders', 'oem_statement_exports',
    'oem_warranty_chargeback_notices', 'oem_warranty_chargeback_lines', 'oem_warranty_dispute_evidence',
    'oem_warranty_reserve_configs', 'oem_warranty_reserve_previews', 'oem_warranty_reserve_draws',
    'oem_coop_programs', 'oem_coop_claims', 'oem_coop_claim_lines', 'oem_coop_accrual_previews',
    'oem_idempotency_records'
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
