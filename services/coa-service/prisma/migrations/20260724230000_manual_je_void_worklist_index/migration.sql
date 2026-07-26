-- S219: Void/Delete Draft JE
-- Additive performance index for active draft worklists.
-- Story behavior excludes VOIDED drafts from list views; this partial index keeps
-- the common non-voided scan cheap without touching historical rows.

CREATE INDEX IF NOT EXISTS idx_manual_je_draft_active_worklist
  ON manual_je_draft (tenant_id, preparer, updated_at DESC)
  WHERE status <> 'VOIDED';

SELECT '---APPLIED---' AS status;
