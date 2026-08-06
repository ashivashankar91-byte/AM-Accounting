-- CE-11 (S066-S072) — Row Level Security for every tenant-owned table.
--
-- Follows the shared 4-policy pattern verbatim (SELECT/INSERT/UPDATE/DELETE
-- keyed off app.current_tenant_id, FORCE ROW LEVEL SECURITY) — mirrors
-- services/tax-service's 20260801010001_add_rls_policies_tax_svc migration.
--
-- Five child-line tables (parts_reconciliation_variance_line,
-- price_tape_line, obsolescence_provision_line,
-- physical_inventory_count_line, oem_return_line) intentionally do NOT
-- carry their own tenant_id column — single source of truth stays on the
-- parent aggregate (parts_reconciliation_run / price_tape_load /
-- obsolescence_provision_run / physical_inventory_session /
-- oem_return_authorization respectively), exactly the same choice
-- coa-service's journal_line makes against journal_entry. Their RLS
-- policies below reference the parent's tenant_id via a subquery instead of
-- denormalizing tenant_id onto every line row.
--
-- audit_outbox_event / outbox_events are EXCLUDED from RLS in the final
-- statements below — the background drainer/publisher runs outside tenant
-- request context, exactly like tax_audit_reference's exclusion.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'parts_valuation_config',
    'parts_movement',
    'parts_perpetual_balance',
    'parts_reconciliation_run',
    'price_tape_load',
    'obsolescence_provision_run',
    'scrap_disposal',
    'physical_inventory_session',
    'escheat_jurisdiction_config',
    'special_order_deposit',
    'oem_return_program_config',
    'oem_return_authorization',
    'parts_account_mapping',
    'parts_posting_exception'
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

-- Child-line tables: tenant isolation via subquery to the parent aggregate.
ALTER TABLE "parts_reconciliation_variance_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parts_reconciliation_variance_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "parts_reconciliation_variance_line" FOR SELECT
  USING (run_id IN (SELECT id FROM parts_reconciliation_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_insert ON "parts_reconciliation_variance_line" FOR INSERT
  WITH CHECK (run_id IN (SELECT id FROM parts_reconciliation_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_update ON "parts_reconciliation_variance_line" FOR UPDATE
  USING (run_id IN (SELECT id FROM parts_reconciliation_run WHERE tenant_id = current_setting('app.current_tenant_id', true)))
  WITH CHECK (run_id IN (SELECT id FROM parts_reconciliation_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_delete ON "parts_reconciliation_variance_line" FOR DELETE
  USING (run_id IN (SELECT id FROM parts_reconciliation_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON "parts_reconciliation_variance_line" TO amacc_rls_bypass;

ALTER TABLE "price_tape_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_tape_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "price_tape_line" FOR SELECT
  USING (tape_load_id IN (SELECT id FROM price_tape_load WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_insert ON "price_tape_line" FOR INSERT
  WITH CHECK (tape_load_id IN (SELECT id FROM price_tape_load WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_update ON "price_tape_line" FOR UPDATE
  USING (tape_load_id IN (SELECT id FROM price_tape_load WHERE tenant_id = current_setting('app.current_tenant_id', true)))
  WITH CHECK (tape_load_id IN (SELECT id FROM price_tape_load WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_delete ON "price_tape_line" FOR DELETE
  USING (tape_load_id IN (SELECT id FROM price_tape_load WHERE tenant_id = current_setting('app.current_tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON "price_tape_line" TO amacc_rls_bypass;

ALTER TABLE "obsolescence_provision_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obsolescence_provision_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "obsolescence_provision_line" FOR SELECT
  USING (run_id IN (SELECT id FROM obsolescence_provision_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_insert ON "obsolescence_provision_line" FOR INSERT
  WITH CHECK (run_id IN (SELECT id FROM obsolescence_provision_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_update ON "obsolescence_provision_line" FOR UPDATE
  USING (run_id IN (SELECT id FROM obsolescence_provision_run WHERE tenant_id = current_setting('app.current_tenant_id', true)))
  WITH CHECK (run_id IN (SELECT id FROM obsolescence_provision_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_delete ON "obsolescence_provision_line" FOR DELETE
  USING (run_id IN (SELECT id FROM obsolescence_provision_run WHERE tenant_id = current_setting('app.current_tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON "obsolescence_provision_line" TO amacc_rls_bypass;

ALTER TABLE "physical_inventory_count_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_inventory_count_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "physical_inventory_count_line" FOR SELECT
  USING (session_id IN (SELECT id FROM physical_inventory_session WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_insert ON "physical_inventory_count_line" FOR INSERT
  WITH CHECK (session_id IN (SELECT id FROM physical_inventory_session WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_update ON "physical_inventory_count_line" FOR UPDATE
  USING (session_id IN (SELECT id FROM physical_inventory_session WHERE tenant_id = current_setting('app.current_tenant_id', true)))
  WITH CHECK (session_id IN (SELECT id FROM physical_inventory_session WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_delete ON "physical_inventory_count_line" FOR DELETE
  USING (session_id IN (SELECT id FROM physical_inventory_session WHERE tenant_id = current_setting('app.current_tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON "physical_inventory_count_line" TO amacc_rls_bypass;

ALTER TABLE "oem_return_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oem_return_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "oem_return_line" FOR SELECT
  USING (return_auth_id IN (SELECT id FROM oem_return_authorization WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_insert ON "oem_return_line" FOR INSERT
  WITH CHECK (return_auth_id IN (SELECT id FROM oem_return_authorization WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_update ON "oem_return_line" FOR UPDATE
  USING (return_auth_id IN (SELECT id FROM oem_return_authorization WHERE tenant_id = current_setting('app.current_tenant_id', true)))
  WITH CHECK (return_auth_id IN (SELECT id FROM oem_return_authorization WHERE tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY tenant_isolation_delete ON "oem_return_line" FOR DELETE
  USING (return_auth_id IN (SELECT id FROM oem_return_authorization WHERE tenant_id = current_setting('app.current_tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON "oem_return_line" TO amacc_rls_bypass;

-- parts_audit_outbox_event: excluded from RLS (background drainer), same
-- rationale/pattern as tax_audit_reference.
ALTER TABLE "parts_audit_outbox_event" DISABLE ROW LEVEL SECURITY;
