-- ACC-S003 Elimination Entity Configuration.
-- Additive-only: no existing column/table is altered or dropped. Mirrors the
-- deactivated_at/by/reason pattern already used on legal_entities.
ALTER TABLE "legal_entities"
  ADD COLUMN "is_elimination" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "elimination_changed_at" TIMESTAMP(3),
  ADD COLUMN "elimination_changed_by" TEXT,
  ADD COLUMN "elimination_change_reason" TEXT;
