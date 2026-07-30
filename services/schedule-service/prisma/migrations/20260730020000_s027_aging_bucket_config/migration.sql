-- S027: Schedule Aging Engine — per-tenant configurable aging buckets.
CREATE TABLE "schedule_aging_bucket_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "buckets" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "schedule_aging_bucket_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_aging_bucket_configs_tenant_id_key" ON "schedule_aging_bucket_configs"("tenant_id");
