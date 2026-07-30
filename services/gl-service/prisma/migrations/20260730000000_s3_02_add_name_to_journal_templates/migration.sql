-- S3-02: add the human-readable `name` column to journal_templates.
-- This column was added to schema.prisma but the migration was never
-- committed, causing P2022 "column does not exist" errors on
-- GET /admin/journal-templates.
ALTER TABLE "journal_templates"
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(100) NOT NULL DEFAULT '';
