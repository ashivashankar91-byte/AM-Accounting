-- Automotive Dealership Standard Chart of Accounts (GAAP-compliant)
-- Based on NADA/OEM standard structure for multi-rooftop dealers
-- Run: Get-Content seed_automotive_coa.sql | docker exec -i amacc-postgres-1 psql -U amacc -d amacc

-- ══════════════════════════════════════════════════════
-- ASSETS (Normal Balance: DEBIT)
-- ══════════════════════════════════════════════════════

-- Header: Total Assets
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES (gen_random_uuid(), 'tenant-kunes', '1000', 'Total Assets', 'ASSET', NULL, 'DEBIT', false, NULL, NULL, true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Cash & Equivalents
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '1010', 'Cash - Operating Account', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-1', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1020', 'Cash - Payroll Account', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-1', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1030', 'Petty Cash', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-1', 'ADMIN', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Receivables
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '1100', 'Accounts Receivable - Trade', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-2', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1110', 'Accounts Receivable - Warranty', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-2', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '1120', 'Finance Receivables', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-2', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1130', 'Contracts in Transit', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-2', 'NEW', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Inventory
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '1200', 'New Vehicle Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '1210', 'Used Vehicle Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '1220', 'Demo Vehicle Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '1230', 'Parts Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'PARTS', true),
  (gen_random_uuid(), 'tenant-kunes', '1240', 'Work In Process', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '1250', 'Sublet Inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 'BS-3', 'SERVICE', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Fixed Assets
INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '1500', 'Land', 'ASSET', 'FIXED_ASSET', 'DEBIT', true, 'BS-5', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1510', 'Buildings', 'ASSET', 'FIXED_ASSET', 'DEBIT', true, 'BS-5', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1520', 'Furniture & Equipment', 'ASSET', 'FIXED_ASSET', 'DEBIT', true, 'BS-5', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1530', 'Service Equipment & Tools', 'ASSET', 'FIXED_ASSET', 'DEBIT', true, 'BS-5', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '1540', 'Company Vehicles', 'ASSET', 'FIXED_ASSET', 'DEBIT', true, 'BS-5', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '1590', 'Accumulated Depreciation', 'ASSET', 'FIXED_ASSET', 'CREDIT', true, 'BS-5', 'ADMIN', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- LIABILITIES (Normal Balance: CREDIT)
-- ══════════════════════════════════════════════════════

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES (gen_random_uuid(), 'tenant-kunes', '2000', 'Total Liabilities', 'LIABILITY', NULL, 'CREDIT', false, NULL, NULL, true)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '2010', 'Accounts Payable - Trade', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-10', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '2020', 'Accrued Payroll', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-10', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '2030', 'Sales Tax Payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-10', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '2040', 'Customer Deposits', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-10', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '2050', 'Warranty Reserve', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-10', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '2100', 'Floorplan Notes Payable - New', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-11', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '2110', 'Floorplan Notes Payable - Used', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, 'BS-11', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '2500', 'Long-Term Debt', 'LIABILITY', 'LONG_TERM_LIABILITY', 'CREDIT', true, 'BS-12', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '2510', 'Mortgage Payable', 'LIABILITY', 'LONG_TERM_LIABILITY', 'CREDIT', true, 'BS-12', 'ADMIN', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- EQUITY (Normal Balance: CREDIT)
-- ══════════════════════════════════════════════════════

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '3000', 'Owner''s Equity / Capital', 'EQUITY', NULL, 'CREDIT', true, 'BS-15', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '3100', 'Retained Earnings', 'EQUITY', NULL, 'CREDIT', true, 'BS-15', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '3200', 'Current Year Earnings', 'EQUITY', NULL, 'CREDIT', true, 'BS-15', 'ADMIN', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- REVENUE (Normal Balance: CREDIT)
-- ══════════════════════════════════════════════════════

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '4000', 'New Vehicle Sales', 'REVENUE', NULL, 'CREDIT', true, 'PL-1', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '4010', 'Used Vehicle Sales', 'REVENUE', NULL, 'CREDIT', true, 'PL-1', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '4020', 'F&I Product Revenue', 'REVENUE', NULL, 'CREDIT', true, 'PL-2', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '4100', 'Service Labor Revenue', 'REVENUE', NULL, 'CREDIT', true, 'PL-3', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '4110', 'Warranty Labor Revenue', 'REVENUE', NULL, 'CREDIT', true, 'PL-3', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '4120', 'Internal Labor Revenue', 'REVENUE', NULL, 'CREDIT', true, 'PL-3', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '4200', 'Parts Sales - Counter', 'REVENUE', NULL, 'CREDIT', true, 'PL-4', 'PARTS', true),
  (gen_random_uuid(), 'tenant-kunes', '4210', 'Parts Sales - Wholesale', 'REVENUE', NULL, 'CREDIT', true, 'PL-4', 'PARTS', true),
  (gen_random_uuid(), 'tenant-kunes', '4300', 'Body Shop Revenue', 'REVENUE', NULL, 'CREDIT', true, 'PL-5', 'BODY', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- COST OF SALES (Normal Balance: DEBIT)
-- ══════════════════════════════════════════════════════

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '5000', 'Cost of New Vehicles Sold', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-6', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '5010', 'Cost of Used Vehicles Sold', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-6', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '5100', 'Cost of Service Labor', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-7', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '5110', 'Technician Pay - Flat Rate', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-7', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '5200', 'Cost of Parts Sold', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-8', 'PARTS', true),
  (gen_random_uuid(), 'tenant-kunes', '5300', 'Cost of Body Shop', 'COST_OF_SALES', NULL, 'DEBIT', true, 'PL-9', 'BODY', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- EXPENSES (Normal Balance: DEBIT)
-- ══════════════════════════════════════════════════════

INSERT INTO gl_accounts (id, tenant_id, code, name, type, sub_type, normal_balance, allow_posting, schedule_code, gl_group, is_active)
VALUES
  (gen_random_uuid(), 'tenant-kunes', '6000', 'Salaries - Management', 'EXPENSE', NULL, 'DEBIT', true, 'PL-10', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6010', 'Salaries - Sales', 'EXPENSE', NULL, 'DEBIT', true, 'PL-10', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '6020', 'Salaries - Service', 'EXPENSE', NULL, 'DEBIT', true, 'PL-10', 'SERVICE', true),
  (gen_random_uuid(), 'tenant-kunes', '6030', 'Salaries - Administrative', 'EXPENSE', NULL, 'DEBIT', true, 'PL-10', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6100', 'Employee Benefits', 'EXPENSE', NULL, 'DEBIT', true, 'PL-11', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6200', 'Rent Expense', 'EXPENSE', NULL, 'DEBIT', true, 'PL-12', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6210', 'Utilities', 'EXPENSE', NULL, 'DEBIT', true, 'PL-12', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6220', 'Insurance', 'EXPENSE', NULL, 'DEBIT', true, 'PL-12', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6300', 'Advertising - New', 'EXPENSE', NULL, 'DEBIT', true, 'PL-13', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '6310', 'Advertising - Used', 'EXPENSE', NULL, 'DEBIT', true, 'PL-13', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '6400', 'Floorplan Interest - New', 'EXPENSE', NULL, 'DEBIT', true, 'PL-14', 'NEW', true),
  (gen_random_uuid(), 'tenant-kunes', '6410', 'Floorplan Interest - Used', 'EXPENSE', NULL, 'DEBIT', true, 'PL-14', 'USED', true),
  (gen_random_uuid(), 'tenant-kunes', '6500', 'Depreciation Expense', 'EXPENSE', NULL, 'DEBIT', true, 'PL-15', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6600', 'Professional Fees', 'EXPENSE', NULL, 'DEBIT', true, 'PL-16', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6700', 'Office Supplies', 'EXPENSE', NULL, 'DEBIT', true, 'PL-16', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6800', 'Technology / IT Expense', 'EXPENSE', NULL, 'DEBIT', true, 'PL-16', 'ADMIN', true),
  (gen_random_uuid(), 'tenant-kunes', '6900', 'Miscellaneous Expense', 'EXPENSE', NULL, 'DEBIT', true, 'PL-16', 'ADMIN', true)
ON CONFLICT (tenant_id, code) DO NOTHING;
