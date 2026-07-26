-- R0 Stabilization Phase 5 (ADR-001): PostgreSQL Row Level Security.
-- See services/tenant-service/prisma/migrations/20260726000003_add_rls_policies
-- for the full design rationale — identical pattern, applied here to every
-- tenant-owned table in coa-service (the largest surface: 17 tables across
-- S223/S208-S213/S010/S013/S214-S219).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'attachment', 'audit_outbox', 'balance_snapshot', 'coa_outbox_events',
    'coa_seed_run', 'config_setting', 'fiscal_calendar', 'fiscal_period',
    'gl_account', 'gl_account_reparent', 'journal_entry', 'journal_line',
    'journal_sequence', 'journal_source', 'manual_je_draft',
    'manual_je_draft_revision', 'sequence_gap_log'
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
