-- S206: Basic Role Management
-- Additive-only. No destructive DDL. Roles = named permission sets (BR206-1);
-- access via auditable, store-scoped assignment only (BR206-3).

-- ── Role (named permission set) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role" (
  "id"          TEXT PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "permissions" TEXT[] NOT NULL DEFAULT '{}',
  "built_in"    BOOLEAN NOT NULL DEFAULT false,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_name_per_tenant" ON "role" ("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "role_key_per_tenant"  ON "role" ("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "role_tenant_idx" ON "role" ("tenant_id");

-- ── Role assignment (store-scoped grant) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_assignment" (
  "id"         TEXT PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "role_id"    TEXT NOT NULL,
  "entity_id"  TEXT,                                -- null = tenant-wide (platform/tenant admin)
  "store_ids"  TEXT[] NOT NULL DEFAULT '{}',
  "all_stores" BOOLEAN NOT NULL DEFAULT false,
  "status"     TEXT NOT NULL DEFAULT 'GRANTED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "role_assignment_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "role" ("id")
);
CREATE INDEX IF NOT EXISTS "role_assignment_user_idx" ON "role_assignment" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "role_assignment_role_idx" ON "role_assignment" ("role_id");

-- ── AuditPort stub outbox (S007 dependency) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "doc_type"     TEXT NOT NULL,
  "doc_id"       TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT NOT NULL,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_outbox_publish_idx" ON "audit_outbox" ("published_at");

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — catalog version 1.1.0 adds the IAM role-management permissions.
-- Demonstrates the S207 catalog diff (1.0.0 -> 1.1.0): 3 keys added.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.1.0', 'S206 Basic Role Management — adds iam.role.view/manage/assign.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('iam.role.view',   'View roles and assignments',        '1.1.0'),
  ('iam.role.manage', 'Create / edit / retire roles',      '1.1.0'),
  ('iam.role.assign', 'Grant / revoke role assignments',   '1.1.0')
ON CONFLICT ("key") DO NOTHING;

-- Extend the existing S207 role_permission projection with the new IAM grants so
-- the real AuthzPort (S207) enforces role-management routes deny-by-default.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN',      'iam.role.view'),
  ('ADMIN',      'iam.role.manage'),
  ('ADMIN',      'iam.role.assign'),
  ('CONTROLLER', 'iam.role.view'),
  ('CONTROLLER', 'iam.role.assign'),
  ('ACCOUNTANT', 'iam.role.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — starter roles (BR206-4) for the dev tenant (tenant-kunes). builtIn = true.
-- role.permissions is the source of truth; role_permission above is its projection.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "role" ("id", "tenant_id", "key", "name", "permissions", "built_in", "status") VALUES
  ('role-kunes-admin', 'tenant-kunes', 'ADMIN', 'Administrator', ARRAY[
    'acct.entity.view','acct.entity.manage','acct.store.view','acct.store.manage',
    'acct.dept.view','acct.dept.manage','acct.franchise.view','acct.franchise.manage',
    'iam.catalog.view','je.post','iam.role.view','iam.role.manage','iam.role.assign'
  ], true, 'ACTIVE'),
  ('role-kunes-controller', 'tenant-kunes', 'CONTROLLER', 'Controller', ARRAY[
    'acct.entity.view','acct.entity.manage','acct.store.view','acct.store.manage',
    'acct.dept.view','acct.dept.manage','acct.franchise.view','acct.franchise.manage',
    'iam.catalog.view','je.post','iam.role.view','iam.role.assign'
  ], true, 'ACTIVE'),
  ('role-kunes-accountant', 'tenant-kunes', 'ACCOUNTANT', 'Accountant', ARRAY[
    'acct.entity.view','acct.store.view','acct.dept.view','acct.franchise.view',
    'iam.catalog.view','iam.role.view'
  ], true, 'ACTIVE'),
  ('role-kunes-readonly', 'tenant-kunes', 'READONLY', 'Read-Only', ARRAY[
    'acct.entity.view','acct.store.view','acct.dept.view','acct.franchise.view',
    'iam.catalog.view'
  ], true, 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — bootstrap the dev tenant admins as TENANT-WIDE grants (entity_id NULL),
-- matching the pre-S206 S207 read-model so platform admins retain full access.
-- API-driven grants always specify an entity; these bootstrap rows do not.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "role_assignment"
  ("id", "tenant_id", "user_id", "role_id", "entity_id", "store_ids", "all_stores", "status") VALUES
  ('asgn-kunes-dev',  'tenant-kunes', 'dev-user',  'role-kunes-admin',      NULL, '{}', false, 'GRANTED'),
  ('asgn-kunes-acct', 'tenant-kunes', 'acct-user', 'role-kunes-accountant', NULL, '{}', false, 'GRANTED')
ON CONFLICT ("id") DO NOTHING;

-- Re-project into authz_role_assignment: tenant-wide (entity_id NULL, store_id NULL).
DELETE FROM "authz_role_assignment"
  WHERE "tenant_id" = 'tenant-kunes' AND "user_id" IN ('dev-user', 'acct-user');
INSERT INTO "authz_role_assignment" ("id", "tenant_id", "user_id", "role", "entity_id", "store_id") VALUES
  ('authz-kunes-dev',  'tenant-kunes', 'dev-user',  'ADMIN',      NULL, NULL),
  ('authz-kunes-acct', 'tenant-kunes', 'acct-user', 'ACCOUNTANT', NULL, NULL)
ON CONFLICT ("tenant_id", "user_id", "role", COALESCE("entity_id", ''), COALESCE("store_id", '')) DO NOTHING;
