-- ACC-S201: Create stores table
-- store_code is unique per entity (not per tenant), immutable after creation.
-- stateProvince drives future tax jurisdiction defaulting.

CREATE TABLE "stores" (
    "id"                 TEXT NOT NULL,
    "tenant_id"          TEXT NOT NULL,
    "entity_id"          TEXT NOT NULL,
    "store_code"         TEXT NOT NULL,
    "store_name"         TEXT NOT NULL,
    "state_province"     TEXT NOT NULL,
    "address_line1"      TEXT,
    "address_line2"      TEXT,
    "city"               TEXT,
    "postal_code"        TEXT,
    "dmv_id"             TEXT,
    "status"             TEXT NOT NULL DEFAULT 'ACTIVE',
    "version"            INTEGER NOT NULL DEFAULT 1,
    "deactivated_at"     TIMESTAMPTZ,
    "deactivated_by"     TEXT,
    "deactivation_reason" TEXT,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- Unique store code per entity (BR201-1)
CREATE UNIQUE INDEX "stores_entity_id_store_code_key" ON "stores"("entity_id", "store_code");

-- Tenant-scoped lookup indexes
CREATE INDEX "stores_tenant_id_idx"        ON "stores"("tenant_id");
CREATE INDEX "stores_tenant_id_entity_id_idx" ON "stores"("tenant_id", "entity_id");
CREATE INDEX "stores_tenant_id_status_idx" ON "stores"("tenant_id", "status");
