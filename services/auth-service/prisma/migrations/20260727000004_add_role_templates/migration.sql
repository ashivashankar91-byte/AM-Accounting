-- S004A: Dealership Position Role Templates.
-- Additive-only. Applying a template never creates a parallel permission map:
-- it materializes/reuses a real, tenant-scoped S206 "role" keyed by the
-- template's position and grants it via the real S206/S207 "role_assignment"
-- projection (role_permission / authz_role_assignment), so the exact same
-- AuthzService.check() enforcement already proven for S206 governs it.

-- ── role_template (shipped defaults + tenant clones) ───────────────────────────
-- tenant_id IS NULL rows are the global shipped defaults (BR4A-1) -- visible to
-- every tenant, never mutable by any tenant (see RLS policies below). A tenant
-- "customizes" a shipped template by cloning it into its own tenant_id-owned
-- row (copy-by-value), so editing the shipped source afterward never
-- retroactively mutates an already-created clone.
CREATE TABLE IF NOT EXISTS "role_template" (
  "id"              TEXT PRIMARY KEY,
  "tenant_id"       TEXT,                                 -- NULL = global shipped default
  "key"             TEXT NOT NULL,                        -- position slug, e.g. BILLER
  "name"            TEXT NOT NULL,
  "permissions"     TEXT[] NOT NULL DEFAULT '{}',
  "field_masks"     TEXT[] NOT NULL DEFAULT '{}',          -- e.g. {vehicle.cost} (BR4A-2)
  "built_in"        BOOLEAN NOT NULL DEFAULT false,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE | INACTIVE
  "cloned_from_id"  TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Exactly one global shipped row per position.
CREATE UNIQUE INDEX IF NOT EXISTS "role_template_key_global"
  ON "role_template" ("key") WHERE "tenant_id" IS NULL;
-- A tenant's own clones/customizations must have distinct names.
CREATE UNIQUE INDEX IF NOT EXISTS "role_template_name_per_tenant"
  ON "role_template" ("tenant_id", "name") WHERE "tenant_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "role_template_tenant_idx" ON "role_template" ("tenant_id");
CREATE INDEX IF NOT EXISTS "role_template_key_idx" ON "role_template" ("key");

-- ── role_template_assignment (template application record) ────────────────────
-- Backed 1:1 by a real role_assignment row (role_assignment_id) -- this table
-- exists only so a template application (and its later deactivation) can be
-- looked up and reversed by template identity, never as an independent
-- enforcement path.
CREATE TABLE IF NOT EXISTS "role_template_assignment" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "template_id"         TEXT NOT NULL,
  "user_id"             TEXT NOT NULL,
  "role_assignment_id"  TEXT NOT NULL,
  "entity_id"           TEXT,
  "store_ids"           TEXT[] NOT NULL DEFAULT '{}',
  "all_stores"          BOOLEAN NOT NULL DEFAULT false,
  "status"              TEXT NOT NULL DEFAULT 'APPLIED',  -- APPLIED | REVOKED
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"          TIMESTAMP(3),
  CONSTRAINT "role_template_assignment_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "role_template" ("id")
);
CREATE INDEX IF NOT EXISTS "role_template_assignment_user_idx"
  ON "role_template_assignment" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "role_template_assignment_template_idx"
  ON "role_template_assignment" ("template_id");

-- ── Row Level Security ──────────────────────────────────────────────────────────
-- role_template_assignment follows the standard tenant-isolation pattern used
-- across the codebase (see 20260726000003_add_rls_policies). role_template is a
-- deliberate variant: SELECT also allows tenant_id IS NULL (the global shipped
-- catalog, readable by every tenant), while INSERT/UPDATE/DELETE always require
-- tenant_id = the caller's own tenant -- the global rows (tenant_id IS NULL) can
-- never equal any real tenant_id, so they can never be mutated by the
-- amacc_app runtime role. Only the migration/superuser role can seed them.
ALTER TABLE "role_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_template" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "role_template";
CREATE POLICY tenant_isolation_select ON "role_template"
  FOR SELECT USING (
    "tenant_id" = current_setting('app.current_tenant_id', true) OR "tenant_id" IS NULL
  );

DROP POLICY IF EXISTS tenant_isolation_insert ON "role_template";
CREATE POLICY tenant_isolation_insert ON "role_template"
  FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "role_template";
CREATE POLICY tenant_isolation_update ON "role_template"
  FOR UPDATE USING ("tenant_id" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "role_template";
CREATE POLICY tenant_isolation_delete ON "role_template"
  FOR DELETE USING ("tenant_id" = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "role_template" TO amacc_rls_bypass;

ALTER TABLE "role_template_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_template_assignment" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON "role_template_assignment";
CREATE POLICY tenant_isolation_select ON "role_template_assignment"
  FOR SELECT USING ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_insert ON "role_template_assignment";
CREATE POLICY tenant_isolation_insert ON "role_template_assignment"
  FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_update ON "role_template_assignment";
CREATE POLICY tenant_isolation_update ON "role_template_assignment"
  FOR UPDATE USING ("tenant_id" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_delete ON "role_template_assignment";
CREATE POLICY tenant_isolation_delete ON "role_template_assignment"
  FOR DELETE USING ("tenant_id" = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "role_template_assignment" TO amacc_rls_bypass;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED -- catalog version 1.2.0 adds the S004A role-template permissions.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.2.0', 'S004A Dealership Position Role Templates — adds iam.roletemplate.manage/apply.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('iam.roletemplate.manage', 'Create / edit / clone / deactivate role templates', '1.2.0'),
  ('iam.roletemplate.apply',  'View shipped templates and apply one to a user',    '1.2.0')
ON CONFLICT ("key") DO NOTHING;

-- Security administrator (ADMIN) manages the template library. CONTROLLER can
-- apply shipped/cloned templates during onboarding but not redefine them,
-- matching the iam.role.manage / iam.role.assign split already used for S206.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN',      'iam.roletemplate.manage'),
  ('ADMIN',      'iam.roletemplate.apply'),
  ('CONTROLLER', 'iam.roletemplate.apply')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED -- shipped position templates (BR4A-1), global (tenant_id IS NULL).
-- Permission sets are drawn only from permission keys that exist in the real
-- catalog today. AP/AR/payroll modules have not been onboarded into this
-- repository yet, so AP_CLERK/AR_CLERK/BILLER/CASHIER/TITLE_CLERK templates
-- necessarily reuse the closest real journal/COA permissions rather than
-- module-specific ones -- this is a documented, honest gap (see the S004A
-- certification report), not a fabricated full BP 1.4 mapping.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "role_template" ("id", "tenant_id", "key", "name", "permissions", "field_masks", "built_in", "status") VALUES
  ('rt-global-biller', NULL, 'BILLER', 'Biller', ARRAY[
    'je.view','je.draft.create','je.draft.edit','coa.account.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-cashier', NULL, 'CASHIER', 'Cashier', ARRAY[
    'je.view','je.draft.create'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-title-clerk', NULL, 'TITLE_CLERK', 'Title Clerk', ARRAY[
    'je.view','je.draft.create','coa.account.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-ap-clerk', NULL, 'AP_CLERK', 'AP Clerk', ARRAY[
    'je.view','je.draft.create','je.draft.edit','coa.account.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-ar-clerk', NULL, 'AR_CLERK', 'AR Clerk', ARRAY[
    'je.view','je.draft.create','je.draft.edit','coa.account.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-accountant', NULL, 'ACCOUNTANT', 'Accountant', ARRAY[
    'je.view','je.draft.create','je.draft.edit','je.draft.view_all',
    'coa.account.view','fiscal.period.view','org.tree.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-office-mgr', NULL, 'OFFICE_MGR', 'Office Manager', ARRAY[
    'org.tree.view','iam.user.view','coa.account.view','je.view',
    'config.view','fiscal.calendar.view','fiscal.period.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-controller', NULL, 'CONTROLLER', 'Controller', ARRAY[
    'je.post','je.reverse','je.draft.void','je.draft.void.any','je.view',
    'je.draft.view_all','je.gap_report.view','je.sequence.allocate',
    'coa.account.manage','fiscal.period.open','org.tree.manage','iam.role.view'
  ], '{}', true, 'ACTIVE'),
  ('rt-global-salesperson-ro', NULL, 'SALESPERSON_RO', 'Salesperson (Read-Only)', ARRAY[
    'je.view'
  ], ARRAY['vehicle.cost'], true, 'ACTIVE')
ON CONFLICT DO NOTHING;
