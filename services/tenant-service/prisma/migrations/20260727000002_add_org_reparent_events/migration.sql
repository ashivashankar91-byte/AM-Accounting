-- S202 Dealer Group Hierarchy View & Maintenance.
-- Additive-only: no existing table/column is altered or dropped. See
-- schema.prisma's OrgReparentEvent doc comment for the design rationale
-- (effective-dated override table, not a mutation of the base FK).
CREATE TABLE "org_reparent_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "old_parent_id" TEXT NOT NULL,
    "new_parent_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_reparent_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_reparent_events_tenant_id_idx" ON "org_reparent_events"("tenant_id");
CREATE INDEX "org_reparent_events_tenant_id_node_type_node_id_idx" ON "org_reparent_events"("tenant_id", "node_type", "node_id");

-- Tenant isolation: this is a genuine tenant-owned domain table (a
-- re-parent history), not a delivery-tracking outbox — it gets the same
-- FORCE RLS treatment as legal_entities/stores/departments/franchises
-- (see 20260726000003_add_rls_policies_tenant_svc), not the outbox
-- exclusion applied in 20260727000001_exclude_outbox_tables_from_rls_tenant_svc.
ALTER TABLE "org_reparent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_reparent_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "org_reparent_events"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_insert ON "org_reparent_events"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_update ON "org_reparent_events"
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_delete ON "org_reparent_events"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "org_reparent_events" TO amacc_rls_bypass;
  END IF;
END $$;
