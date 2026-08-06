-- S032 — Recurring Journal Templates. Additive only: 3 new tables plus 3
-- nullable columns on the existing manual_je_draft table (BR032-3 generation
-- linkage, BR032-4 idempotency batch tag, BR032-5 auto-reverse linkage). No
-- existing column, index, or constraint is altered or dropped.

-- ── manual_je_draft: additive S032 linkage columns ───────────────────────────
ALTER TABLE "manual_je_draft" ADD COLUMN "generated_from_template_id" TEXT;
ALTER TABLE "manual_je_draft" ADD COLUMN "generation_batch_id" TEXT;
ALTER TABLE "manual_je_draft" ADD COLUMN "reversal_of_journal_id" TEXT;

CREATE INDEX "manual_je_draft_generated_from_template_id_idx"
  ON "manual_je_draft"("generated_from_template_id");

-- ── recurring_journal_template ───────────────────────────────────────────────
CREATE TABLE "recurring_journal_template" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "entity_id"     TEXT NOT NULL,
    "code"          VARCHAR(40) NOT NULL,
    "name"          VARCHAR(120) NOT NULL,
    "description"   VARCHAR(500),
    "source_code"   TEXT NOT NULL DEFAULT 'RT',
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "auto_reverse"  BOOLEAN NOT NULL DEFAULT false,
    "version"       INTEGER NOT NULL DEFAULT 1,
    "actor"         TEXT NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journal_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_journal_template_tenant_id_entity_id_code_key"
  ON "recurring_journal_template"("tenant_id", "entity_id", "code");

CREATE INDEX "recurring_journal_template_tenant_id_entity_id_active_idx"
  ON "recurring_journal_template"("tenant_id", "entity_id", "active");

-- ── recurring_journal_template_line ──────────────────────────────────────────
CREATE TABLE "recurring_journal_template_line" (
    "id"             TEXT NOT NULL,
    "template_id"    TEXT NOT NULL,
    "tenant_id"      TEXT NOT NULL,
    "line_index"     INTEGER NOT NULL,
    "account_id"     TEXT NOT NULL,
    "account_number" VARCHAR(5) NOT NULL,
    "store_id"       TEXT NOT NULL,
    "dept_code"      TEXT,
    "control_number" TEXT,
    "apply_number"   TEXT,
    "dr"             DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cr"             DECIMAL(15,2) NOT NULL DEFAULT 0,
    "memo"           VARCHAR(500),

    CONSTRAINT "recurring_journal_template_line_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_journal_template_line_template_id_idx"
  ON "recurring_journal_template_line"("template_id");

CREATE INDEX "recurring_journal_template_line_tenant_id_idx"
  ON "recurring_journal_template_line"("tenant_id");

ALTER TABLE "recurring_journal_template_line"
  ADD CONSTRAINT "recurring_journal_template_line_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "recurring_journal_template"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── recurring_template_generation ────────────────────────────────────────────
-- BR032-4: unique (tenant_id, template_id, period_id) is the idempotency key —
-- generating twice for the same template+period is a DB-enforced no-duplicate
-- guarantee, not just an application-level check.
CREATE TABLE "recurring_template_generation" (
    "id"                  TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL,
    "template_id"         TEXT NOT NULL,
    "entity_id"           TEXT NOT NULL,
    "period_id"           TEXT NOT NULL,
    "period_code"         TEXT NOT NULL,
    "batch_id"            TEXT NOT NULL,
    "draft_id"            TEXT NOT NULL,
    "template_version"    INTEGER NOT NULL,
    "reversal_draft_id"   TEXT,
    "reversal_period_id"  TEXT,
    "generated_by"        TEXT NOT NULL,
    "generated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_template_generation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_template_generation_tenant_id_template_id_period__key"
  ON "recurring_template_generation"("tenant_id", "template_id", "period_id");

CREATE UNIQUE INDEX "recurring_template_generation_tenant_id_draft_id_key"
  ON "recurring_template_generation"("tenant_id", "draft_id");

CREATE INDEX "recurring_template_generation_tenant_id_batch_id_idx"
  ON "recurring_template_generation"("tenant_id", "batch_id");

ALTER TABLE "recurring_template_generation"
  ADD CONSTRAINT "recurring_template_generation_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "recurring_journal_template"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
