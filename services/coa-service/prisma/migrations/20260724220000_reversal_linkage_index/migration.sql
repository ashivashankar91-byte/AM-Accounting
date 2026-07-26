-- S218: Reverse Posted JE — reversal linkage lookup support.
-- Additive only. The reversal_of / reversed_by columns already exist on
-- journal_entry (S216/S218 schema). reversal_of is already indexed; add the
-- reversed_by index so the "already reversed?" guard and the both-direction
-- view linkage resolve efficiently. No DDL on existing columns.

CREATE INDEX IF NOT EXISTS idx_journal_entry_reversed_by
  ON journal_entry (reversed_by);

SELECT '---APPLIED---' AS status;
