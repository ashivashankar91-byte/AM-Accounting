-- CE-09 S051 NSF handling: cert-discovered gap fix (additive, does not edit
-- migration history). The comment in migration
-- 20260801050000_s051_nsf_handling incorrectly claimed Customer.nsf_count /
-- Customer.nsf_hold_set_at already existed "from an earlier schema pass
-- (part of the S042 commit)" — that pass never actually added them to the
-- `customers` table, even though `prisma/schema.prisma` (Customer model)
-- already declares both fields. This was confirmed missing live via
-- information_schema during CE-09 browser certification, where every
-- customer read that touched these fields failed with Prisma error P2022.
-- This migration adds the two columns the schema already expects; it does
-- not modify any previously-committed migration file.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "nsf_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "nsf_hold_set_at" TIMESTAMP(3);
