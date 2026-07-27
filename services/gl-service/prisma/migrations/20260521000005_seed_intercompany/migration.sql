-- Seed intercompany demo data: second rooftop + vehicle transfer
-- Run: Get-Content seed_intercompany.sql | docker exec -i amacc-postgres-1 psql -U amacc -d amacc

-- 1. Create minimal CoA for second rooftop (tenant-kunes-ford)
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes-ford', '1200', 'New Vehicle Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes-ford', '1120', 'Finance Receivables', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes-ford', '2010', 'Accounts Payable - Trade', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes-ford', '4000', 'New Vehicle Sales', 'REVENUE', NULL, 'CREDIT', true, 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes-ford', '5000', 'Cost of New Vehicles Sold', 'COST_OF_SALES', NULL, 'DEBIT', true, 'NEW', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 2. Create dealer group
INSERT INTO dealer_groups (id, name) VALUES ('group-kunes-auto', 'Kunes Auto Group')
ON CONFLICT DO NOTHING;

INSERT INTO dealer_group_tenants (id, dealer_group_id, tenant_id, rooftop_name)
VALUES
  (gen_random_uuid(), 'group-kunes-auto', 'tenant-kunes', 'Kunes Chevy Delavan'),
  (gen_random_uuid(), 'group-kunes-auto', 'tenant-kunes-ford', 'Kunes Ford Sterling')
ON CONFLICT (dealer_group_id, tenant_id) DO NOTHING;

-- 3. Mock IC vehicle transfer: Chevy transfers a used vehicle to Ford rooftop at $18,500
INSERT INTO intercompany_entries (id, tenant_id, counterparty_tenant_id, entry_type, amount, description, status)
VALUES (
  'ic-demo-001',
  'tenant-kunes',
  'tenant-kunes-ford',
  'VEHICLE_TRANSFER',
  18500.00,
  'Used 2022 F-150 transferred from Chevy Delavan to Ford Sterling - Stock# U2234',
  'PENDING'
);
