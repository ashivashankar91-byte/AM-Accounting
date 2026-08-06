-- CE-13 Payroll epic — RBAC gap-closure.
--
-- payroll-service routes (routes.ts, ce13-routes.ts, commission-routes.ts)
-- previously enforced only JWT auth, tenant scoping, and action-level
-- Segregation-of-Duties checks (author cannot activate their own S025 rule
-- pack; preparer cannot approve their own S111 accrual), with no RBAC
-- permission-guard layer. This migration seeds the minimum `payroll.*`
-- permission-key set payroll-service/src/http/security.ts's
-- attachPayrollRouteSecurity() now enforces server-side via createAuthzGuard
-- (same pattern as tax-service/coa-service). Additive-only — no existing
-- key, grant, or role removed or altered.
--
-- Tiering follows the existing repo convention: broad read-only permissions
-- are granted to ADMIN/CONTROLLER/ACCOUNTANT; mutating, approval,
-- activation, posting, and void/reverse permissions (financially or
-- statutorily consequential) are restricted to ADMIN/CONTROLLER only. The
-- underlying self-activation/self-approval SoD checks in
-- rule-pack-service.ts and ce13-routes.ts are unchanged by this migration
-- and continue to run in addition to these role-permission grants.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-13 Payroll epic RBAC gap-closure: payroll.config/source_mode/rule_pack/batch/commission/commission_dispute/clawback/accrual/tech_bridge/register_ytd/audit permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('payroll.config.view',                'View payroll employee setup, GL mappings, and tax-rate configuration', '1.30.0'),
  ('payroll.config.manage',              'Manage payroll employee setup, GL mappings, and tax-rate configuration', '1.30.0'),
  ('payroll.source_mode.manage',         'Configure the tenant payroll statutory source mode (S108)', '1.30.0'),
  ('payroll.rule_pack.view',             'View S025 payroll GL rule-pack versions and simulation/validation results', '1.30.0'),
  ('payroll.rule_pack.manage',           'Draft a new S025 payroll GL rule-pack version', '1.30.0'),
  ('payroll.rule_pack.activate',         'Activate a validated S025 payroll GL rule-pack version', '1.30.0'),
  ('payroll.batch.view',                 'View payroll batches and batch detail', '1.30.0'),
  ('payroll.batch.create',               'Create a new payroll batch', '1.30.0'),
  ('payroll.batch.edit',                 'Add or remove payroll batch line items', '1.30.0'),
  ('payroll.batch.validate',             'Validate a payroll batch', '1.30.0'),
  ('payroll.batch.approve',              'Approve a payroll batch', '1.30.0'),
  ('payroll.batch.hold_release',         'Hold or release a payroll batch', '1.30.0'),
  ('payroll.batch.post',                 'Post a payroll batch through the governed CE-07 posting boundary', '1.30.0'),
  ('payroll.batch.void_reverse',         'Void or reverse a payroll batch', '1.30.0'),
  ('payroll.commission.view',            'View commission plans, draws, and commission records', '1.30.0'),
  ('payroll.commission.manage',          'Manage commission plans, draws, corrections, reversals, and chargebacks', '1.30.0'),
  ('payroll.commission_dispute.resolve', 'Resolve a commission dispute', '1.30.0'),
  ('payroll.clawback.view',              'View S110 clawback/chargeback records', '1.30.0'),
  ('payroll.clawback.manage',            'Create or resolve S110 clawback/chargeback records', '1.30.0'),
  ('payroll.accrual.view',               'View S111 payroll accrual entries', '1.30.0'),
  ('payroll.accrual.manage',             'Create a S111 payroll accrual entry preview', '1.30.0'),
  ('payroll.accrual.approve',            'Approve a S111 payroll accrual entry', '1.30.0'),
  ('payroll.tech_bridge.view',           'View S112 tech flag-hour bridge entries', '1.30.0'),
  ('payroll.tech_bridge.manage',         'Create a S112 tech flag-hour bridge entry', '1.30.0'),
  ('payroll.register_ytd.view',          'View payroll register, YTD balances, batch summaries, and payroll runs', '1.30.0'),
  ('payroll.audit.view',                 'View payroll audit history', '1.30.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('payroll.config.view'),
  ('payroll.rule_pack.view'),
  ('payroll.batch.view'),
  ('payroll.commission.view'),
  ('payroll.clawback.view'),
  ('payroll.accrual.view'),
  ('payroll.tech_bridge.view'),
  ('payroll.register_ytd.view'),
  ('payroll.audit.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('payroll.config.manage'),
  ('payroll.source_mode.manage'),
  ('payroll.rule_pack.manage'),
  ('payroll.rule_pack.activate'),
  ('payroll.batch.create'),
  ('payroll.batch.edit'),
  ('payroll.batch.validate'),
  ('payroll.batch.approve'),
  ('payroll.batch.hold_release'),
  ('payroll.batch.post'),
  ('payroll.batch.void_reverse'),
  ('payroll.commission.manage'),
  ('payroll.commission_dispute.resolve'),
  ('payroll.clawback.manage'),
  ('payroll.accrual.manage'),
  ('payroll.accrual.approve'),
  ('payroll.tech_bridge.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
