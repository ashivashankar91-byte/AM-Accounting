-- Schema drift defect fix: prisma/schema.prisma and runtime code both model the
-- gl_accounts.is_intercompany flag (S7-05), but no committed migration ever
-- added the backing column. Fresh migrated databases therefore fail the first
-- simple prisma.gLAccount.create() with P2022 on is_intercompany.

ALTER TABLE "gl_accounts"
  ADD COLUMN IF NOT EXISTS "is_intercompany" BOOLEAN NOT NULL DEFAULT false;
