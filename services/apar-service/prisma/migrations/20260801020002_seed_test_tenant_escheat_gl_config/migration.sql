-- CE-09 S045: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the escheat transfer "matrix row" GL accounts and a
-- jurisdiction timing config for the dedicated certification tenant
-- 'tenant-ce09-cert'. Placeholder UUIDs — see
-- 20260801010002_seed_test_tenant_use_tax_gl_config for the by-value
-- reference rationale (no cross-service DB join/FK).
INSERT INTO ap_escheat_gl_account_configs (tenant_id, outstanding_checks_gl_account_id, escheat_payable_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '11111111-1111-4111-8111-111111111201', '11111111-1111-4111-8111-111111111202', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO ap_escheat_jurisdiction_configs (id, tenant_id, jurisdiction, stale_days, updated_at)
VALUES
  (gen_random_uuid(), 'tenant-ce09-cert', 'TEST-JURISDICTION-01', 1095, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, jurisdiction) DO NOTHING;
