-- ============================================================
-- Sprint 1 — Data Integrity & Blocking Correctness
-- S1-03: is_reconciled on journal_entries
-- S1-06: journal_templates + journal_template_lines
-- S1-10: stock_number on floor_plan_units
-- ============================================================

-- S1-03: Receipt void guard — prevents reversing bank-reconciled entries
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN journal_entries.is_reconciled IS
  'S1-03: When true, this entry has been included in a completed bank reconciliation and cannot be reversed.';

-- S1-06: Journal Templates — template_number is max 8 uppercase alphanumeric chars
CREATE TABLE IF NOT EXISTS journal_templates (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL,
  template_number     VARCHAR(8)  NOT NULL,
  source_code         TEXT        NOT NULL,
  company_number      VARCHAR(2)  NOT NULL DEFAULT '01',
  description         TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_by_user_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT journal_templates_tenant_number_uq UNIQUE (tenant_id, template_number),
  -- Enforce 1–8 uppercase alphanumeric characters
  CONSTRAINT journal_templates_number_format CHECK (template_number ~ '^[A-Z0-9]{1,8}$')
);

CREATE INDEX IF NOT EXISTS idx_journal_templates_tenant
  ON journal_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_templates_tenant_active
  ON journal_templates (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS journal_template_lines (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID        NOT NULL REFERENCES journal_templates(id) ON DELETE CASCADE,
  line_order      INTEGER     NOT NULL,
  gl_account_id   UUID,
  account_code    TEXT,
  is_credit       BOOLEAN     NOT NULL DEFAULT false,
  amount          NUMERIC(15, 2),
  memo            TEXT,
  department_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_template_lines_template
  ON journal_template_lines (template_id);

-- S1-10: stockNumber on floor_plan_units — dealer lot stock# alongside VIN
ALTER TABLE floor_plan_units
  ADD COLUMN IF NOT EXISTS stock_number VARCHAR(20);

COMMENT ON COLUMN floor_plan_units.stock_number IS
  'S1-10: Dealer lot stock number for this floor-planned unit (complements VIN for lot tracking).';
