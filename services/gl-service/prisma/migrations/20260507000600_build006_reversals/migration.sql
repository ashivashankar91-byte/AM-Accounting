-- BUILD-006: Transaction Reversal API support
-- @cobol-origin revadjt.cbl, revtran.cbl — reversal and adjustment entry management

ALTER TABLE journal_entries
  ADD COLUMN rev_adj_flag CHAR(1),
  ADD COLUMN reversal_of_id TEXT,
  ADD COLUMN reversed_by_id TEXT;

CREATE INDEX idx_journal_entries_reversals
  ON journal_entries(tenant_id, reversal_of_id, reversed_by_id);
