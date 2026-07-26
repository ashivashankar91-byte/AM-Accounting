-- ACC-S203: Departments table
-- Department codes 01-12 are canonical (platform-seeded per entity).
-- Custom codes must be in range 20-89.
-- code is immutable after creation; name is editable and unique per entity.
-- Deactivation is soft-only — rows are never deleted.

CREATE TABLE "departments" (
    "id"                  TEXT         NOT NULL,
    "tenant_id"           TEXT         NOT NULL,
    "entity_id"           TEXT         NOT NULL,
    "code"                VARCHAR(2)   NOT NULL,
    "name"                VARCHAR(60)  NOT NULL,
    "canonical"           BOOLEAN      NOT NULL DEFAULT false,
    "status"              TEXT         NOT NULL DEFAULT 'ACTIVE',
    "version"             INTEGER      NOT NULL DEFAULT 1,
    "deactivated_at"      TIMESTAMPTZ,
    "deactivated_by"      TEXT,
    "deactivation_reason" TEXT,
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- One code per entity (BR203-1 immutable code uniqueness)
CREATE UNIQUE INDEX "departments_entity_id_code_key"  ON "departments"("entity_id", "code");
-- One name per entity (PO: DUPLICATE_DEPARTMENT_NAME)
CREATE UNIQUE INDEX "departments_entity_id_name_key"  ON "departments"("entity_id", "name");

-- Tenant-scoped lookup indexes
CREATE INDEX "departments_tenant_id_idx"           ON "departments"("tenant_id");
CREATE INDEX "departments_tenant_id_entity_id_idx" ON "departments"("tenant_id", "entity_id");
CREATE INDEX "departments_tenant_id_status_idx"    ON "departments"("tenant_id", "status");
