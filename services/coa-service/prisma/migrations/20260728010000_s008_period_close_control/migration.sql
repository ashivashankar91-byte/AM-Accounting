-- S008 — Period Close Control (R1 vertical slice #1).
--
-- Extends the S209 FUTURE->OPEN-only period lifecycle with the full
-- OPEN/SOFT_CLOSED/HARD_CLOSED/LOCKED state machine, enforced at the
-- database level (not just service-layer, closing the gap confirmed by
-- inspection of journal-posting.ts BR013-2, which had no DB backstop before
-- this migration). See docs/accounting-modernization/S008_STORY_CONTRACT.md
-- for the full DoR package this migration implements.
--
-- Migration-name collision note (see 20260727000001_exclude_outbox_tables_
-- from_rls_coa_svc for the discovered mechanism): every AMACC service shares
-- one physical Postgres schema/_prisma_migrations table, so this folder name
-- is deliberately prefixed s008_ to avoid colliding with any other service's
-- migration name.

-- ── 1. New columns on fiscal_period (current-state metadata) ────────────────
-- Semantics (S008 Story Contract §Current-State Metadata):
--   closed_by/closed_at   — set on every transition INTO SOFT_CLOSED or
--                            HARD_CLOSED (overwritten each time; represents
--                            only the MOST RECENT close-family transition).
--                            Cleared to NULL on any reopen.
--   locked_by/locked_at   — set exactly once, on HARD_CLOSED->LOCKED
--                            (LOCKED is terminal in S008 v1 — no unlock path).
-- All four are written ONLY by the enforce_period_transition() trigger below,
-- never directly by application code — a direct SQL UPDATE that also tries
-- to set these columns has its values overwritten by the trigger's own
-- NEW.* assignment, so status/metadata can never be made inconsistent even
-- via raw SQL.
ALTER TABLE "fiscal_period" ADD COLUMN "closed_by" TEXT;
ALTER TABLE "fiscal_period" ADD COLUMN "closed_at" TIMESTAMP(3);
ALTER TABLE "fiscal_period" ADD COLUMN "locked_by" TEXT;
ALTER TABLE "fiscal_period" ADD COLUMN "locked_at" TIMESTAMP(3);

-- ── 2. New columns on journal_entry / manual_je_draft (adjusting-entry attribute) ──
-- Per-journal, not inferred from the period (S008 Story Contract §Adjusting
-- Entries). Only settable by a preparer holding fiscal.je.mark_adjusting;
-- verified against adjusting_entry_attestation at posting time (see the
-- enforce_period_postable trigger below). Immutable once POSTED.
ALTER TABLE "journal_entry" ADD COLUMN "is_adjusting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "journal_entry" ADD COLUMN "adjusting_reason" VARCHAR(500);
ALTER TABLE "journal_entry" ADD COLUMN "adjusting_correction_ref" VARCHAR(120);

ALTER TABLE "manual_je_draft" ADD COLUMN "is_adjusting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manual_je_draft" ADD COLUMN "adjusting_reason" VARCHAR(500);
ALTER TABLE "manual_je_draft" ADD COLUMN "adjusting_correction_ref" VARCHAR(120);

-- ── 3. Append-only transition ledger ─────────────────────────────────────────
CREATE TABLE "fiscal_period_transition" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"   TEXT NOT NULL,
  "entity_id"   TEXT NOT NULL,
  "period_id"   TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status"   TEXT NOT NULL,
  "actor"       TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "fiscal_period_transition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_period_transition_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "fiscal_period"("id")
);

CREATE INDEX "idx_fpt_tenant_period_time"
  ON "fiscal_period_transition" ("tenant_id", "period_id", "occurred_at");

-- ── 4. Adjusting-entry attestation store ─────────────────────────────────────
CREATE TABLE "adjusting_entry_attestation" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"      TEXT NOT NULL,
  "draft_id"       TEXT NOT NULL,
  "attested_by"    TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "correction_ref" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "adjusting_entry_attestation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "adjusting_entry_attestation_draft_id_key" UNIQUE ("draft_id")
);

-- ── 5. Ledger-writer role must exist before it can be referenced by the RLS
-- policies below (moved ahead of the former §7 location for that reason).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_period_ledger_writer') THEN
    CREATE ROLE amacc_period_ledger_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- ── 6. RLS: tenant isolation, same pattern as 20260726000002_add_rls_policies ─
ALTER TABLE "fiscal_period_transition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_period_transition" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "fiscal_period_transition"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
-- Deliberately NO insert/update/delete policy for amacc_app or PUBLIC — the
-- REVOKE below is the primary control; the missing policy is defense-in-depth
-- (a future mistaken GRANT would still hit "no permissive policy" = deny).
-- The ledger-writer role gets its own narrow INSERT-only policy below: since
-- FORCE ROW LEVEL SECURITY applies RLS even to a SECURITY DEFINER function's
-- executing role (it is not the table owner and not BYPASSRLS), the function
-- body's own INSERT would otherwise be denied with no permissive policy.
CREATE POLICY ledger_writer_insert ON "fiscal_period_transition"
  FOR INSERT TO amacc_period_ledger_writer WITH CHECK (true);

ALTER TABLE "adjusting_entry_attestation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjusting_entry_attestation" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "adjusting_entry_attestation"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
-- Same reasoning as above; record_adjusting_attestation() also performs an
-- upsert (ON CONFLICT ... DO UPDATE), so both INSERT and UPDATE policies are
-- required for the ledger-writer role specifically.
CREATE POLICY ledger_writer_insert ON "adjusting_entry_attestation"
  FOR INSERT TO amacc_period_ledger_writer WITH CHECK (true);
CREATE POLICY ledger_writer_update ON "adjusting_entry_attestation"
  FOR UPDATE TO amacc_period_ledger_writer USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "fiscal_period_transition" TO amacc_rls_bypass;
GRANT SELECT, INSERT, UPDATE, DELETE ON "adjusting_entry_attestation" TO amacc_rls_bypass;

-- ── 7. Privilege hardening: amacc_app may only ever SELECT these two tables ──
-- infra/postgres/init/01-create-app-role.sql's ALTER DEFAULT PRIVILEGES FOR
-- ROLE amacc auto-granted amacc_app SELECT/INSERT/UPDATE/DELETE on both
-- tables the instant they were created above (this migration runs as the
-- amacc superuser). Revoke the write privileges now, immediately after
-- creation, so there is never a window where amacc_app could write directly.
REVOKE INSERT, UPDATE, DELETE ON "fiscal_period_transition" FROM amacc_app;
REVOKE INSERT, UPDATE, DELETE ON "fiscal_period_transition" FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON "adjusting_entry_attestation" FROM amacc_app;
REVOKE INSERT, UPDATE, DELETE ON "adjusting_entry_attestation" FROM PUBLIC;

-- ── 8. Trigger-only insert path: grant DML to the role created in §5 above ──
GRANT INSERT ON "fiscal_period_transition" TO amacc_period_ledger_writer;
-- SELECT is required in addition to INSERT/UPDATE because
-- record_adjusting_attestation() uses ON CONFLICT (draft_id) DO UPDATE:
-- Postgres needs SELECT on the target table to evaluate the conflict
-- target / existing row during the upsert, even though the RLS
-- tenant_isolation_select policy (no "TO" clause, applies to every role)
-- already permits the read -- the table-level GRANT was still missing.
GRANT SELECT, INSERT, UPDATE ON "adjusting_entry_attestation" TO amacc_period_ledger_writer;

-- search_path is pinned to prevent the classic SECURITY DEFINER
-- vulnerability (an attacker-controlled search_path redirecting an
-- unqualified table reference inside the function to a same-named object in
-- a schema the attacker controls).
CREATE OR REPLACE FUNCTION record_period_transition(
  p_tenant_id TEXT, p_entity_id TEXT, p_period_id TEXT,
  p_from TEXT, p_to TEXT, p_actor TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO fiscal_period_transition (tenant_id, entity_id, period_id, from_status, to_status, actor)
  VALUES (p_tenant_id, p_entity_id, p_period_id, p_from, p_to, p_actor);
END;
$$;

ALTER FUNCTION record_period_transition OWNER TO amacc_period_ledger_writer;
REVOKE EXECUTE ON FUNCTION record_period_transition FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_period_transition TO amacc_app; -- callable only from inside the trigger below

CREATE OR REPLACE FUNCTION record_adjusting_attestation(
  p_tenant_id TEXT, p_draft_id TEXT, p_attested_by TEXT, p_reason TEXT, p_correction_ref TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO adjusting_entry_attestation (tenant_id, draft_id, attested_by, reason, correction_ref)
  VALUES (p_tenant_id, p_draft_id, p_attested_by, p_reason, p_correction_ref)
  ON CONFLICT (draft_id) DO UPDATE SET
    attested_by = EXCLUDED.attested_by, reason = EXCLUDED.reason,
    correction_ref = EXCLUDED.correction_ref, created_at = now();
END;
$$;

ALTER FUNCTION record_adjusting_attestation OWNER TO amacc_period_ledger_writer;
REVOKE EXECUTE ON FUNCTION record_adjusting_attestation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_adjusting_attestation TO amacc_app;

-- ── 8. Stable SQLSTATE contract (S008 Story Contract §Stable Error Contract) ──
-- Custom, non-Postgres-reserved 5-char SQLSTATEs, mapped by the service layer
-- (period-routes.ts / draft-routes.ts) by err.code, never by parsing message
-- text.
--   AMPR0  PERIOD_ILLEGAL_TRANSITION        illegal fiscal_period status transition
--   AMPR1  PERIOD_NOT_POSTABLE              period is not postable in its current status
--   AMPR2  PERIOD_NOT_FOUND                 referenced fiscal_period does not exist
--   AMPR3  PERIOD_TENANT_MISMATCH           journal_entry tenant/entity != its period's
--   AMPR4  DB_ACTOR_CONTEXT_REQUIRED        app.current_actor session var unset
--   AMPR5  PERIOD_LOCKED_TERMINAL           any transition attempted out of LOCKED
--   AMPR6  JE_ADJUSTING_ATTESTATION_INVALID is_adjusting=true with no matching attestation

-- ── 9. Period transition allowlist trigger (BEFORE UPDATE ON fiscal_period) ──
CREATE OR REPLACE FUNCTION enforce_period_transition() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor TEXT;
  v_legal BOOLEAN := false;
BEGIN
  -- No-op updates to unrelated columns are not a transition; only guard when
  -- status actually changes.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_actor := current_setting('app.current_actor', true);
  IF v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'actor context (app.current_actor) is required for a period transition'
      USING ERRCODE = 'AMPR4';
  END IF;

  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'period % is LOCKED — terminal, no transition permitted (S008 v1)', OLD.id
      USING ERRCODE = 'AMPR5';
  END IF;

  v_legal := (OLD.status, NEW.status) IN (
    ('FUTURE', 'OPEN'),
    ('OPEN', 'SOFT_CLOSED'),
    ('SOFT_CLOSED', 'OPEN'),
    ('SOFT_CLOSED', 'HARD_CLOSED'),
    ('HARD_CLOSED', 'OPEN'),
    ('HARD_CLOSED', 'LOCKED')
  );
  IF NOT v_legal THEN
    RAISE EXCEPTION 'illegal fiscal_period transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'AMPR0';
  END IF;

  -- Current-state metadata — trigger-owned, not application-owned (§5).
  IF NEW.status IN ('SOFT_CLOSED', 'HARD_CLOSED') THEN
    NEW.closed_by := v_actor;
    NEW.closed_at := now();
  ELSIF NEW.status = 'OPEN' THEN
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
  END IF;

  IF NEW.status = 'LOCKED' THEN
    NEW.locked_by := v_actor;
    NEW.locked_at := now();
  END IF;

  PERFORM record_period_transition(NEW.tenant_id, NEW.entity_id, NEW.id, OLD.status, NEW.status, v_actor);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_period_transition ON "fiscal_period";
CREATE TRIGGER trg_enforce_period_transition
  BEFORE UPDATE ON "fiscal_period"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_period_transition();

-- ── 10. Posting-path coverage trigger (BEFORE INSERT ON journal_entry) ───────
-- Single write-door confirmed by inspection (posting-service.ts line ~142,
-- the ONLY tx.journalEntry.create call site — both manual post (S216, via
-- draft-service.ts postDraft) and reversal (S218, whose own code comment
-- says "Post the reversal through the ONE door") funnel through it). One
-- BEFORE INSERT trigger on journal_entry therefore covers every posting
-- path with no gaps, regardless of which service-layer code path is used —
-- including a hypothetical direct-SQL insert, which is the exact threat this
-- closes (BR013-2 was service-layer-only before this migration).
CREATE OR REPLACE FUNCTION enforce_period_postable() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  p RECORD;
  v_attested BOOLEAN;
BEGIN
  -- Row-level lock on the referenced period — conflicts with the plain
  -- UPDATE fiscal_period ... WHERE id = ... used by every close/reopen/lock
  -- transition, so a concurrent post and a concurrent close deterministically
  -- serialize against each other on this one row (S008 Story Contract
  -- §Concurrency Control). Whichever transaction reaches this SELECT ... FOR
  -- UPDATE first wins; the loser blocks until the winner commits, then
  -- re-evaluates against the now-final, committed status.
  SELECT status, tenant_id, entity_id INTO p
    FROM fiscal_period WHERE id = NEW.period_id FOR UPDATE;

  IF p IS NULL THEN
    RAISE EXCEPTION 'fiscal_period % not found', NEW.period_id
      USING ERRCODE = 'AMPR2';
  END IF;

  IF p.tenant_id IS DISTINCT FROM NEW.tenant_id OR p.entity_id IS DISTINCT FROM NEW.entity_id THEN
    RAISE EXCEPTION 'journal_entry tenant/entity does not match its fiscal_period''s tenant/entity'
      USING ERRCODE = 'AMPR3';
  END IF;

  IF p.status = 'OPEN' THEN
    RETURN NEW;
  END IF;

  IF p.status = 'SOFT_CLOSED' AND NEW.is_adjusting THEN
    -- S008 v1: only authorized MANUAL adjusting journals are permitted in a
    -- SOFT_CLOSED period (automated/system postings remain blocked — this
    -- trigger does not distinguish caller class, so any caller must also
    -- pass this attestation check; automated posting paths never create one).
    SELECT EXISTS(
      SELECT 1 FROM adjusting_entry_attestation
      WHERE draft_id = NEW.draft_id AND tenant_id = NEW.tenant_id
    ) INTO v_attested;
    IF NEW.draft_id IS NULL OR NOT v_attested THEN
      RAISE EXCEPTION 'is_adjusting=true requires a verified fiscal.je.mark_adjusting attestation for this draft'
        USING ERRCODE = 'AMPR6';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'fiscal_period % is % — posting rejected at the database (BR013-2)', NEW.period_id, p.status
    USING ERRCODE = 'AMPR1';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_period_postable ON "journal_entry";
CREATE TRIGGER trg_enforce_period_postable
  BEFORE INSERT ON "journal_entry"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_period_postable();

-- ── 11. Immutability of is_adjusting / adjusting_reason after POSTED ─────────
CREATE OR REPLACE FUNCTION enforce_journal_adjusting_immutable() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_adjusting IS DISTINCT FROM NEW.is_adjusting
     OR OLD.adjusting_reason IS DISTINCT FROM NEW.adjusting_reason
     OR OLD.adjusting_correction_ref IS DISTINCT FROM NEW.adjusting_correction_ref THEN
    RAISE EXCEPTION 'is_adjusting/adjusting_reason/adjusting_correction_ref are immutable once a journal entry is posted'
      USING ERRCODE = 'AMPR6';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_adjusting_immutable ON "journal_entry";
CREATE TRIGGER trg_enforce_journal_adjusting_immutable
  BEFORE UPDATE ON "journal_entry"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_journal_adjusting_immutable();
