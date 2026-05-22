-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Sprint 2 — S2-05 Missing JournalLine fields
-- ─────────────────────────────────────────────────────────────────────────────

-- company_code: 2-char company code (COBOL GLBYID CO field)
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(2);

-- control_number: 20-char cross-reference to source document
-- (tighten from unbounded if column already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_lines' AND column_name = 'control_number'
  ) THEN
    ALTER TABLE journal_lines ADD COLUMN control_number VARCHAR(20);
  ELSE
    ALTER TABLE journal_lines ALTER COLUMN control_number TYPE VARCHAR(20);
  END IF;
END $$;

-- apply_to_cost: NUMERIC(15,2) — dollar value applied to cost account
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS apply_to_cost NUMERIC(15,2);

-- unit_count: integer quantity (vehicles, units, hours)
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS unit_count INT NOT NULL DEFAULT 0;
