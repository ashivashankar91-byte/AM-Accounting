-- CreateTable
CREATE TABLE IF NOT EXISTS "gl_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sub_type" TEXT,
    "normal_balance" TEXT NOT NULL DEFAULT 'DEBIT',
    "allow_posting" BOOLEAN NOT NULL DEFAULT true,
    "schedule_code" TEXT,
    "gl_group" TEXT,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "cos_account_id" TEXT,
    "inv_account_id" TEXT,
    "track_units" BOOLEAN NOT NULL DEFAULT false,
    "opening_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "opening_unit_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "agent_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "prior_period_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_reason" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "gl_account_id" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memo" TEXT,
    "department_code" TEXT,
    "technician_id" TEXT,
    "ro_number" TEXT,
    "ro_line_number" INTEGER,
    "flat_rate_hours" DOUBLE PRECISION,
    "clock_hours" DOUBLE PRECISION,
    "part_number" TEXT,
    "part_quantity" DOUBLE PRECISION,
    "earning_code" TEXT,
    "deal_product_code" TEXT,
    "deal_number" TEXT,
    "vehicle_vin" TEXT,
    "module_source" TEXT,
    "labor_type" TEXT,
    "cost_type" TEXT,
    "agent_confidence" DOUBLE PRECISION,
    "cost_amount" DOUBLE PRECISION,
    "apply_cd" TEXT,
    "rev_adj_flag" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deal_product_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sale_price" DOUBLE PRECISION NOT NULL,
    "dealer_cost" DOUBLE PRECISION NOT NULL,
    "gross_profit" DOUBLE PRECISION NOT NULL,
    "provider_name" TEXT,

    CONSTRAINT "deal_product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "gl_account_period_balances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "gl_account_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "journal_source" TEXT NOT NULL,
    "running_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_account_period_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "history_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "journal_source" TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT NOT NULL,
    "dupe_sequence" INTEGER NOT NULL DEFAULT 0,
    "line_number" INTEGER NOT NULL,
    "post_type" TEXT NOT NULL DEFAULT ' ',
    "gl_account_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "cost_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "apply_number" TEXT,
    "control_number" TEXT,
    "description" TEXT,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "clear_code" TEXT NOT NULL DEFAULT ' ',
    "rev_adj_flag" TEXT NOT NULL DEFAULT ' ',
    "auto_post_flag" TEXT NOT NULL DEFAULT ' ',
    "from_program" TEXT,
    "entered_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by_user_id" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "autopost_summarized_at" TIMESTAMP(3),

    CONSTRAINT "history_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "intercompany_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "counterparty_tenant_id" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "counterparty_journal_entry_id" TEXT,
    "entry_type" TEXT NOT NULL DEFAULT 'VEHICLE_TRANSFER',
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "elimination_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intercompany_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_accounts_tenant_id_idx" ON "gl_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_tenant_id_code_key" ON "gl_accounts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_status_idx" ON "journal_entries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_ref_idx" ON "journal_entries"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_department_code_idx" ON "journal_lines"("department_code");

-- CreateIndex
CREATE INDEX "journal_lines_technician_id_idx" ON "journal_lines"("technician_id");

-- CreateIndex
CREATE INDEX "journal_lines_part_number_idx" ON "journal_lines"("part_number");

-- CreateIndex
CREATE INDEX "journal_lines_module_source_idx" ON "journal_lines"("module_source");

-- CreateIndex
CREATE INDEX "journal_lines_deal_number_idx" ON "journal_lines"("deal_number");

-- CreateIndex
CREATE INDEX "journal_lines_ro_number_idx" ON "journal_lines"("ro_number");

-- CreateIndex
CREATE INDEX "deal_product_lines_journal_entry_id_idx" ON "deal_product_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "deal_product_lines_deal_number_idx" ON "deal_product_lines"("deal_number");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_retry_count_idx" ON "outbox_events"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE INDEX "gl_account_period_balances_tenant_id_idx" ON "gl_account_period_balances"("tenant_id");

-- CreateIndex
CREATE INDEX "gl_account_period_balances_tenant_id_gl_account_id_period_y_idx" ON "gl_account_period_balances"("tenant_id", "gl_account_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "gl_account_period_balances_tenant_id_gl_account_id_period_y_key" ON "gl_account_period_balances"("tenant_id", "gl_account_id", "period_year", "period_month", "journal_source");

-- CreateIndex
CREATE INDEX "history_transactions_tenant_id_idx" ON "history_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "history_transactions_tenant_id_gl_account_id_idx" ON "history_transactions"("tenant_id", "gl_account_id");

-- CreateIndex
CREATE INDEX "history_transactions_tenant_id_journal_source_transaction_d_idx" ON "history_transactions"("tenant_id", "journal_source", "transaction_date");

-- CreateIndex
CREATE INDEX "history_transactions_journal_entry_id_idx" ON "history_transactions"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "history_transactions_tenant_id_journal_source_transaction_d_key" ON "history_transactions"("tenant_id", "journal_source", "transaction_date", "reference_number", "dupe_sequence", "line_number", "post_type");

-- CreateIndex
CREATE INDEX "intercompany_entries_tenant_id_idx" ON "intercompany_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "intercompany_entries_counterparty_tenant_id_idx" ON "intercompany_entries"("counterparty_tenant_id");

-- CreateIndex
CREATE INDEX "intercompany_entries_status_idx" ON "intercompany_entries"("status");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_product_lines" ADD CONSTRAINT "deal_product_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_account_period_balances" ADD CONSTRAINT "gl_account_period_balances_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_transactions" ADD CONSTRAINT "history_transactions_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- CreateTable
CREATE TABLE IF NOT EXISTS "schedules" (
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
CREATE TABLE IF NOT EXISTS "schedule_details" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "control_number" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reference_number" VARCHAR(12),
    "journal_source" CHAR(2),
    "transaction_date" TIMESTAMP(3),
    "gl_account_number" CHAR(5),
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
CREATE TABLE IF NOT EXISTS "schedule_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "can_access" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "schedule_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
CREATE INDEX "outbox_events_published_at_retry_count_idx" ON "outbox_events"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- AddForeignKey
ALTER TABLE "schedule_details" ADD CONSTRAINT "schedule_details_tenant_id_schedule_number_fkey" FOREIGN KEY ("tenant_id", "schedule_number") REFERENCES "schedules"("tenant_id", "schedule_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_permissions" ADD CONSTRAINT "schedule_permissions_tenant_id_schedule_number_fkey" FOREIGN KEY ("tenant_id", "schedule_number") REFERENCES "schedules"("tenant_id", "schedule_number") ON DELETE RESTRICT ON UPDATE CASCADE;


