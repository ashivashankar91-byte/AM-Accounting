-- S026: Schedule Open-Item Core.
-- NOTE: this repo runs one shared Postgres database across all 35 services,
-- each with its own prisma/migrations history (see project memory:
-- "Never use `prisma db push --accept-data-loss` per-service on shared DB").
-- `prisma migrate diff` against the live DB therefore proposes dropping every
-- OTHER service's tables/indexes (they aren't in schedule-service's own
-- schema.prisma) — that output was reviewed and discarded; only the
-- statements below, scoped to schedule-service's own objects, are applied.

-- AlterTable: per-line idempotency key on schedule_details, replacing the
-- old journalEntryId-only dedup in ScheduleEventHandlers (too coarse — it
-- silently dropped a second schedule-relevant line on the same journal
-- entry). Nullable: existing rows and manually-created details have none.
ALTER TABLE "schedule_details" ADD COLUMN "source_correlation_id" TEXT;

-- CreateTable
CREATE TABLE "schedule_open_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "item_number" VARCHAR(20) NOT NULL,
    "gl_account_number" VARCHAR(20),
    "journal_source" CHAR(2),
    "original_amount" DECIMAL(15,2) NOT NULL,
    "applied_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "remaining_balance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "transaction_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "description" VARCHAR(200),
    "journal_entry_id" TEXT NOT NULL,
    "schedule_detail_id" TEXT,
    "source_correlation_id" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_open_items_pkey" PRIMARY KEY ("id"),
    -- Over-application protection at the storage layer (defense in depth
    -- alongside the service-layer check inside the serializable transaction):
    -- remaining_balance must never exceed original_amount in magnitude, and
    -- must never cross zero to the opposite sign.
    CONSTRAINT "schedule_open_items_status_check" CHECK ("status" IN ('OPEN', 'PARTIALLY_APPLIED', 'CLOSED')),
    CONSTRAINT "schedule_open_items_balance_check" CHECK (
      (
        "original_amount" >= 0 AND "remaining_balance" >= 0 AND "remaining_balance" <= "original_amount"
      ) OR (
        "original_amount" < 0 AND "remaining_balance" <= 0 AND "remaining_balance" >= "original_amount"
      )
    )
);

-- CreateTable
CREATE TABLE "schedule_applications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "open_item_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "source_correlation_id" TEXT NOT NULL,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "applied_by" TEXT,
    "note" VARCHAR(500),
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    "reversal_of_id" TEXT,

    CONSTRAINT "schedule_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_gl_tie_outs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "gl_account_number" VARCHAR(20) NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "schedule_balance" DECIMAL(15,2) NOT NULL,
    "gl_balance" DECIMAL(15,2),
    "variance" DECIMAL(15,2),
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "gl_query_error" TEXT,
    "run_id" TEXT NOT NULL,
    "triggered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_gl_tie_outs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_gl_tie_outs_status_check" CHECK ("status" IN ('MATCHED', 'DISCREPANCY', 'GL_UNAVAILABLE'))
);

-- CreateIndex
CREATE INDEX "schedule_open_items_tenant_id_schedule_number_control_numbe_idx" ON "schedule_open_items"("tenant_id", "schedule_number", "control_number", "item_number");

-- CreateIndex
CREATE INDEX "schedule_open_items_tenant_id_schedule_number_status_idx" ON "schedule_open_items"("tenant_id", "schedule_number", "status");

-- CreateIndex
CREATE INDEX "schedule_open_items_tenant_id_gl_account_number_idx" ON "schedule_open_items"("tenant_id", "gl_account_number");

-- CreateIndex
CREATE INDEX "schedule_open_items_tenant_id_due_date_idx" ON "schedule_open_items"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_open_items_tenant_id_source_correlation_id_key" ON "schedule_open_items"("tenant_id", "source_correlation_id");

-- CreateIndex
CREATE INDEX "schedule_applications_tenant_id_open_item_id_idx" ON "schedule_applications"("tenant_id", "open_item_id");

-- CreateIndex
CREATE INDEX "schedule_applications_tenant_id_schedule_number_control_num_idx" ON "schedule_applications"("tenant_id", "schedule_number", "control_number");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_applications_tenant_id_source_correlation_id_key" ON "schedule_applications"("tenant_id", "source_correlation_id");

-- CreateIndex
CREATE INDEX "schedule_gl_tie_outs_tenant_id_as_of_date_idx" ON "schedule_gl_tie_outs"("tenant_id", "as_of_date");

-- CreateIndex
CREATE INDEX "schedule_gl_tie_outs_tenant_id_status_idx" ON "schedule_gl_tie_outs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "schedule_gl_tie_outs_tenant_id_run_id_idx" ON "schedule_gl_tie_outs"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_gl_tie_outs_tenant_id_schedule_number_gl_account_n_key" ON "schedule_gl_tie_outs"("tenant_id", "schedule_number", "gl_account_number", "as_of_date", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_details_tenant_id_source_correlation_id_key" ON "schedule_details"("tenant_id", "source_correlation_id");

-- AddForeignKey
ALTER TABLE "schedule_applications" ADD CONSTRAINT "schedule_applications_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "schedule_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
