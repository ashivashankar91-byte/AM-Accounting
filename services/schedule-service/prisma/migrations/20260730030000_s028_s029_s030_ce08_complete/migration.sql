-- CE-08 completion: S028 (relieving policy support), S029 (split / transfer /
-- write-off), S030 (statements / dunning), and the S027 exception engine that
-- was documented as "[EVIDENCE exists]" in the Fable package but was not
-- actually implemented in the certified S026/S027 code found in this
-- worktree. Additive-only: no existing table/column dropped or narrowed.

-- ── S029: split lineage + write-off fields on schedule_open_items ──────────
ALTER TABLE "schedule_open_items"
  ADD COLUMN "parent_item_id" TEXT,
  ADD COLUMN "write_off_reason" VARCHAR(500),
  ADD COLUMN "write_off_journal_entry_id" TEXT;

CREATE INDEX "schedule_open_items_tenant_id_parent_item_id_idx" ON "schedule_open_items"("tenant_id", "parent_item_id");

-- S029 write-off ceremony introduces a fourth open-item lifecycle status
-- (WRITTEN_OFF, domain/open-item.ts OpenItemStatus) distinct from CLOSED —
-- deliberately not folded into CLOSED so the existing "status != CLOSED"
-- open-item lookup in processPostingEvent still matches a written-off item,
-- letting the pre-existing over-application safety net reject a
-- JOURNAL_ENTRY_POSTED replay of the write-off's own credit line (see
-- infrastructure/gl-posting-client.ts for the full rationale). The original
-- S026 CHECK constraint only permitted OPEN/PARTIALLY_APPLIED/CLOSED and
-- must be widened, or every writeOffOpenItem() call would fail at the
-- database layer with a CHECK violation.
ALTER TABLE "schedule_open_items" DROP CONSTRAINT "schedule_open_items_status_check";
ALTER TABLE "schedule_open_items" ADD CONSTRAINT "schedule_open_items_status_check"
  CHECK ("status" IN ('OPEN', 'PARTIALLY_APPLIED', 'CLOSED', 'WRITTEN_OFF'));

-- ── S029: idempotent ceremony ledger (split / transfer / writeoff) ─────────
CREATE TABLE "schedule_ceremonies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ceremony_type" TEXT NOT NULL,
    "open_item_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actor" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_ceremonies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_ceremonies_tenant_id_idempotency_key_key" ON "schedule_ceremonies"("tenant_id", "idempotency_key");
CREATE INDEX "schedule_ceremonies_tenant_id_open_item_id_idx" ON "schedule_ceremonies"("tenant_id", "open_item_id");

-- ── S029: D-CE08-02 write-off threshold (SAFE_CONFIGURATION, default unset) ─
CREATE TABLE "schedule_write_off_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "threshold_amount" DECIMAL(15,2),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "schedule_write_off_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_write_off_configs_tenant_id_key" ON "schedule_write_off_configs"("tenant_id");

-- ── S027 completion: exception rule configuration ──────────────────────────
CREATE TABLE "schedule_exception_rule_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stale_days" INTEGER NOT NULL DEFAULT 90,
    "control_limit_amount" DECIMAL(15,2),
    "normal_balance" TEXT NOT NULL DEFAULT 'DEBIT',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "schedule_exception_rule_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_exception_rule_configs_tenant_id_key" ON "schedule_exception_rule_configs"("tenant_id");

-- ── S027 completion: exception worklist ────────────────────────────────────
CREATE TABLE "schedule_exceptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "open_item_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "rule_type" TEXT NOT NULL,
    "detail" VARCHAR(500) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "disposition_note" VARCHAR(500),
    "dispositioned_by" TEXT,
    "dispositioned_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" TEXT NOT NULL,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_exceptions_tenant_id_open_item_id_rule_type_status_key" ON "schedule_exceptions"("tenant_id", "open_item_id", "rule_type", "status");
CREATE INDEX "schedule_exceptions_tenant_id_schedule_number_status_idx" ON "schedule_exceptions"("tenant_id", "schedule_number", "status");
CREATE INDEX "schedule_exceptions_tenant_id_run_id_idx" ON "schedule_exceptions"("tenant_id", "run_id");

-- ── S030: statement generation evidence ────────────────────────────────────
CREATE TABLE "schedule_statement_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT NOT NULL,
    "delivery_channel" TEXT NOT NULL DEFAULT 'PRINT_PDF',
    "total_amount" DECIMAL(15,2) NOT NULL,
    "item_count" INTEGER NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "schedule_statement_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_statement_runs_tenant_id_schedule_number_control__idx" ON "schedule_statement_runs"("tenant_id", "schedule_number", "control_number");
CREATE INDEX "schedule_statement_runs_tenant_id_as_of_date_idx" ON "schedule_statement_runs"("tenant_id", "as_of_date");

-- ── S030: D-CE08-05 dunning content/timing (SAFE_CONFIGURATION) ───────────
CREATE TABLE "schedule_dunning_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "levels" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "schedule_dunning_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_dunning_configs_tenant_id_key" ON "schedule_dunning_configs"("tenant_id");

-- ── S030: dunning generation evidence ───────────────────────────────────────
CREATE TABLE "schedule_dunning_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "level" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT NOT NULL,
    "statement_run_id" TEXT,
    "content" JSONB NOT NULL,

    CONSTRAINT "schedule_dunning_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_dunning_runs_tenant_id_schedule_number_control_nu_idx" ON "schedule_dunning_runs"("tenant_id", "schedule_number", "control_number");

-- ── S028: unapplied-receipt routing record (hand-off to CE-09/S023) ────────
CREATE TABLE "schedule_unapplied_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "source_correlation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CE09_CREDIT_ROUTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_unapplied_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_unapplied_receipts_tenant_id_source_correlation_i_key" ON "schedule_unapplied_receipts"("tenant_id", "source_correlation_id");
CREATE INDEX "schedule_unapplied_receipts_tenant_id_schedule_number_cont_idx" ON "schedule_unapplied_receipts"("tenant_id", "schedule_number", "control_number");
CREATE INDEX "schedule_unapplied_receipts_tenant_id_status_idx" ON "schedule_unapplied_receipts"("tenant_id", "status");
