-- CE-12 WORKSTREAM V (S074/S075/S076/S077, vehicle-accounting-service) —
-- permission catalog extension.
--
-- Per the S026/S027/S036A/S041/S021/CE-08/CE-10 catalog-extension
-- precedent, a route-level createAuthzGuard() check in
-- vehicle-accounting-service's http/*-routes.ts is worthless against the
-- real HttpAuthzClient unless the permission key actually exists here AND
-- is granted to at least one role. vehicle-accounting-service references
-- these keys (see src/http/security.ts's VEHICLE_ACCOUNTING_PERMISSIONS):
--   vehicle_accounting.unit.view
--   vehicle_accounting.unit.stock_in
--   vehicle_accounting.unit.cost_add
--   vehicle_accounting.unit.reclass
--   vehicle_accounting.unit.writedown
--   vehicle_accounting.demo_adjustment.approve
--   vehicle_accounting.dealer_trade.view
--   vehicle_accounting.dealer_trade.manage
--   vehicle_accounting.config.manage
-- None of the above existed prior to this migration.
--
-- View actions (unit.view, dealer_trade.view) follow the existing
-- read-broad pattern (ADMIN/CONTROLLER/ACCOUNTANT), matching
-- schedule.open_item.view / posting_engine.rule_pack.view etc. Every
-- mutating action (stock-in, cost/recon cost add, reclass, write-down,
-- demo-adjustment approve, dealer-trade manage, config manage) is
-- restricted to ADMIN/CONTROLLER only — Controller/Admin authority
-- precedent, matching posting_engine.rule_pack.edit /
-- schedule.open_item.writeoff.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.31.0', 'CE-12 WORKSTREAM V (S074-S077, vehicle-accounting-service): vehicle_accounting.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('vehicle_accounting.unit.view',             'View vehicle units, cost-buildup lineage and item tie-out (S074)', '1.31.0'),
  ('vehicle_accounting.unit.stock_in',          'Stock in a new vehicle unit (S074 vehicle.stocked)', '1.31.0'),
  ('vehicle_accounting.unit.cost_add',          'Add a post-stock-in cost component or reconditioning RO cost to a unit (S074)', '1.31.0'),
  ('vehicle_accounting.unit.reclass',           'Reclass a unit NEW -> DEMO and preview/approve/reject/reverse periodic demo value adjustments (S075)', '1.31.0'),
  ('vehicle_accounting.unit.writedown',         'Enter LCNRV market evidence and perform an LCNRV write-down ceremony (S076)', '1.31.0'),
  ('vehicle_accounting.demo_adjustment.approve','Approve, reject or reverse a previewed demo value adjustment (S075)', '1.31.0'),
  ('vehicle_accounting.dealer_trade.view',      'View dealer trades and settlements (S077)', '1.31.0'),
  ('vehicle_accounting.dealer_trade.manage',    'Create outbound/inbound dealer trades and settle them (S077)', '1.31.0'),
  ('vehicle_accounting.config.manage',          'Manage vehicle-accounting SAFE_CONFIGURATION (pack policy, demo depreciation basis, LCNRV threshold)', '1.31.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('vehicle_accounting.unit.view'),
  ('vehicle_accounting.dealer_trade.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('vehicle_accounting.unit.stock_in'),
  ('vehicle_accounting.unit.cost_add'),
  ('vehicle_accounting.unit.reclass'),
  ('vehicle_accounting.unit.writedown'),
  ('vehicle_accounting.demo_adjustment.approve'),
  ('vehicle_accounting.dealer_trade.manage'),
  ('vehicle_accounting.config.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
