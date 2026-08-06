-- Demo bootstrap: one AP bank account for tenant-kunes, linked to the
-- Cash - Operating Account (gl_accounts.code = '1010') so AP payment runs
-- have a real GL account to post cash relief against.
-- id is a DB-generated uuid (default gen_random_uuid()) — omitted here,
-- matching the convention used for the vendors/customers seed migration.
INSERT INTO ap_bank_accounts (tenant_id, bank_name, account_number, routing_number, next_check_number, is_active, gl_account_id)
VALUES
  ('tenant-kunes', 'First National Bank of Rock County', '000123456789', '075901032', 1001, true, '783ce413-6441-4dd3-82c1-76a55badb9b5')
ON CONFLICT (tenant_id, account_number) DO NOTHING;
