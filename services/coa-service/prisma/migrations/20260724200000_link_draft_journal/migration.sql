-- S216 — Post Manual JE (Direct-Post Mode)
-- Additive only (§8): no destructive DDL. Adds lookup indexes for the bidirectional
-- link between a manual JE draft and its posted journal entry. Both columns already
-- exist (manual_je_draft.posted_journal_id from S214; journal_entry.draft_id from
-- S013) and the application maintains the linkage on post.
--
-- NOTE: a DB-level FOREIGN KEY is intentionally NOT declared here. journal_entry.id
-- is TEXT while manual_je_draft.id / posted_journal_id are UUID, so a cross-column FK
-- is impossible without a column-type change (a destructive migration, out of scope
-- for R0 and deferred to a dedicated id-type-harmonization story). Stored values are
-- valid UUID strings, so the link resolves correctly from either side; these indexes
-- keep the S217 "view" and provenance lookups fast.

CREATE INDEX IF NOT EXISTS idx_manual_je_draft_posted_journal
  ON manual_je_draft(posted_journal_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_draft
  ON journal_entry(draft_id);

SELECT '---APPLIED---' AS status;
