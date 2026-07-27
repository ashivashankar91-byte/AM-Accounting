-- Compatibility shim for the historical seed_intercompany.sql payload.
-- The seed expects dealer group tables to exist even though this repository's
-- current tenant-service migrations do not create them. Create only the exact
-- primitives the seed needs so the original seed SQL can stay byte-for-byte
-- unchanged while fresh-database deploys remain reproducible.

CREATE TABLE IF NOT EXISTS "dealer_groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "dealer_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dealer_group_tenants" (
  "id" TEXT NOT NULL,
  "dealer_group_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "rooftop_name" TEXT NOT NULL,
  CONSTRAINT "dealer_group_tenants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dealer_group_tenants_dealer_group_id_idx" ON "dealer_group_tenants"("dealer_group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_group_tenants_dealer_group_id_tenant_id_key" ON "dealer_group_tenants"("dealer_group_id", "tenant_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_group_tenants_dealer_group_id_fkey'
  ) THEN
    ALTER TABLE "dealer_group_tenants"
      ADD CONSTRAINT "dealer_group_tenants_dealer_group_id_fkey"
      FOREIGN KEY ("dealer_group_id") REFERENCES "dealer_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
