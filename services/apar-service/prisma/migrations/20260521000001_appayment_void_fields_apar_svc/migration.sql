-- S3-08: ap_payments voided-check metadata (voidedAt/voidReason on the
-- APPayment Prisma model). Like the tables in
-- 20260518000000_apar_baseline_foundation, these columns already exist in
-- schema.prisma and are read/written by routes.ts but were never captured
-- as a migration. Captured here, immediately after sprint2's CREATE TABLE
-- ap_payments, so `prisma migrate deploy` on a fresh database matches
-- schema.prisma exactly.

ALTER TABLE ap_payments
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
