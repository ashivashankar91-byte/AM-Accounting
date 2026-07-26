-- S207: Permission Catalog & Check API
-- Additive-only. No destructive DDL. Catalog ships with this release (BR207-1).

-- ── Permission catalog ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "permission" (
  "key"           TEXT PRIMARY KEY,
  "description"   TEXT NOT NULL,
  "since_version" TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'SHIPPED',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "permission_status_idx" ON "permission" ("status");

-- ── Role -> permission grants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permission" (
  "role"           TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role", "permission_key"),
  CONSTRAINT "role_permission_permission_key_fkey"
    FOREIGN KEY ("permission_key") REFERENCES "permission" ("key") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "role_permission_permission_key_idx" ON "role_permission" ("permission_key");

-- ── Role-assignment read-model (projection; S206 owns management) ──────────────
CREATE TABLE IF NOT EXISTS "authz_role_assignment" (
  "id"         TEXT PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "role"       TEXT NOT NULL,
  "entity_id"  TEXT,
  "store_id"   TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- NULLs in COALESCE keep the uniqueness usable across nullable scope columns.
CREATE UNIQUE INDEX IF NOT EXISTS "authz_role_assignment_unique"
  ON "authz_role_assignment" ("tenant_id", "user_id", "role",
                              COALESCE("entity_id", ''), COALESCE("store_id", ''));
CREATE INDEX IF NOT EXISTS "authz_role_assignment_user_idx"
  ON "authz_role_assignment" ("tenant_id", "user_id");

-- ── Catalog version metadata (enables diff report) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "catalog_version" (
  "version"     TEXT PRIMARY KEY,
  "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT
);

-- ── Event outbox for iam.authz.denied ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "authz_outbox_events" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "event_type"   TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "published_at" TIMESTAMP(3),
  "retry_count"  INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "authz_outbox_events_publish_idx"
  ON "authz_outbox_events" ("published_at", "retry_count");

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — catalog version 1.0.0 (R0-ORG-FOUNDATION baseline)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.0.0', 'R0-ORG-FOUNDATION baseline permission catalog (S200-S207).')
ON CONFLICT ("version") DO NOTHING;

-- Permission keys shipped in 1.0.0. Deny-by-default: unknown key -> 400.
INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('acct.entity.view',    'View legal entities',                 '1.0.0'),
  ('acct.entity.manage',  'Create / edit legal entities',        '1.0.0'),
  ('acct.store.view',     'View stores (rooftops)',              '1.0.0'),
  ('acct.store.manage',   'Create / edit stores',                '1.0.0'),
  ('acct.dept.view',      'View departments',                    '1.0.0'),
  ('acct.dept.manage',    'Create / edit departments',           '1.0.0'),
  ('acct.franchise.view', 'View franchises',                     '1.0.0'),
  ('acct.franchise.manage','Create / edit franchises',           '1.0.0'),
  ('iam.catalog.view',    'Read the permission catalog',         '1.0.0'),
  ('je.post',             'Post a journal entry',                '1.0.0')
ON CONFLICT ("key") DO NOTHING;

-- Role -> permission grants, seeded from the R0 role model
-- (ADMIN / CONTROLLER: full manage; ACCOUNTANT: view-only; SERVICE: manage).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('SERVICE')) AS r(role)
CROSS JOIN (VALUES
  ('acct.entity.view'), ('acct.entity.manage'),
  ('acct.store.view'), ('acct.store.manage'),
  ('acct.dept.view'), ('acct.dept.manage'),
  ('acct.franchise.view'), ('acct.franchise.manage'),
  ('iam.catalog.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view-only across org-foundation + catalog read.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ACCOUNTANT', 'acct.entity.view'),
  ('ACCOUNTANT', 'acct.store.view'),
  ('ACCOUNTANT', 'acct.dept.view'),
  ('ACCOUNTANT', 'acct.franchise.view'),
  ('ACCOUNTANT', 'iam.catalog.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN / CONTROLLER may post journal entries; SERVICE and ACCOUNTANT may not.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'je.post'),
  ('CONTROLLER', 'je.post')
ON CONFLICT ("role", "permission_key") DO NOTHING;
