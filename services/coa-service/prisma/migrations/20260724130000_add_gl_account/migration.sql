-- S210 — Basic Chart of Accounts CRUD.
-- New entity-scoped account master owned by coa-service. Distinct from the legacy
-- gl-service `gl_accounts` (plural, tenant-scoped) which lacks the entity dimension
-- the packet requires (BR210-1). Additive only; no destructive DDL (packet §8).
-- Consolidation of legacy gl_accounts is an integration-gate task.

CREATE TABLE IF NOT EXISTS gl_account (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  account_number  VARCHAR(5) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  type            TEXT NOT NULL,
  normal_balance  TEXT NOT NULL,
  is_contra       BOOLEAN NOT NULL DEFAULT FALSE,
  contra_reason   TEXT,
  postable        BOOLEAN NOT NULL DEFAULT TRUE,
  parent_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  balance         NUMERIC(15,2) NOT NULL DEFAULT 0,
  has_postings    BOOLEAN NOT NULL DEFAULT FALSE,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_gl_account_number CHECK (account_number ~ '^[0-9]{5}$'),
  CONSTRAINT chk_gl_account_type CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  CONSTRAINT chk_gl_account_normal_balance CHECK (normal_balance IN ('DR','CR')),
  CONSTRAINT chk_gl_account_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

-- BR210-1 — account number unique per entity COA.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_account_entity_number
  ON gl_account(entity_id, account_number);

CREATE INDEX IF NOT EXISTS idx_gl_account_tenant ON gl_account(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gl_account_tenant_entity ON gl_account(tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_gl_account_entity_status ON gl_account(entity_id, status);
