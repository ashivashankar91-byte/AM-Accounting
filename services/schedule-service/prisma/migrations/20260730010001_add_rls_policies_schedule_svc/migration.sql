-- S026: Row Level Security for schedule-service, following the exact pattern
-- shipped for tenant-service/coa-service/gl-service/auth-service/apar-service
-- (packages/shared-kernel/src/tenancy/rls-middleware.ts sets
-- app.current_tenant_id before every Prisma query; FORCE ROW LEVEL SECURITY
-- so it applies even to the app's own connection role).
--
-- schedule-service had NO RLS at all before this migration (it also had no
-- migration history at all before 20260518000000_schedule_service_baseline
-- in this same PR) — scoped to every tenant-owned table this service owns,
-- both the pre-existing Wave-3 base layer (schedules, schedule_details,
-- schedule_permissions) and S026's new open-item tables, since this is the
-- first RLS migration this service has ever had.
--
-- outbox_events is deliberately EXCLUDED — shared background-poller delivery
-- queue table (OutboxProcessor runs outside any per-request tenant context),
-- same documented reason tenant-service/coa-service/gl-service/apar-service
-- exclude their own outbox tables from RLS.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'schedules', 'schedule_details', 'schedule_permissions',
    'schedule_open_items', 'schedule_applications', 'schedule_gl_tie_outs'
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
