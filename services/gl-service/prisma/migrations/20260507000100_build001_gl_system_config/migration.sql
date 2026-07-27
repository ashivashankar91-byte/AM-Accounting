CREATE TABLE gl_system_config (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL UNIQUE,
  company_name TEXT,
  accounting_type CHAR(1) DEFAULT ' ',
  fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  last_close_date DATE,
  cutoff_date DATE,
  transaction_hold_months SMALLINT DEFAULT 2,
  enforce_transaction_edits BOOLEAN DEFAULT false,
  decimal_entry_mode CHAR(1) DEFAULT ' ',
  default_print_code CHAR(1) DEFAULT 'D',
  max_future_posting_months SMALLINT DEFAULT 2,
  lifo_method CHAR(1) DEFAULT '0'
    CHECK (lifo_method IN ('0', '1', '2')),
  cash_receipts_gl_accounts TEXT[] DEFAULT '{}',
  ncm20_enabled BOOLEAN DEFAULT false,
  default_area_code VARCHAR(3) DEFAULT '',
  suppress_zero_ytd_trial BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gl_system_config_tenant ON gl_system_config(tenant_id);
