-- Schema drift defect fix: prisma/schema.prisma and intercompany posting code
-- both expect journal_entries.ic_counterpart_entry_id, but no committed
-- migration added the backing column.

ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "ic_counterpart_entry_id" TEXT;
