-- ═══════════════════════════════════════════════════════════════
-- AMACC Demo Seed — 4 journal entries for tenant-kunes
-- Run: docker exec amacc-postgres-1 psql -U amacc -d amacc -f /tmp/seed-demo.sql
-- ═══════════════════════════════════════════════════════════════

-- Entry 1: Service RO — James Kowalski 2024 Hyundai Tucson (POSTED)
INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, source_ref, status, posted_by, posted_at, agent_reviewed, created_at, prior_period_adjustment)
VALUES (
  'demo-je-001', 'tenant-kunes', CURRENT_DATE,
  'Service RO — James Kowalski 2024 Hyundai Tucson',
  'SERVICE_RO', 'RO-DEMO-2026-001', 'POSTED', 'GL Agent', NOW(), true, NOW(), false
);
INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo, department_code, ro_number, module_source)
VALUES
  ('demo-jl-001a', 'demo-je-001', 'ef9c6b09-72f6-4e07-a681-f0929006103f', 56478, 0, 'Cash - RO-DEMO-2026-001', 'SERVICE', 'RO-DEMO-2026-001', 'SERVICE_EOD'),
  ('demo-jl-001b', 'demo-je-001', '7b97ff49-895b-497f-b4d1-60c2a59df763', 0, 43750, 'Service Labour Revenue', 'SERVICE', 'RO-DEMO-2026-001', 'SERVICE_EOD'),
  ('demo-jl-001c', 'demo-je-001', 'a906d5c9-e814-4ed6-be82-122643c9720f', 0, 8400, 'Parts Revenue - brake pads, rotor', 'PARTS', 'RO-DEMO-2026-001', 'SERVICE_EOD'),
  ('demo-jl-001d', 'demo-je-001', '3bcf07a0-9f5e-45e8-9c72-61c5fa143acc', 0, 4328, 'Sales Tax Payable', 'SERVICE', 'RO-DEMO-2026-001', 'SERVICE_EOD');

-- Entry 2: Payroll Batch — Bi-Weekly (POSTED)
INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, source_ref, status, posted_by, posted_at, agent_reviewed, created_at, prior_period_adjustment)
VALUES (
  'demo-je-002', 'tenant-kunes', CURRENT_DATE - INTERVAL '1 day',
  'Bi-Weekly Payroll — Mar 16-31 2026',
  'PAYROLL', 'PAY-2026-03-DEMO', 'POSTED', 'Payroll Agent', NOW(), true, NOW(), false
);
INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo, department_code, module_source)
VALUES
  ('demo-jl-002a', 'demo-je-002', 'd9c39f7d-e82c-4b6e-a81a-27f6e0ff86ba', 12745000, 0, 'Salaries Expense - all departments', 'ADMIN', 'PAYROLL'),
  ('demo-jl-002b', 'demo-je-002', '7bd3d023-6385-45b1-9be5-86a74ec265f0', 0, 11847850, 'Accrued Payroll - net pay', 'ADMIN', 'PAYROLL'),
  ('demo-jl-002c', 'demo-je-002', '3bcf07a0-9f5e-45e8-9c72-61c5fa143acc', 0, 637250, 'Federal Tax Withholding', 'ADMIN', 'PAYROLL'),
  ('demo-jl-002d', 'demo-je-002', '3bcf07a0-9f5e-45e8-9c72-61c5fa143acc', 0, 259900, 'State Tax Withholding', 'ADMIN', 'PAYROLL');

-- Entry 3: Parts Counter Sale — Invoice #88421 (POSTED)
INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, source_ref, status, posted_by, posted_at, agent_reviewed, created_at, prior_period_adjustment)
VALUES (
  'demo-je-003', 'tenant-kunes', CURRENT_DATE,
  'Parts Counter Sale — Invoice #88421',
  'PARTS_SALE', 'PARTS-88421', 'POSTED', 'GL Agent', NOW(), true, NOW(), false
);
INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo, department_code, module_source)
VALUES
  ('demo-jl-003a', 'demo-je-003', 'ef9c6b09-72f6-4e07-a681-f0929006103f', 12750, 0, 'Cash - Parts counter sale', 'PARTS', 'PARTS_SALE'),
  ('demo-jl-003b', 'demo-je-003', 'a906d5c9-e814-4ed6-be82-122643c9720f', 0, 11283, 'Parts Revenue', 'PARTS', 'PARTS_SALE'),
  ('demo-jl-003c', 'demo-je-003', '3bcf07a0-9f5e-45e8-9c72-61c5fa143acc', 0, 1467, 'Sales Tax', 'PARTS', 'PARTS_SALE');

-- Entry 4: Service RO — PENDING_REVIEW (tech hours anomaly)
INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, source_ref, status, agent_reviewed, created_at, prior_period_adjustment)
VALUES (
  'demo-je-004', 'tenant-kunes', CURRENT_DATE,
  'Service RO — Flag: Tech hours anomaly',
  'SERVICE_RO', 'RO-DEMO-2026-002', 'PENDING_REVIEW', true, NOW(), false
);
INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo, department_code, ro_number, module_source)
VALUES
  ('demo-jl-004a', 'demo-je-004', 'ef9c6b09-72f6-4e07-a681-f0929006103f', 89250, 0, 'Cash - RO-DEMO-2026-002', 'SERVICE', 'RO-DEMO-2026-002', 'SERVICE_EOD'),
  ('demo-jl-004b', 'demo-je-004', '7b97ff49-895b-497f-b4d1-60c2a59df763', 0, 81250, 'Service Revenue - FLAGGED: 9.0 flat-rate hrs vs 4.0 clock hrs', 'SERVICE', 'RO-DEMO-2026-002', 'SERVICE_EOD'),
  ('demo-jl-004c', 'demo-je-004', '3bcf07a0-9f5e-45e8-9c72-61c5fa143acc', 0, 8000, 'Sales Tax', 'SERVICE', 'RO-DEMO-2026-002', 'SERVICE_EOD');

-- Done. 4 journal entries with 13 lines seeded.
