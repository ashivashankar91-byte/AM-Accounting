-- Sprint 7: vehicle_transfers + oem_statement_mappings tables
-- S7-01: Vehicle Transfer IC GL entries
-- S7-02: OEM Financial Statement line-position mapping

CREATE TABLE IF NOT EXISTS vehicle_transfers (
  id                           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id                    TEXT NOT NULL,
  from_company_code            VARCHAR(2) NOT NULL,
  to_company_code              VARCHAR(2) NOT NULL,
  vin                          VARCHAR(17) NOT NULL,
  stock_number                 VARCHAR(20),
  vehicle_year                 SMALLINT,
  vehicle_make                 VARCHAR(30),
  vehicle_model                VARCHAR(30),
  total_cost                   NUMERIC(15,2) NOT NULL,
  transfer_date                DATE NOT NULL,
  from_inventory_gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  to_inventory_gl_account_id   TEXT NOT NULL REFERENCES gl_accounts(id),
  from_ic_offset_gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  to_ic_offset_gl_account_id   TEXT NOT NULL REFERENCES gl_accounts(id),
  status                       VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','REVERSED')),
  from_journal_entry_id        TEXT,
  to_journal_entry_id          TEXT,
  initiated_by                 TEXT,
  created_at                   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_transfers_tenant ON vehicle_transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_transfers_vin    ON vehicle_transfers(tenant_id, vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_transfers_status ON vehicle_transfers(tenant_id, status);

-- S7-02: OEM Financial Statement Mappings
CREATE TABLE IF NOT EXISTS oem_statement_mappings (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT NOT NULL,
  oem_code              VARCHAR(10) NOT NULL,
  statement_year        INTEGER NOT NULL,
  line_number           VARCHAR(10) NOT NULL,
  line_description      TEXT NOT NULL,
  gl_account_id         TEXT REFERENCES gl_accounts(id),
  gl_account_range_start VARCHAR(12),
  gl_account_range_end   VARCHAR(12),
  line_type             VARCHAR(20) CHECK (line_type IN ('DETAIL','SUBTOTAL','TOTAL','HEADER','BLANK')),
  sign_convention       VARCHAR(10) DEFAULT 'NORMAL' CHECK (sign_convention IN ('NORMAL','REVERSED')),
  sort_order            INTEGER DEFAULT 0,
  UNIQUE (tenant_id, oem_code, statement_year, line_number)
);

CREATE INDEX IF NOT EXISTS idx_oem_mappings_tenant ON oem_statement_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oem_mappings_key    ON oem_statement_mappings(tenant_id, oem_code, statement_year);
