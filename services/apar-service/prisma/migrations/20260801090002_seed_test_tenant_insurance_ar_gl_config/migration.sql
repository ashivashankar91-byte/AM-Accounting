-- CE-09 S049: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the AR-insurer-control/revenue/AR-customer-control/
-- write-off-expense "matrix row" GL accounts for the dedicated
-- certification tenant 'tenant-ce09-cert' so the S049 insurance-AR flow
-- can be exercised end-to-end in certification without any tenant
-- supplying real account numbers. The placeholder UUIDs below are NOT
-- real gl-service GL account ids — apar-service stores GL account
-- references by value only (no cross-service DB join/FK) — a real tenant
-- must configure its own values via the ar_insurance_gl_account_configs
-- table; engineering never fills in a real tenant's blank matrix row.
INSERT INTO ar_insurance_gl_account_configs (tenant_id, ar_insurer_control_gl_account_id, revenue_gl_account_id, ar_customer_control_gl_account_id, write_off_expense_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '11111111-1111-4111-8111-111111111401', '11111111-1111-4111-8111-111111111402', '11111111-1111-4111-8111-111111111403', '11111111-1111-4111-8111-111111111404', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;
