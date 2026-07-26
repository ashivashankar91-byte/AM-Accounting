-- FINAL-R0 Foundation Completion: renamed from an original migration folder
-- that collided, by literal name, with an identically-named migration in
-- another service's own prisma/migrations directory. Because every AMACC
-- service shares ONE physical Postgres database/schema (and therefore ONE
-- shared `_prisma_migrations` tracking table), `prisma migrate deploy`
-- matches purely on migration_name — whichever service applied a given name
-- FIRST caused every other service with an identically-named migration to be
-- silently SKIPPED (treated as already applied) on a clean deploy, even
-- though the SQL bodies differ per service. This was found by actually
-- deploying all four services' migrations onto one clean database in
-- sequence: tenant-service's own RLS-enabling migration for
-- legal_entities/stores/departments/franchises never ran (relrowsecurity
-- was false for all of them), and audit-service's own RLS-enabling
-- migration for audit_logs never ran either — both are real, previously
-- uncertified tenant-isolation gaps, not just a cosmetic renaming issue.
-- Content below is unchanged from the original; only the folder (and hence
-- the tracked migration_name) was renamed to be unique across services.
-- R0 Stabilization Phase 5 (ADR-001): PostgreSQL Row Level Security.
-- ADR-001 claimed this was already delivered for legal_entities and
-- tenant_outbox_events ("WI-UQ01-01... implements the RLS pattern... as the
-- reference implementation") — a repository-wide grep found zero RLS
-- policies anywhere (see docs/accounting-modernization/repository-verification/
-- TENANT_ISOLATION_VERIFICATION.md). This migration builds it for real,
-- covering every tenant-owned table in tenant-service (not just the two
-- ADR-001 named — "pattern to extend to all new tables in S201+").
--
-- Session variable: app.current_tenant_id, set by
-- packages/shared-kernel/src/tenancy/rls-middleware.ts before every Prisma
-- query. FORCE ROW LEVEL SECURITY applies policies even to the table owner
-- (the same role the application connects as) — without FORCE, RLS would
-- silently not apply to the app's own queries at all.
--
-- Explicit, constrained admin/migration bypass: a dedicated role with
-- BYPASSRLS, NOT the application's runtime role, NOLOGIN (granted to a
-- superuser session via SET ROLE when a genuine cross-tenant admin
-- operation is required — never implicit, never the default).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'legal_entities', 'stores', 'departments', 'franchises',
    'tenant_outbox_events', 'audit_outbox'
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
