-- S213 Journal Numbering Sequences — additive migration
-- journal_sequence: one atomic counter row per (tenant, source, entity, period)
-- sequence_gap_log: recorded gaps (failed/aborted posts) with reason, per BR213-3

CREATE TABLE IF NOT EXISTS journal_sequence (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  source_code  VARCHAR(6) NOT NULL,
  entity_id    TEXT NOT NULL,
  period_code  VARCHAR(7) NOT NULL,            -- YYYY-MM
  next_seq     INTEGER NOT NULL DEFAULT 1,     -- next value to assign
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_journal_sequence_period CHECK (period_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT chk_journal_sequence_next CHECK (next_seq >= 1),
  CONSTRAINT uq_journal_sequence UNIQUE (tenant_id, source_code, entity_id, period_code)
);

CREATE TABLE IF NOT EXISTS sequence_gap_log (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  source_code      VARCHAR(6) NOT NULL,
  entity_id        TEXT NOT NULL,
  period_code      VARCHAR(7) NOT NULL,        -- YYYY-MM
  expected_number  VARCHAR(40) NOT NULL,       -- {SOURCE}-{YYYY-MM}-{seq:06d}
  expected_seq     INTEGER NOT NULL,
  reason           TEXT NOT NULL,
  actor            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequence_gap_log_period
  ON sequence_gap_log (tenant_id, entity_id, period_code, created_at);

SELECT '---APPLIED---' AS status;
