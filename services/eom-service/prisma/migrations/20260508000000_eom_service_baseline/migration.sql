-- eom-service baseline schema.
--
-- Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
-- APPLICATION): eom-service's prisma/migrations/ previously contained three
-- legacy flat .sql files (20260507_fix021_fiscal_periods.sql,
-- 20260507_build005_eom_step_started_at.sql,
-- 20260508_build012_eom_backups.sql) sitting directly in the migrations/
-- directory rather than Prisma's required folder-per-migration format
-- (migrations/<timestamp>_<name>/migration.sql). `prisma migrate deploy`
-- silently reported "No migration found in prisma/migrations" for this
-- reason — eom-service's tables (eom_closes, eom_backups, eom_steps,
-- year_end_records, fiscal_periods) were never actually created by any
-- migration tooling. The three legacy files' net effect is superseded by
-- this single baseline, generated via `prisma migrate diff --from-empty
-- --to-schema-datamodel prisma/schema.prisma --script` against the current
-- schema.prisma (which already reflected their intended end state) — this
-- is additive schema creation only, no data existed to migrate.
--
-- outbox_events is deliberately created with IF NOT EXISTS / its indexes
-- with IF NOT EXISTS: this table name (no service prefix) is intentionally
-- shared across six services' own OutboxEvent Prisma models mapping to the
-- same physical table (apar-service, eom-service, group-service,
-- gl-service, payroll-service, schedule-service — confirmed via
-- `@@map("outbox_events")` in each service's schema.prisma) — whichever
-- service's migration runs first legitimately creates it; this must not
-- fail if another service already has. Same defensive pattern already
-- used by tests/integration/rls-live-db/setup.sh's combined-schema
-- bootstrap step for this exact multi-service-shared-table situation.

-- CreateTable
CREATE TABLE IF NOT EXISTS "eom_closes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "close_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "blocked_reason" TEXT,
    "initiated_by" TEXT,

    CONSTRAINT "eom_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eom_backups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "eom_close_id" TEXT NOT NULL,
    "backup_type" TEXT NOT NULL,
    "backup_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eom_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eom_steps" (
    "id" TEXT NOT NULL,
    "eom_close_id" TEXT NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "eom_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "year_end_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initiated_by" TEXT NOT NULL,

    CONSTRAINT "year_end_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "period_number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable (shared across services — see header note)
CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_closes_tenant_id_idx" ON "eom_closes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eom_closes_tenant_id_period_year_period_month_close_type_key" ON "eom_closes"("tenant_id", "period_year", "period_month", "close_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_backups_eom_close_id_idx" ON "eom_backups"("eom_close_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_backups_tenant_id_idx" ON "eom_backups"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_steps_eom_close_id_idx" ON "eom_steps"("eom_close_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "year_end_records_tenant_id_idx" ON "year_end_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "year_end_records_tenant_id_fiscal_year_key" ON "year_end_records"("tenant_id", "fiscal_year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fiscal_periods_tenant_id_fiscal_year_idx" ON "fiscal_periods"("tenant_id", "fiscal_year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fiscal_periods_tenant_id_status_idx" ON "fiscal_periods"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_periods_tenant_id_fiscal_year_period_number_key" ON "fiscal_periods"("tenant_id", "fiscal_year", "period_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_published_at_retry_count_idx" ON "outbox_events"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_tenant_id_idx" ON "outbox_events"("tenant_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "eom_backups" ADD CONSTRAINT "eom_backups_eom_close_id_fkey" FOREIGN KEY ("eom_close_id") REFERENCES "eom_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "eom_steps" ADD CONSTRAINT "eom_steps_eom_close_id_fkey" FOREIGN KEY ("eom_close_id") REFERENCES "eom_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Hand-written CHECK constraints from the superseded legacy flat-file
-- migrations (20260507_fix021_fiscal_periods.sql,
-- 20260508_build012_eom_backups.sql) — not expressible in Prisma schema
-- language, so `prisma migrate diff --to-schema-datamodel` above cannot
-- regenerate them; preserved explicitly here so this baseline is a
-- complete, lossless replacement, not just a table-shape approximation.

-- FIX-021: 13-period fiscal year support (@cobol-origin KOMFCAL).
DO $$ BEGIN
  ALTER TABLE "eom_closes" ADD CONSTRAINT "chk_period_month" CHECK ("period_month" BETWEEN 1 AND 13);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fiscal_periods" ADD CONSTRAINT "chk_fiscal_periods_period_number" CHECK ("period_number" BETWEEN 1 AND 13);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fiscal_periods" ADD CONSTRAINT "chk_fiscal_periods_status" CHECK ("status" IN ('OPEN', 'CLOSED', 'ADJUSTMENT', 'YEAR_END'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- BUILD-012: pre-purge disaster-recovery snapshot backup-type enum.
DO $$ BEGIN
  ALTER TABLE "eom_backups" ADD CONSTRAINT "chk_eom_backups_backup_type" CHECK ("backup_type" IN ('GL_ACCOUNTS', 'PERIOD_BALANCES'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
