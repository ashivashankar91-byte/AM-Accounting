-- S205: User Account Lifecycle
-- Additive-only. No destructive DDL. Users hold NO permissions directly (BR205-4);
-- authorization is via S206 role assignments. Email is unique per tenant (BR205-1).

-- ── User (staff login) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user" (
  "id"                      TEXT PRIMARY KEY,
  "tenant_id"               TEXT NOT NULL,
  "email"                   TEXT NOT NULL,
  "display_name"            TEXT NOT NULL,
  "status"                  TEXT NOT NULL DEFAULT 'INVITED',   -- INVITED|ACTIVE|LOCKED|INACTIVE
  "failed_logins"           INTEGER NOT NULL DEFAULT 0,
  "entity_scope"            TEXT[] NOT NULL DEFAULT '{}',
  "store_scope"             TEXT[] NOT NULL DEFAULT '{}',
  "version"                 INTEGER NOT NULL DEFAULT 0,
  "reset_token_hash"        TEXT,
  "reset_token_expires_at"  TIMESTAMP(3),
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivated_at"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_per_tenant" ON "user" ("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "user_tenant_idx" ON "user" ("tenant_id");

-- ── Session (issued login session) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
  "id"         TEXT PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',              -- ACTIVE|REVOKED
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id")
);
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "session_status_idx" ON "session" ("status");

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — catalog version 1.2.0 adds the IAM user-management permissions.
-- Demonstrates the S207 catalog diff (1.1.0 -> 1.2.0): 2 keys added.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.2.0', 'S205 User Account Lifecycle — adds iam.user.view/manage.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('iam.user.view',   'View user accounts',                       '1.2.0'),
  ('iam.user.manage', 'Create / deactivate / unlock / reset users','1.2.0')
ON CONFLICT ("key") DO NOTHING;

-- Extend the S207 role_permission projection so the real AuthzPort enforces the
-- user-lifecycle routes deny-by-default. ADMIN manages users; CONTROLLER can view.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN',      'iam.user.view'),
  ('ADMIN',      'iam.user.manage'),
  ('CONTROLLER', 'iam.user.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Keep role.permissions (source of truth) in sync with the projection above.
UPDATE "role" SET "permissions" = "permissions" || ARRAY['iam.user.view','iam.user.manage']
  WHERE "tenant_id" = 'tenant-kunes' AND "key" = 'ADMIN'
    AND NOT ('iam.user.manage' = ANY("permissions"));
UPDATE "role" SET "permissions" = "permissions" || ARRAY['iam.user.view']
  WHERE "tenant_id" = 'tenant-kunes' AND "key" = 'CONTROLLER'
    AND NOT ('iam.user.view' = ANY("permissions"));

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — bootstrap user rows for the dev tenant so the lifecycle (and the
-- last-admin-self-deactivation guard) operate on real users. These IDs match the
-- existing authz_role_assignment holders (dev-user = ADMIN, acct-user = ACCOUNTANT).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "user" ("id", "tenant_id", "email", "display_name", "status", "entity_scope") VALUES
  ('dev-user',  'tenant-kunes', 'dev@kunes.example',  'Dev Admin',   'ACTIVE', '{}'),
  ('acct-user', 'tenant-kunes', 'acct@kunes.example', 'Acct Clerk',  'ACTIVE', '{}')
ON CONFLICT ("id") DO NOTHING;
