-- S221 — extend the coa-service RLS baseline (see
-- 20260726000002_add_rls_policies) to cover the new saved_gl_search table.
-- Same 4-policy tenant-isolation pattern, FORCE ROW LEVEL SECURITY.

ALTER TABLE "saved_gl_search" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_gl_search" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "saved_gl_search";
CREATE POLICY tenant_isolation_select ON "saved_gl_search"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_insert ON "saved_gl_search";
CREATE POLICY tenant_isolation_insert ON "saved_gl_search"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "saved_gl_search";
CREATE POLICY tenant_isolation_update ON "saved_gl_search"
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "saved_gl_search";
CREATE POLICY tenant_isolation_delete ON "saved_gl_search"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "saved_gl_search" TO amacc_rls_bypass;
