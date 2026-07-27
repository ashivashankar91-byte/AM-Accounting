-- S221 — GL Search: persisted, re-runnable named searches (BR221-2).
-- Additive only.

CREATE TABLE "saved_gl_search" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "criteria" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_gl_search_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_gl_search_tenant_id_created_by_name_key" ON "saved_gl_search"("tenant_id", "created_by", "name");

CREATE INDEX "saved_gl_search_tenant_id_created_by_idx" ON "saved_gl_search"("tenant_id", "created_by");
