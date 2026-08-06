-- CE-09 integration: add posting context columns to journal_entries
-- Allows gl-service to store and re-emit the full JOURNAL_ENTRY_POSTED
-- payload required by CE-09 AP/AR/Cash/Bank consumers (legalEntityId,
-- postingExecutionId, rulePackKey, rulePackVersion, sourceEventId).
-- All columns are nullable — existing journal entries (manual JE, reversal,
-- finance-charge-job legacy path) are unaffected.

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS legal_entity_id VARCHAR(36);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS posting_execution_id VARCHAR(36);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS rule_pack_key VARCHAR(100);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS rule_pack_version VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS journal_entries_legal_entity_id_idx ON journal_entries (tenant_id, legal_entity_id) WHERE legal_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_entries_posting_execution_id_idx ON journal_entries (posting_execution_id) WHERE posting_execution_id IS NOT NULL;
