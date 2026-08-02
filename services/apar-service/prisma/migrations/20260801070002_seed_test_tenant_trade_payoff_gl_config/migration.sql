-- CE-09 S044: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the payoff-clearing "matrix row" GL account for the
-- dedicated certification tenant 'tenant-ce09-cert' so the S044 fast-lane
-- flow can be exercised end-to-end in certification without any tenant
-- supplying real account numbers. The placeholder UUID below is NOT a real
-- gl-service GL account id — apar-service stores GL account references by
-- value only (no cross-service DB join/FK, same convention as
-- ap_bank_accounts.gl_account_id) — a real tenant must configure its own
-- value via the ap_trade_payoff_gl_account_configs table; engineering
-- never fills in a real tenant's blank matrix row.
INSERT INTO ap_trade_payoff_gl_account_configs (tenant_id, payoff_clearing_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '11111111-1111-4111-8111-111111111201', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;
