-- S211 Account Hierarchy & Totaling Groups
-- Additive only. gl_account.parent_id already exists (added by S210 20260724130000).
-- Adds effective-dated re-parenting: a marker column on the account plus an
-- append-only history table for the effective-dated trail (BR211-3).

ALTER TABLE gl_account
  ADD COLUMN IF NOT EXISTS parent_effective_from TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS gl_account_reparent (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  old_parent_id   TEXT,
  new_parent_id   TEXT,
  effective_from  TIMESTAMPTZ NOT NULL,
  actor           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gl_account_reparent_account
  ON gl_account_reparent(account_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_gl_account_reparent_tenant_entity
  ON gl_account_reparent(tenant_id, entity_id);
-- Supports tree traversal / parent lookup within an entity.
CREATE INDEX IF NOT EXISTS idx_gl_account_entity_parent
  ON gl_account(entity_id, parent_id);

SELECT '---APPLIED---' AS status;
