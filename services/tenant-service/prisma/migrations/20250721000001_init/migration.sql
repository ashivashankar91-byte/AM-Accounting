-- FINAL-R0 Foundation Completion: baseline init migration for tenant-service.
-- The `tenants` table (backing the Prisma `Tenant` model) was never created by
-- any tracked migration — every prior dev/test environment had it materialized
-- via an untracked `prisma db push` before the first real migration
-- (`20250722000001_add_legal_entity`) was ever written, so `prisma migrate deploy`
-- on a genuinely clean database fails with:
--   "The table `public.tenants` does not exist in the current database."
-- Discovered by actually deploying tenant-service's migrations onto a clean
-- Postgres instance as part of live-stack bootstrap for this package.
-- Matches services/tenant-service/prisma/schema.prisma's Tenant model exactly.
CREATE TABLE IF NOT EXISTS "tenants" (
    "id"            TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "dms_type"      TEXT        NOT NULL,
    "dms_api_key"   TEXT        NOT NULL,
    "schema_name"   TEXT        NOT NULL,
    "status"        TEXT        NOT NULL DEFAULT 'PROVISIONING',
    "rooftop_count" INTEGER     NOT NULL DEFAULT 1,
    "webhook_url"   TEXT,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_schema_name_key" ON "tenants"("schema_name");
