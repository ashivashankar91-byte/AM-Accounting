-- S009 v1 — Statement Metadata and COA Governance (gl-service ownership).
-- Purely additive: no existing column type/semantics change, no destructive
-- operation. Per PRODUCT/ARCHITECTURE DECISION (2026-07-28): gl-service is
-- the implementation owner for statement metadata/reporting classification;
-- coa-service is explicitly out of scope (it has neither COST_OF_SALES/
-- DISTRIBUTION account types nor the BS/IS endpoints — see ADR-JL-001 and
-- docs/accounting-modernization/S009_DECISION_MEMO.md).

-- btree_gist is required for the non-overlap exclusion constraint below
-- (BLK-09, Product decision: fully effective-dated, non-overlapping ranges).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- BR009-1: tenant-scoped Balance Sheet / Income Statement presentation line
-- registry. Ships empty in v1 — Accounting SME seed-content sign-off is
-- still pending (BLK-07, does not block this additive schema change).
CREATE TABLE IF NOT EXISTS statement_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  statement TEXT NOT NULL CHECK (statement IN ('BS', 'IS')),
  section TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_statement_lines_tenant ON statement_lines(tenant_id);

-- Current effective mapping pointer on the account itself (fast-path read;
-- the authoritative, effective-dated source of truth is the history table
-- below — this column is kept in sync by the application layer whenever the
-- currently-effective row changes, never written to independently).
ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS statement_line_id TEXT REFERENCES statement_lines(id);

CREATE INDEX IF NOT EXISTS idx_gl_accounts_statement_line ON gl_accounts(tenant_id, statement_line_id);

-- BR009-3 / BLK-09 (Product decision 2026-07-28, Option 2): append-only,
-- effective-dated mapping history. Never updated/deleted in place.
CREATE TABLE IF NOT EXISTS gl_account_statement_line_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  statement_line_id TEXT REFERENCES statement_lines(id), -- null = explicit unmap to type default
  effective_from DATE NOT NULL,
  effective_to DATE, -- null = open-ended (current)
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  is_bootstrap BOOLEAN NOT NULL DEFAULT false, -- governed migration/backdate only, per BLK-09
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_gaslh_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_gaslh_account_from ON gl_account_statement_line_history(tenant_id, gl_account_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_gaslh_account_to ON gl_account_statement_line_history(tenant_id, gl_account_id, effective_to);

-- Non-overlap guarantee at the database level (belt-and-suspenders alongside
-- the application-layer check): no two history rows for the same account may
-- have overlapping [effective_from, effective_to) ranges. Uses daterange with
-- '[)' bounds; an open-ended row (effective_to IS NULL) is treated as
-- extending to 'infinity' for overlap purposes.
ALTER TABLE gl_account_statement_line_history
  ADD CONSTRAINT excl_gaslh_no_overlap EXCLUDE USING gist (
    gl_account_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  );
