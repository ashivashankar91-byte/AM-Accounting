-- GL-service onboarding: PostgreSQL Row Level Security for every tenant-owned
-- table needed by the legacy GL stack before S014/S222/S227 can rely on it.
--
-- Most tables follow the shared 4-policy pattern verbatim:
--   SELECT / INSERT / UPDATE / DELETE keyed off app.current_tenant_id,
--   with FORCE ROW LEVEL SECURITY enabled.
--
-- Child tables without a tenant_id column (journal_lines, deal_product_lines,
-- journal_template_lines, gl_account_set_members) use the same four policy
-- names but derive tenancy through their tenant-owned parent row.
--
-- intercompany_entries is the single documented exception: existing shipped
-- behavior lets either the owning tenant or the counterparty tenant read the
-- row, so SELECT/UPDATE/DELETE policies preserve that dual-tenant visibility
-- instead of silently breaking it.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'gl_accounts',
    'gl_account_id_map',
    'journal_entries',
    'gl_account_period_balances',
    'history_transactions',
    'gl_system_config',
    'gl_sources',
    'journal_source_permissions',
    'gl_distributions',
    'lifo_layers',
    'tax_jurisdictions',
    'tax_exemptions',
    'tax_accrual_entries',
    'vendor_1099_records',
    'floor_plan_units',
    'journal_templates',
    'gl_account_sets',
    'vehicle_transfers',
    'oem_statement_mappings',
    'eom_archive_log',
    'fs_versions',
    'payroll_runs',
    'payroll_wage_bases'
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

ALTER TABLE "intercompany_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intercompany_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON "intercompany_entries";
CREATE POLICY tenant_isolation_select ON "intercompany_entries"
  FOR SELECT
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR counterparty_tenant_id = current_setting('app.current_tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON "intercompany_entries";
CREATE POLICY tenant_isolation_insert ON "intercompany_entries"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_update ON "intercompany_entries";
CREATE POLICY tenant_isolation_update ON "intercompany_entries"
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR counterparty_tenant_id = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR counterparty_tenant_id = current_setting('app.current_tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_delete ON "intercompany_entries";
CREATE POLICY tenant_isolation_delete ON "intercompany_entries"
  FOR DELETE
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR counterparty_tenant_id = current_setting('app.current_tenant_id', true)
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "intercompany_entries" TO amacc_rls_bypass;

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON "journal_lines";
CREATE POLICY tenant_isolation_select ON "journal_lines"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "journal_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON "journal_lines";
CREATE POLICY tenant_isolation_insert ON "journal_lines"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "journal_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_update ON "journal_lines";
CREATE POLICY tenant_isolation_update ON "journal_lines"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "journal_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "journal_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_delete ON "journal_lines";
CREATE POLICY tenant_isolation_delete ON "journal_lines"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "journal_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "journal_lines" TO amacc_rls_bypass;

ALTER TABLE "deal_product_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_product_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON "deal_product_lines";
CREATE POLICY tenant_isolation_select ON "deal_product_lines"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "deal_product_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON "deal_product_lines";
CREATE POLICY tenant_isolation_insert ON "deal_product_lines"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "deal_product_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_update ON "deal_product_lines";
CREATE POLICY tenant_isolation_update ON "deal_product_lines"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "deal_product_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "deal_product_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_delete ON "deal_product_lines";
CREATE POLICY tenant_isolation_delete ON "deal_product_lines"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = "deal_product_lines"."journal_entry_id"
        AND je.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "deal_product_lines" TO amacc_rls_bypass;

ALTER TABLE "journal_template_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_template_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON "journal_template_lines";
CREATE POLICY tenant_isolation_select ON "journal_template_lines"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "journal_templates" jt
      WHERE jt.id = "journal_template_lines"."template_id"
        AND jt.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON "journal_template_lines";
CREATE POLICY tenant_isolation_insert ON "journal_template_lines"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_templates" jt
      WHERE jt.id = "journal_template_lines"."template_id"
        AND jt.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_update ON "journal_template_lines";
CREATE POLICY tenant_isolation_update ON "journal_template_lines"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_templates" jt
      WHERE jt.id = "journal_template_lines"."template_id"
        AND jt.tenant_id = current_setting('app.current_tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "journal_templates" jt
      WHERE jt.id = "journal_template_lines"."template_id"
        AND jt.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_delete ON "journal_template_lines";
CREATE POLICY tenant_isolation_delete ON "journal_template_lines"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "journal_templates" jt
      WHERE jt.id = "journal_template_lines"."template_id"
        AND jt.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "journal_template_lines" TO amacc_rls_bypass;

ALTER TABLE "gl_account_set_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gl_account_set_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON "gl_account_set_members";
CREATE POLICY tenant_isolation_select ON "gl_account_set_members"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "gl_account_sets" gs
      WHERE gs.id = "gl_account_set_members"."set_id"
        AND gs.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON "gl_account_set_members";
CREATE POLICY tenant_isolation_insert ON "gl_account_set_members"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "gl_account_sets" gs
      WHERE gs.id = "gl_account_set_members"."set_id"
        AND gs.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_update ON "gl_account_set_members";
CREATE POLICY tenant_isolation_update ON "gl_account_set_members"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "gl_account_sets" gs
      WHERE gs.id = "gl_account_set_members"."set_id"
        AND gs.tenant_id = current_setting('app.current_tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "gl_account_sets" gs
      WHERE gs.id = "gl_account_set_members"."set_id"
        AND gs.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_delete ON "gl_account_set_members";
CREATE POLICY tenant_isolation_delete ON "gl_account_set_members"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "gl_account_sets" gs
      WHERE gs.id = "gl_account_set_members"."set_id"
        AND gs.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "gl_account_set_members" TO amacc_rls_bypass;
