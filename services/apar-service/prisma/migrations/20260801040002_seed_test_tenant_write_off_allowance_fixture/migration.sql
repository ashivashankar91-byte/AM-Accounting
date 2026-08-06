-- CE-09 S050: TEST-TENANT certification fixture ONLY — never a production
-- default. Configures the write-off/allowance "matrix row" GL accounts,
-- the write-off threshold, and one allowance aging band for the dedicated
-- certification tenant 'tenant-ce09-cert' so both the direct write-off
-- (including the over-threshold refusal) and the allowance preview/approve/
-- post flow can be exercised end-to-end in certification without any
-- tenant supplying real account numbers. The placeholder UUIDs below are
-- NOT real gl-service GL account ids — apar-service stores GL account
-- references by value only (no cross-service DB join/FK, same convention
-- as ap_bank_accounts.gl_account_id / ap_use_tax_gl_account_configs) — a
-- real tenant must configure its own values; engineering never fills in a
-- real tenant's blank matrix row.
INSERT INTO ar_write_off_gl_account_configs (tenant_id, write_off_expense_gl_account_id, ar_control_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO ar_allowance_gl_account_configs (tenant_id, bad_debt_expense_gl_account_id, allowance_contra_gl_account_id, updated_at)
VALUES
  ('tenant-ce09-cert', '33333333-3333-4333-8333-333333333303', '33333333-3333-4333-8333-333333333304', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

-- SAFE_CONFIGURATION: a modest test threshold so the over-threshold
-- refusal path (WRITE_OFF_REFUSED_OVER_THRESHOLD) is exercisable in
-- certification.
INSERT INTO ar_write_off_threshold_configs (tenant_id, threshold_amount, updated_at)
VALUES
  ('tenant-ce09-cert', 5000.00, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id) DO NOTHING;

-- SAFE_CONFIGURATION: a single open-ended aging band (90+ days => 100%)
-- so the allowance preview computation has at least one band to exercise.
INSERT INTO ar_allowance_band_configs (id, tenant_id, band_days_min, band_days_max, percent, updated_at)
SELECT gen_random_uuid(), 'tenant-ce09-cert', 90, NULL, 100.00, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM ar_allowance_band_configs WHERE tenant_id = 'tenant-ce09-cert' AND band_days_min = 90
);
