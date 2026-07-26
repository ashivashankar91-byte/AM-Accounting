-- S013 — Balanced Journal Posting API: the single point of ledger truth.
-- Additive only. NUMERIC(15,2) for all money (never DOUBLE PRECISION — the
-- legacy gl-service used DOUBLE for lines; not carried forward). DR=CR is
-- enforced by a DEFERRABLE constraint trigger that fires at COMMIT, so lines
-- inserted after the header in the same transaction are all present when checked.

-- ── journal_entry ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "journal_entry" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "entity_id"        TEXT NOT NULL,
  "journal_number"   TEXT NOT NULL,
  "source_code"      TEXT NOT NULL,
  "period_id"        TEXT NOT NULL,
  "period_code"      TEXT NOT NULL,
  "entry_date"       DATE NOT NULL,
  "memo"             VARCHAR(500),
  "status"           TEXT NOT NULL DEFAULT 'POSTED',   -- POSTED | REVERSED
  "idempotency_key"  TEXT NOT NULL,
  "total_debits"     DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_credits"    DECIMAL(15,2) NOT NULL DEFAULT 0,
  "reversal_of"      TEXT,                              -- BR218 linkage (set by S218)
  "reversed_by"      TEXT,                              -- BR218 back-link (set by S218)
  "reversal_reason"  VARCHAR(500),                      -- reason on the reversal entry (S218)
  "draft_id"         TEXT,                              -- S216 POSTED-LINKED back-ref
  "posted_by"        TEXT NOT NULL,
  "posted_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- BR013-8 journal number unique per entity; BR013-6 idempotency unique per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entry_entity_number_key" ON "journal_entry"("entity_id", "journal_number");
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entry_tenant_idempotency_key" ON "journal_entry"("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "journal_entry_tenant_entity_idx" ON "journal_entry"("tenant_id", "entity_id");
CREATE INDEX IF NOT EXISTS "journal_entry_period_idx" ON "journal_entry"("entity_id", "period_code");
CREATE INDEX IF NOT EXISTS "journal_entry_reversal_of_idx" ON "journal_entry"("reversal_of");

-- ── journal_line ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "journal_line" (
  "id"                TEXT NOT NULL,
  "journal_entry_id"  TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "line_index"        INTEGER NOT NULL,
  "account_id"        TEXT NOT NULL,
  "account_number"    VARCHAR(5) NOT NULL,
  "store_id"          TEXT NOT NULL,
  "dept_code"         TEXT,
  "control_number"    TEXT,
  "apply_number"      TEXT,
  "dr"                DECIMAL(15,2) NOT NULL DEFAULT 0,
  "cr"                DECIMAL(15,2) NOT NULL DEFAULT 0,
  "memo"              VARCHAR(500),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_line_entry_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entry"("id") ON DELETE CASCADE,
  -- Exactly one side per line, non-negative.
  CONSTRAINT "journal_line_one_side" CHECK (
    ("dr" > 0 AND "cr" = 0) OR ("cr" > 0 AND "dr" = 0)
  )
);
CREATE INDEX IF NOT EXISTS "journal_line_entry_idx" ON "journal_line"("journal_entry_id");
CREATE INDEX IF NOT EXISTS "journal_line_account_idx" ON "journal_line"("account_id");
CREATE INDEX IF NOT EXISTS "journal_line_tenant_idx" ON "journal_line"("tenant_id");

-- ── balance_snapshot (append-only) ───────────────────────────────────────────────
-- One row per (posting, account) capturing the effect and the post-write balance.
-- Append-only: never UPDATEd or DELETEd. Interim single table; partition by
-- (entity_id, period_code) is a future optimization (UQ / R1).
CREATE TABLE IF NOT EXISTS "balance_snapshot" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "entity_id"         TEXT NOT NULL,
  "account_id"        TEXT NOT NULL,
  "journal_entry_id"  TEXT NOT NULL,
  "journal_number"    TEXT NOT NULL,
  "period_code"       TEXT NOT NULL,
  "dr"                DECIMAL(15,2) NOT NULL DEFAULT 0,
  "cr"                DECIMAL(15,2) NOT NULL DEFAULT 0,
  "delta"             DECIMAL(15,2) NOT NULL DEFAULT 0,   -- normal-balance signed
  "balance_after"     DECIMAL(15,2) NOT NULL DEFAULT 0,
  "posted_at"         TIMESTAMP(3) NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "balance_snapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "balance_snapshot_account_idx" ON "balance_snapshot"("entity_id", "account_id", "period_code");
CREATE INDEX IF NOT EXISTS "balance_snapshot_entry_idx" ON "balance_snapshot"("journal_entry_id");

-- ── DR=CR deferred constraint trigger (BR013-1, DB-level safeguard) ───────────────
-- Fires at COMMIT so every line of the entry is present. Applies only to POSTED
-- entries. Cannot be bypassed by application code.
CREATE OR REPLACE FUNCTION je_check_balanced()
RETURNS TRIGGER AS $$
DECLARE
  d NUMERIC(15,2);
  c NUMERIC(15,2);
BEGIN
  IF NEW.status = 'POSTED' OR NEW.status = 'REVERSED' THEN
    SELECT COALESCE(SUM(dr), 0), COALESCE(SUM(cr), 0)
      INTO d, c
      FROM journal_line
     WHERE journal_entry_id = NEW.id;

    IF d IS NULL OR d = 0 THEN
      RAISE EXCEPTION 'Journal % has no lines', NEW.journal_number;
    END IF;
    IF d <> c THEN
      RAISE EXCEPTION 'Journal % is not balanced: debits % <> credits %', NEW.journal_number, d, c;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_balanced ON journal_entry;
CREATE CONSTRAINT TRIGGER trg_je_balanced
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balanced();

SELECT '---APPLIED---' AS status;
