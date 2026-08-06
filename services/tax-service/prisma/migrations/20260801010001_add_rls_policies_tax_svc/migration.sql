-- CE-10 (S124/S125) — Row Level Security for every tenant-owned table.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/posting-recovery-service's
-- 20260729010001_add_rls_policies_posting_recovery_svc migration.
--
-- Legal-entity scoping: every table below also carries a legal_entity_id
-- column (see prisma/schema.prisma), but RLS policies stay tenant_id-keyed
-- exactly like the posting-recovery precedent — application-layer queries
-- additionally filter by legalEntityId (see src/domain/legal-entity-scope.ts
-- and the live-db cross-entity-denial test), rather than duplicating that
-- scoping into the RLS policy itself.
--
-- tax_audit_reference (this service's audit outbox) is EXCLUDED from RLS in
-- the final statement below — the background audit drainer runs outside
-- tenant request context, exactly like posting-recovery's
-- posting_recovery_audit_reference / gl-service's audit_outbox.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'tax_engine_config',
    'jurisdiction_registration',
    'exemption_certificate',
    'tax_result',
    'tax_result_line',
    'tax_integrity_alert',
    'tax_engine_attempt_log',
    'tax_exception',
    'tax_exception_disposition',
    'tax_account_mapping_ref',
    'fee_table',
    'fee_table_applicability_tag',
    'fee_table_usage_reference'
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

-- tax_audit_reference: excluded from RLS (background drainer), same
-- rationale/pattern as posting_recovery_audit_reference /
-- gl-service's outbox_events exclusion migration.
ALTER TABLE "tax_audit_reference" DISABLE ROW LEVEL SECURITY;
