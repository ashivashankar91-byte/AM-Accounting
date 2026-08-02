-- CE-11 S063 gap-closure — approved unapplied-time absorption policy.
-- Additive only: new tables `labor_rate_config` / `tech_time_absorption_reversal`,
-- and new NULLABLE columns on `tech_time_absorption` (existing/historical
-- rows genuinely have no captured rate — never backfilled).

-- CreateTable
CREATE TABLE "labor_rate_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "burdened_rate" DECIMAL(10,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "labor_rate_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labor_rate_config_tenant_id_legal_entity_id_scope_subject_k_key" ON "labor_rate_config"("tenant_id", "legal_entity_id", "scope", "subject_key", "effective_from");

-- CreateIndex
CREATE INDEX "labor_rate_config_tenant_id_legal_entity_id_scope_subject_k_idx" ON "labor_rate_config"("tenant_id", "legal_entity_id", "scope", "subject_key");

-- AlterTable: additive columns on tech_time_absorption
ALTER TABLE "tech_time_absorption" ADD COLUMN "dept_code" TEXT;
ALTER TABLE "tech_time_absorption" ADD COLUMN "rate_id" TEXT;
ALTER TABLE "tech_time_absorption" ADD COLUMN "rate_source" TEXT;
ALTER TABLE "tech_time_absorption" ADD COLUMN "rate_amount" DECIMAL(10,4);
ALTER TABLE "tech_time_absorption" ADD COLUMN "rate_effective_from" DATE;
ALTER TABLE "tech_time_absorption" ADD COLUMN "unapplied_amount" DECIMAL(15,2);
ALTER TABLE "tech_time_absorption" ADD COLUMN "shortfall_amount" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "tech_time_absorption_reversal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tech_time_absorption_id" TEXT NOT NULL,
    "tech_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "original_journal_entry_id" TEXT NOT NULL,
    "reversal_journal_entry_id" TEXT,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_time_absorption_reversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tech_time_absorption_reversal_tech_time_absorption_id_key" ON "tech_time_absorption_reversal"("tech_time_absorption_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_time_absorption_reversal_tenant_id_tech_id_payroll_per_key" ON "tech_time_absorption_reversal"("tenant_id", "tech_id", "payroll_period_id");

-- AddForeignKey
ALTER TABLE "tech_time_absorption_reversal" ADD CONSTRAINT "tech_time_absorption_reversal_tech_time_absorption_id_fkey" FOREIGN KEY ("tech_time_absorption_id") REFERENCES "tech_time_absorption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
