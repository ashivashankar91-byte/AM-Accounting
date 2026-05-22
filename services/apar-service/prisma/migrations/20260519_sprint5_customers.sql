-- Sprint 5 — Customer Master
-- S5-01: customers table

CREATE TABLE IF NOT EXISTS customers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 TEXT NOT NULL,
  customer_number           VARCHAR(20) NOT NULL,
  customer_name             TEXT NOT NULL,
  customer_type             VARCHAR(20) DEFAULT 'Individual',
  salesperson_code          VARCHAR(10),
  ar_account_override       UUID,
  company_number            VARCHAR(4),
  tax_id                    TEXT,
  tax_exempt_status         BOOLEAN DEFAULT false,
  tax_exempt_cert_number    TEXT,
  tax_exempt_expiration     TIMESTAMPTZ,
  credit_limit              NUMERIC(15,2) DEFAULT 0,
  credit_terms              TEXT DEFAULT 'Net30',
  customer_since            TIMESTAMPTZ DEFAULT NOW(),
  preferred_contact_method  TEXT DEFAULT 'Phone',
  do_not_solicit            BOOLEAN DEFAULT false,
  do_not_mail               BOOLEAN DEFAULT false,
  address1                  TEXT,
  address2                  TEXT,
  city                      TEXT,
  state                     VARCHAR(2),
  zip                       VARCHAR(10),
  country                   TEXT DEFAULT 'US',
  phone                     TEXT,
  phone2                    TEXT,
  fax                       TEXT,
  email                     TEXT,
  secondary_street          TEXT,
  secondary_city            TEXT,
  secondary_state           VARCHAR(2),
  secondary_zip             VARCHAR(10),
  secondary_country         TEXT,
  address_label             TEXT,
  flag_ar                   BOOLEAN DEFAULT false,
  flag_vehicle              BOOLEAN DEFAULT false,
  flag_parts                BOOLEAN DEFAULT false,
  flag_service              BOOLEAN DEFAULT false,
  flag_fi                   BOOLEAN DEFAULT false,
  employee_flag             BOOLEAN DEFAULT false,
  notes                     JSONB,
  is_active                 BOOLEAN DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, customer_number)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant    ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_active    ON customers(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_name      ON customers(tenant_id, customer_name);
