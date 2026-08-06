-- CE-09 S051: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the NSF "matrix row" GL accounts, a test NSF fee
-- amount, and a modest auto-hold threshold for the dedicated
-- certification tenant 'tenant-ce09-cert' so the full recordNsf flow
-- (reversal, fee-item creation, customer auto-hold) can be exercised
-- end-to-end in certification without any tenant supplying real account
-- numbers. Placeholder UUIDs are NOT real gl-service GL account ids —
-- same value-only-reference convention as ap_use_tax_gl_account_configs /
-- ar_write_off_gl_account_configs; a real tenant must configure its own.
INSERT INTO ar_nsf_gl_account_configs (tenant_id, ar_control_gl_account_id, cash_gl_account_id, nsf_fee_income_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '33333333-3333-4333-8333-333333333401', '33333333-3333-4333-8333-333333333402', '33333333-3333-4333-8333-333333333403', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

-- SAFE_CONFIGURATION: a modest test fee so the optional NSF-fee-item path
-- is exercisable in certification.
INSERT INTO ar_nsf_fee_configs (tenant_id, fee_amount, updated_at)
VALUES
  ('tenant-ce09-cert', 35.00, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

-- SAFE_CONFIGURATION: a low test threshold (2) so the auto-hold-after-N
-- path is exercisable in certification without requiring many NSF events.
INSERT INTO ar_nsf_hold_configs (tenant_id, hold_after_count, updated_at)
VALUES
  ('tenant-ce09-cert', 2, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;
