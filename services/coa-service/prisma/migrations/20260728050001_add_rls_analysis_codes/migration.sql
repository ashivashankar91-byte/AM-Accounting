-- S011 — extend the coa-service RLS baseline (see
-- 20260726000002_add_rls_policies) to cover the three new analysis-code
-- tables. Same 4-policy tenant-isolation pattern, FORCE ROW LEVEL SECURITY
-- (matches the 20260728000003_add_rls_saved_gl_search precedent).

ALTER TABLE "analysis_code_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_code_type" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "analysis_code_type";
CREATE POLICY tenant_isolation_select ON "analysis_code_type"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_insert ON "analysis_code_type";
CREATE POLICY tenant_isolation_insert ON "analysis_code_type"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "analysis_code_type";
CREATE POLICY tenant_isolation_update ON "analysis_code_type"
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "analysis_code_type";
CREATE POLICY tenant_isolation_delete ON "analysis_code_type"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "analysis_code_type" TO amacc_rls_bypass;

-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "analysis_code_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_code_value" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "analysis_code_value";
CREATE POLICY tenant_isolation_select ON "analysis_code_value"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_insert ON "analysis_code_value";
CREATE POLICY tenant_isolation_insert ON "analysis_code_value"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "analysis_code_value";
CREATE POLICY tenant_isolation_update ON "analysis_code_value"
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "analysis_code_value";
CREATE POLICY tenant_isolation_delete ON "analysis_code_value"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "analysis_code_value" TO amacc_rls_bypass;

-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "journal_line_analysis_tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_line_analysis_tag" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "journal_line_analysis_tag";
CREATE POLICY tenant_isolation_select ON "journal_line_analysis_tag"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_insert ON "journal_line_analysis_tag";
CREATE POLICY tenant_isolation_insert ON "journal_line_analysis_tag"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "journal_line_analysis_tag";
CREATE POLICY tenant_isolation_update ON "journal_line_analysis_tag"
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "journal_line_analysis_tag";
CREATE POLICY tenant_isolation_delete ON "journal_line_analysis_tag"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "journal_line_analysis_tag" TO amacc_rls_bypass;
