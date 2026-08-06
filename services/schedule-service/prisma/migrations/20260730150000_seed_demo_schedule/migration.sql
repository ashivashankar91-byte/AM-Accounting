-- Demo bootstrap: one AP vendor open-item schedule for tenant-kunes.
-- SD-TYPE=1 (control-number keyed detail, up to 5 GL accounts), tracking
-- the Accounts Payable - Trade control account (1220 in this tenant's CoA
-- is Used Vehicle Inventory — the AP control account is code 2010).
-- ON CONFLICT DO NOTHING keeps this idempotent across repeated migrate deploys.
INSERT INTO schedules (id, tenant_id, schedule_number, title, report_sequence, schedule_type, gl_account_numbers, eom_purge_type, control_name_display)
VALUES
  ('schedule-kunes-ap-trade', 'tenant-kunes', '01', 'AP Trade Open Items', 'C', 1, ARRAY['2010'], 1, 'Y')
ON CONFLICT (tenant_id, schedule_number) DO NOTHING;
