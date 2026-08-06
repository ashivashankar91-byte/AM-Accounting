-- S011 — Analysis Codes and Accounting Dimensions (P01, confirmed slice only).
-- Additive only. No destructive DDL, no existing column/table altered.
--
-- Scope note: this migration ships the registry (types/values) and the
-- journal-line tagging child table only. AMD-005/accumulator-adjacent
-- behavior (SES-3) is explicitly OUT of scope and not represented here — see
-- docs/accounting-modernization/build-packs/P01/P01_STORY_CONTRACTS.md "S011".

-- ── analysis_code_type ─────────────────────────────────────────────────────
CREATE TABLE "analysis_code_type" (
    "id"                   TEXT NOT NULL,
    "tenant_id"            TEXT NOT NULL,
    "code"                 VARCHAR(20) NOT NULL,
    "name"                 VARCHAR(120) NOT NULL,
    "is_active"            BOOLEAN NOT NULL DEFAULT true,
    "version"              INTEGER NOT NULL DEFAULT 1,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at"       TIMESTAMP(3),
    "deactivated_by"       TEXT,
    "deactivation_reason"  TEXT,

    CONSTRAINT "analysis_code_type_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analysis_code_type_tenant_id_code_key" ON "analysis_code_type"("tenant_id", "code");
CREATE INDEX "analysis_code_type_tenant_id_is_active_idx" ON "analysis_code_type"("tenant_id", "is_active");

-- ── analysis_code_value ────────────────────────────────────────────────────
CREATE TABLE "analysis_code_value" (
    "id"                   TEXT NOT NULL,
    "tenant_id"            TEXT NOT NULL,
    "type_id"              TEXT NOT NULL,
    "code"                 VARCHAR(20) NOT NULL,
    "name"                 VARCHAR(120) NOT NULL,
    "is_active"            BOOLEAN NOT NULL DEFAULT true,
    "version"              INTEGER NOT NULL DEFAULT 1,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at"       TIMESTAMP(3),
    "deactivated_by"       TEXT,
    "deactivation_reason"  TEXT,

    CONSTRAINT "analysis_code_value_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analysis_code_value_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "analysis_code_type"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "analysis_code_value_tenant_id_type_id_code_key" ON "analysis_code_value"("tenant_id", "type_id", "code");
CREATE INDEX "analysis_code_value_tenant_id_type_id_is_active_idx" ON "analysis_code_value"("tenant_id", "type_id", "is_active");

-- ── journal_line_analysis_tag ──────────────────────────────────────────────
-- Additive child of the certified journal_line table (BLK-15 — confirmed
-- safe, no column collision: see P01_REPOSITORY_VERIFICATION_RECONCILIATION.md
-- §4). Tags are written once, at the same time as the JournalLine row itself
-- (posting-service.ts), and are never updated afterward.
CREATE TABLE "journal_line_analysis_tag" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "journal_line_id"  TEXT NOT NULL,
    "type_id"          TEXT NOT NULL,
    "value_id"         TEXT NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_line_analysis_tag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_line_analysis_tag_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_line"("id") ON DELETE CASCADE,
    CONSTRAINT "journal_line_analysis_tag_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "analysis_code_type"("id"),
    CONSTRAINT "journal_line_analysis_tag_value_id_fkey" FOREIGN KEY ("value_id") REFERENCES "analysis_code_value"("id")
);

-- BR011-1's proposed "0..N tags, cap 3" is an application-layer rule (the
-- cap is enforced in posting-service.ts, not the DB); this unique index
-- enforces the separate, structural rule that a line may not carry two
-- different values for the SAME type at once.
CREATE UNIQUE INDEX "journal_line_analysis_tag_journal_line_id_type_id_key" ON "journal_line_analysis_tag"("journal_line_id", "type_id");
CREATE INDEX "journal_line_analysis_tag_tenant_id_value_id_idx" ON "journal_line_analysis_tag"("tenant_id", "value_id");
CREATE INDEX "journal_line_analysis_tag_tenant_id_type_id_idx" ON "journal_line_analysis_tag"("tenant_id", "type_id");
CREATE INDEX "journal_line_analysis_tag_journal_line_id_idx" ON "journal_line_analysis_tag"("journal_line_id");
