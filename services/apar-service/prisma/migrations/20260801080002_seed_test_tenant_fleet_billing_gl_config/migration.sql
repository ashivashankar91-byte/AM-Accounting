-- CE-09 S047: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the AR-control and revenue "matrix row" GL accounts
-- for the dedicated certification tenant 'tenant-ce09-cert' so the S047
-- consolidated-billing flow can be exercised end-to-end in certification
-- without any tenant supplying real account numbers. The placeholder UUIDs
-- below are NOT real gl-service GL account ids — apar-service stores GL
-- account references by value only (no cross-service DB join/FK) — a real
-- tenant must configure its own values via the
-- ar_fleet_billing_gl_account_configs table; engineering never fills in a
-- real tenant's blank matrix row.
INSERT INTO ar_fleet_billing_gl_account_configs (tenant_id, ar_control_gl_account_id, revenue_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '11111111-1111-4111-8111-111111111301', '11111111-1111-4111-8111-111111111302', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;
