-- ────────────────────────────────────────────────────────────────────────────
-- S033 — Allocation Entries
-- Allocation templates define how a source account balance is distributed
-- across target accounts (fixed amount, percentage, or statistical basis).
-- The allocation engine creates a balanced journal entry from the template.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS allocation_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  source_account_id TEXT NOT NULL,  -- the account being allocated FROM
  allocation_basis TEXT NOT NULL DEFAULT 'PERCENTAGE', -- PERCENTAGE | FIXED_AMOUNT | STATISTICAL
  journal_source  TEXT NOT NULL DEFAULT 'ALLOCATION',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS allocation_template_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES allocation_templates(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  allocation_pct  NUMERIC(10,6),   -- for PERCENTAGE basis (must sum to 100)
  fixed_amount    NUMERIC(15,2),   -- for FIXED_AMOUNT basis
  department_code TEXT,
  description     TEXT,
  line_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_alloc_template_tenant ON allocation_templates(tenant_id);
CREATE INDEX idx_alloc_line_template ON allocation_template_lines(template_id);
CREATE INDEX idx_alloc_line_tenant ON allocation_template_lines(tenant_id);

ALTER TABLE allocation_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY alloc_template_rls ON allocation_templates
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE allocation_template_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY alloc_line_rls ON allocation_template_lines
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- S034 — Intercompany Pairing & Net-Zero
-- Defines which legal entities form intercompany pairs. When a JE is tagged
-- with an IC pair, the posting engine enforces that a matching contra entry
-- exists in the paired entity before period close (net-zero invariant).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intercompany_pairs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  entity_a_id     TEXT NOT NULL,  -- legal entity A
  entity_b_id     TEXT NOT NULL,  -- legal entity B (A↔B are symmetric)
  ic_receivable_account TEXT,     -- IC receivable GL account for entity A
  ic_payable_account    TEXT,     -- IC payable GL account for entity A
  enforcement     TEXT NOT NULL DEFAULT 'WARN', -- WARN | BLOCK | NONE
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_a_id, entity_b_id)
);

-- Named intercompany_pair_entries (not intercompany_entries) to avoid colliding
-- with the pre-existing counterparty-tenant-shaped IntercompanyEntry table
-- created in 20260506000000_init_gl_service.
CREATE TABLE IF NOT EXISTS intercompany_pair_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  pair_id         UUID NOT NULL REFERENCES intercompany_pairs(id),
  journal_entry_id TEXT NOT NULL,
  originating_entity_id TEXT NOT NULL,
  contra_journal_entry_id TEXT,   -- set when matched with contra
  ic_amount       NUMERIC(15,2) NOT NULL,
  period_year     INTEGER NOT NULL,
  period_month    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'UNMATCHED', -- UNMATCHED | MATCHED | ELIMINATED
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ic_pairs_tenant ON intercompany_pairs(tenant_id);
CREATE INDEX idx_ic_pair_entries_tenant ON intercompany_pair_entries(tenant_id);
CREATE INDEX idx_ic_pair_entries_journal ON intercompany_pair_entries(journal_entry_id);
CREATE INDEX idx_ic_pair_entries_period ON intercompany_pair_entries(tenant_id, period_year, period_month);

ALTER TABLE intercompany_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ic_pairs_rls ON intercompany_pairs
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE intercompany_pair_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ic_pair_entries_rls ON intercompany_pair_entries
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- S035 — Consolidation Eliminations
-- Elimination runs process intercompany pairs within a consolidation period,
-- generating elimination journal entries in the designated elimination entity
-- (established by S003 elimination entity attributes).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consolidation_elimination_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  elimination_entity_id TEXT NOT NULL,  -- the S003 elimination entity
  period_year     INTEGER NOT NULL,
  period_month    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | RUNNING | COMPLETED | FAILED
  started_by      TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  journal_entry_ids TEXT[] DEFAULT '{}',  -- elimination JEs generated
  ic_pairs_processed INTEGER DEFAULT 0,
  total_eliminated_debit NUMERIC(15,2) DEFAULT 0,
  total_eliminated_credit NUMERIC(15,2) DEFAULT 0,
  error_message   TEXT,
  UNIQUE(tenant_id, elimination_entity_id, period_year, period_month)
);

CREATE INDEX idx_elim_run_tenant ON consolidation_elimination_runs(tenant_id);
CREATE INDEX idx_elim_run_period ON consolidation_elimination_runs(tenant_id, period_year, period_month);

ALTER TABLE consolidation_elimination_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY elim_run_rls ON consolidation_elimination_runs
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Mark VOIDED status as valid in journal_entries (no enum constraint — status is TEXT)
-- No schema change needed; status='VOIDED' is accepted by existing TEXT column.
-- This comment documents the S219 status addition.
