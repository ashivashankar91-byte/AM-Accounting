-- Sprint 6: Purchase Orders, PO Lines, and IRS 8300 cash tracking
-- S6-01/02/03: Purchase Orders state machine (Cancel vs Void)
-- S6-10: IRS Form 8300 — cash_100_bill_count on ar_entries

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           TEXT          NOT NULL,
  po_number           VARCHAR(20),
  po_type             TEXT          NOT NULL DEFAULT 'GENERAL'  CHECK (po_type IN ('GENERAL','SUBLET','VEHICLE')),
  vendor_id           TEXT,
  vendor_name         TEXT,
  department          TEXT,
  requested_by        TEXT,
  ship_to             TEXT,
  po_date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  required_date       DATE,
  notes               TEXT,
  status              TEXT          NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED','VOIDED')),
  approval_level      INTEGER       NOT NULL DEFAULT 0,
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  line_total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  freight             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax                 NUMERIC(15,2) NOT NULL DEFAULT 0,
  total               NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- S6-02: Sublet PO link to Repair Order
  ro_number           VARCHAR(20),
  -- S6-01: Void metadata (PO# consumed; not reusable)
  voided_at           TIMESTAMPTZ,
  void_reason         TEXT,
  voided_by           TEXT,
  -- S6-01: Cancel metadata (DRAFT only; no PO# assigned yet)
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS po_lines (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id               UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number         INTEGER       NOT NULL,
  description         TEXT          NOT NULL,
  qty                 NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cost           NUMERIC(15,2) NOT NULL DEFAULT 0,
  ext_cost            NUMERIC(15,2) NOT NULL DEFAULT 0,
  gl_account_id       TEXT,
  control_number      TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_tenant         ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_tenant_status  ON purchase_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_po_tenant_number  ON purchase_orders(tenant_id, po_number);

-- S6-10: IRS Form 8300 — number of $100 bills received (required when cash >= $10,000)
ALTER TABLE ar_entries
  ADD COLUMN IF NOT EXISTS cash_100_bill_count INTEGER DEFAULT 0;
