-- CE-09 S042: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the use-tax expense/payable "matrix row" GL accounts
-- for the dedicated certification tenant 'tenant-ce09-cert' so the S042
-- assessment flow can be exercised end-to-end in certification without any
-- tenant supplying real account numbers. The placeholder UUIDs below are
-- NOT real gl-service GL account ids — apar-service stores GL account
-- references by value only (no cross-service DB join/FK, same convention
-- as ap_bank_accounts.gl_account_id) — a real tenant must configure its
-- own values via the ap_use_tax_gl_account_configs table; engineering never
-- fills in a real tenant's blank matrix row.
INSERT INTO ap_use_tax_gl_account_configs (tenant_id, use_tax_expense_gl_account_id, use_tax_payable_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO ap_use_tax_rate_configs (id, tenant_id, jurisdiction, rate, updated_at)
VALUES
  (gen_random_uuid(), 'tenant-ce09-cert', 'TEST-JURISDICTION-01', 0.070000, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, jurisdiction) DO NOTHING;
