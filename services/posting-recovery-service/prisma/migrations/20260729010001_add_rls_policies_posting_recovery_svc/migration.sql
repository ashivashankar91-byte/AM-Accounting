-- S021 Posting Recovery — Row Level Security for every tenant-owned table.
--
-- posting_dead_letter follows the shared 4-policy pattern verbatim (SELECT/
-- INSERT/UPDATE/DELETE keyed off app.current_tenant_id, FORCE ROW LEVEL
-- SECURITY) — mirrors services/gl-service's
-- 20260728010001_add_rls_policies_gl_svc migration.
--
-- Child tables (failure/attempt/correction/transition/assignment) carry
-- their own tenant_id column directly (unlike gl-service's journal_lines,
-- which derives tenancy through a parent join) — they get the same 4-policy
-- pattern keyed on their own tenant_id column, which is cheaper and
-- equivalent here since every insert into them is already tenant-scoped by
-- the service layer and their own tenant_id is part of every unique/index
-- already declared in the init migration.
--
-- posting_recovery_audit_reference (this service's audit outbox) is
-- deliberately EXCLUDED from RLS in the next migration — the background
-- audit drainer runs outside request-scoped tenant context, exactly like
-- gl-service's audit_outbox / tenant-service's AuditOutboxEvent.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'posting_dead_letter',
    'posting_dead_letter_failure',
    'posting_replay_attempt',
    'posting_correction_revision',
    'posting_case_transition',
    'posting_case_assignment'
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

-- posting_recovery_audit_reference: excluded from RLS (background drainer),
-- same rationale/pattern as
-- services/gl-service/prisma/migrations/20260728010002_exclude_outbox_tables_from_rls_gl_svc.
ALTER TABLE "posting_recovery_audit_reference" DISABLE ROW LEVEL SECURITY;
