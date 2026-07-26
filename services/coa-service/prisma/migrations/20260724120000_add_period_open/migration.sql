-- S209 Accounting Period Open & Status — additive migration.
-- Adds the open-lifecycle columns to the S208 fiscal_period table. Only
-- FUTURE->OPEN is exercised here (BR209-1); the full status vocabulary
-- (FUTURE|OPEN|SOFT_CLOSED|HARD_CLOSED|LOCKED) ships now for S013, with the
-- later close transitions owned by S008/R1. No CHECK constraint on status so
-- the enum can grow without a destructive DDL.

ALTER TABLE fiscal_period ADD COLUMN IF NOT EXISTS opened_by TEXT;
ALTER TABLE fiscal_period ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

-- Board + open-limit queries scan by entity + status.
CREATE INDEX IF NOT EXISTS idx_fiscal_period_entity_status
  ON fiscal_period(entity_id, status);
