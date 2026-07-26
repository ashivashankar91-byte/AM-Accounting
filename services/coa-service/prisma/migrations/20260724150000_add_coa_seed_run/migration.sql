-- S010 Seed Canonical COA Skeleton
-- Records seed executions per entity for idempotency reporting + audit.
-- Accounts themselves are seeded into the existing gl_account table (bulk data,
-- no DDL). Additive only.

CREATE TABLE IF NOT EXISTS coa_seed_run (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  created_count    INT  NOT NULL DEFAULT 0,
  merged_count     INT  NOT NULL DEFAULT 0,
  conflict_count   INT  NOT NULL DEFAULT 0,
  actor            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coa_seed_run_entity
  ON coa_seed_run(tenant_id, entity_id, created_at);

SELECT '---APPLIED---' AS status;
