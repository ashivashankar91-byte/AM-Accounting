-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Sprint 2 — S2-06/07/08 AP Entry & AP Payments
-- ─────────────────────────────────────────────────────────────────────────────

-- S2-06: Status check constraint
-- Valid values: OPEN | PARTIAL | PAID | VOID (plus legacy approval states)
ALTER TABLE ap_entries
  DROP CONSTRAINT IF EXISTS ap_entries_status_check;

ALTER TABLE ap_entries
  ADD CONSTRAINT ap_entries_status_check
  CHECK (status IN ('OPEN','PARTIAL','PAID','VOID','Pending','Approved','Rejected','Hold'));

-- S2-07: Missing AP invoice fields
ALTER TABLE ap_entries
  ADD COLUMN IF NOT EXISTS check_number  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS check_date    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_number     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hold_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS note          TEXT;

-- S2-08: AP payments table for bank reconciliation cleared tracking
CREATE TABLE IF NOT EXISTS ap_payments (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      VARCHAR(50) NOT NULL,
  ap_entry_id    UUID        NOT NULL,
  payment_date   TIMESTAMPTZ NOT NULL,
  amount         NUMERIC(15,2) NOT NULL,
  check_number   VARCHAR(20),
  cleared_flag   BOOLEAN     NOT NULL DEFAULT FALSE,
  cleared_date   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ap_payments_tenant_idx
  ON ap_payments (tenant_id);

CREATE INDEX IF NOT EXISTS ap_payments_tenant_cleared_idx
  ON ap_payments (tenant_id, cleared_flag);

CREATE INDEX IF NOT EXISTS ap_payments_entry_idx
  ON ap_payments (ap_entry_id);
