-- S052 — DB-level backstops for controls the application layer already
-- enforces (defense in depth, same posture as coa-service's je_check_balanced
-- deferred trigger). Additive only.

-- ── one active (non-RECONCILED) drawer per cashier/location and per terminal ──
-- App-level pre-check in DrawerService.open() is the fast path; these partial
-- unique indexes are the real backstop against a concurrent-open race, since
-- Prisma's DSL cannot express a WHERE-qualified unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_drawer_active_cashier_location_uq"
  ON "cash_drawer" ("tenant_id", "cashier_id", "store_id")
  WHERE "status" <> 'RECONCILED';

CREATE UNIQUE INDEX IF NOT EXISTS "cash_drawer_active_terminal_uq"
  ON "cash_drawer" ("tenant_id", "terminal_code")
  WHERE "status" <> 'RECONCILED';

-- ── cash_drawer_movement is append-only ──────────────────────────────────────
-- BR: expected cash/checks are always derived from this table; nothing may
-- ever UPDATE or DELETE a movement row, including a superuser-level app bug —
-- only a compensating INSERT (void reversal) may correct a prior movement.
CREATE OR REPLACE FUNCTION cash_drawer_movement_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'cash_drawer_movement is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_drawer_movement_append_only ON "cash_drawer_movement";
CREATE TRIGGER trg_cash_drawer_movement_append_only
  BEFORE UPDATE OR DELETE ON "cash_drawer_movement"
  FOR EACH ROW EXECUTE FUNCTION cash_drawer_movement_append_only();

-- ── issued cash_receipt financial fields are immutable ───────────────────────
-- BR: issued receipt amounts, tenders and source references cannot be
-- silently edited. The ONLY legitimate UPDATE path is the void transition
-- (status ISSUED -> VOIDED plus voided_at/void_reason/voided_by/version) —
-- every financial/source/identity column must stay byte-identical.
CREATE OR REPLACE FUNCTION cash_receipt_financials_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.total_amount        IS DISTINCT FROM NEW.total_amount
     OR OLD.currency         IS DISTINCT FROM NEW.currency
     OR OLD.amount_due       IS DISTINCT FROM NEW.amount_due
     OR OLD.source_doc_type  IS DISTINCT FROM NEW.source_doc_type
     OR OLD.source_doc_id    IS DISTINCT FROM NEW.source_doc_id
     OR OLD.receipt_number   IS DISTINCT FROM NEW.receipt_number
     OR OLD.drawer_id        IS DISTINCT FROM NEW.drawer_id
     OR OLD.cashier_id       IS DISTINCT FROM NEW.cashier_id
     OR OLD.entity_id        IS DISTINCT FROM NEW.entity_id
     OR OLD.store_id         IS DISTINCT FROM NEW.store_id
     OR OLD.issued_at        IS DISTINCT FROM NEW.issued_at
     OR OLD.idempotency_key  IS DISTINCT FROM NEW.idempotency_key
  THEN
    RAISE EXCEPTION 'cash_receipt % financial/source fields are immutable after issue', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_receipt_financials_immutable ON "cash_receipt";
CREATE TRIGGER trg_cash_receipt_financials_immutable
  BEFORE UPDATE ON "cash_receipt"
  FOR EACH ROW EXECUTE FUNCTION cash_receipt_financials_immutable();

SELECT '---APPLIED---' AS status;
