-- Baseline migration for schedule-service (Wave 3 Schedule Sub-System,
-- docs/gap-analysis/wave-3-schedule-subsystem.md). These four tables
-- (schedules, schedule_details, schedule_permissions, outbox_events) were
-- previously applied directly against the shared `amacc` database (see
-- services/schedule-service/sched-create.sql) without ever being tracked by
-- Prisma migration history — no prisma/migrations directory existed before
-- this one. This migration captures that already-applied schema verbatim (it
-- is baselined via `prisma migrate resolve --applied`, not re-executed
-- against an environment that already has these tables) so schedule-service
-- has a real, replayable migration history going forward, starting with
-- S026/S027.

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "title" VARCHAR(29) NOT NULL,
    "report_sequence" CHAR(1) NOT NULL DEFAULT 'C',
    "schedule_type" INTEGER NOT NULL,
    "gl_account_numbers" TEXT[],
    "eom_purge_type" INTEGER NOT NULL,
    "control_name_display" CHAR(1) NOT NULL DEFAULT ' ',

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_details" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reference_number" VARCHAR(12),
    "journal_source" CHAR(2),
    "transaction_date" TIMESTAMP(3),
    "gl_account_number" VARCHAR(20),
    "description" VARCHAR(35),
    "is_balance_forward" BOOLEAN NOT NULL DEFAULT false,
    "balance_current" DECIMAL(15,2),
    "balance_over_30" DECIMAL(15,2),
    "balance_over_60" DECIMAL(15,2),
    "balance_over_90" DECIMAL(15,2),
    "apply_number" VARCHAR(12),
    "apply_cd" CHAR(1),
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "can_access" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "schedule_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
-- APPLICATION): "outbox_events" (no service prefix) is intentionally
-- shared across six services' own OutboxEvent Prisma models mapping to the
-- same physical table (apar-service, eom-service, group-service,
-- gl-service, payroll-service, schedule-service). Deploying every
-- service's migrations to a genuinely empty database (this migration's own
-- header comment above notes it was previously only ever baselined via
-- `prisma migrate resolve --applied`, never actually executed) exposed
-- that whichever of these services' migrations runs after another already
-- created this table fails with 42P07 ("relation already exists") — its
-- creation must be idempotent across all of them, same as
-- gl-service's 20260506000000_init_gl_service and eom-service's
-- 20260508000000_eom_service_baseline already are.
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
CREATE INDEX "schedules_tenant_id_idx" ON "schedules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_schedule_number_key" ON "schedules"("tenant_id", "schedule_number");

-- CreateIndex
CREATE INDEX "schedule_details_tenant_id_schedule_number_idx" ON "schedule_details"("tenant_id", "schedule_number");

-- CreateIndex
CREATE INDEX "schedule_details_tenant_id_schedule_number_control_number_idx" ON "schedule_details"("tenant_id", "schedule_number", "control_number");

-- CreateIndex
CREATE INDEX "schedule_details_tenant_id_schedule_number_gl_account_numbe_idx" ON "schedule_details"("tenant_id", "schedule_number", "gl_account_number");

-- CreateIndex
CREATE INDEX "schedule_details_tenant_id_journal_entry_id_idx" ON "schedule_details"("tenant_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "schedule_permissions_tenant_id_user_id_idx" ON "schedule_permissions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "schedule_permissions_tenant_id_schedule_number_idx" ON "schedule_permissions"("tenant_id", "schedule_number");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_permissions_tenant_id_user_id_schedule_number_key" ON "schedule_permissions"("tenant_id", "user_id", "schedule_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_published_at_retry_count_idx" ON "outbox_events"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- AddForeignKey
ALTER TABLE "schedule_details" ADD CONSTRAINT "schedule_details_tenant_id_schedule_number_fkey" FOREIGN KEY ("tenant_id", "schedule_number") REFERENCES "schedules"("tenant_id", "schedule_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_permissions" ADD CONSTRAINT "schedule_permissions_tenant_id_schedule_number_fkey" FOREIGN KEY ("tenant_id", "schedule_number") REFERENCES "schedules"("tenant_id", "schedule_number") ON DELETE RESTRICT ON UPDATE CASCADE;
