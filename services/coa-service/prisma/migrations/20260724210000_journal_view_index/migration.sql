-- S217: View Journal Entry — read-only lookup support.
-- Additive only. Adds an index on (tenant_id, journal_number) to serve the
-- exact-number fetch (findFirst by tenant + number) and the 404 "search
-- suggestion" prefix scan (journal_number LIKE 'GJ-2026-01-%'). No DDL on
-- existing columns; no destructive change.

CREATE INDEX IF NOT EXISTS idx_journal_entry_tenant_number
  ON journal_entry (tenant_id, journal_number);

SELECT '---APPLIED---' AS status;
