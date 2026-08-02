-- CE-12 (S079/S080/S081/S082 — WORKSTREAM F FLOORPLAN) — permission catalog
-- extension for the new floorplan-service. Structure copied verbatim from
-- 20260801010000_extend_authz_catalog_ce08_schedules_complete (view-broad /
-- mutate-narrow split) and from 20260802010000_extend_authz_catalog_ce12_
-- posting_engine_simulate (catalog_version numbering precedent for this
-- CE-12 epic).
--
-- catalog_version 1.32.0: the next free slot after 1.30.0 (CE-12 S024
-- posting_engine.rule_pack.simulate) and 1.31.0 (reserved for a sibling
-- CE-12 workstream service's own catalog extension landing concurrently in
-- this same epic — see the epic coordinator's reconciliation note).
--
-- Per the S026/S027/S036A/S041/S021/CE-10/CE-08 precedent, a route-level
-- createAuthzGuard() check in floorplan-service's http/routes.ts is
-- worthless against the real HttpAuthzClient unless the permission key
-- actually exists here AND is granted to at least one role.
--
-- View-only keys (floorplan.*.view) follow the existing read-broad pattern
-- (ADMIN/CONTROLLER/ACCOUNTANT). Mutating/destructive keys (lender config,
-- feed import, VIN match execution, break disposition, SOT escalation,
-- interest entry, curtailment payment/config, delivery-event manual entry,
-- tenant config) are GL-posting-adjacent or control-sensitive and are
-- restricted to ADMIN/CONTROLLER only, matching schedule.open_item.writeoff
-- / schedule.exception.disposition's tier.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.32.0', 'CE-12 WORKSTREAM F (S079/S080/S081/S082, floorplan-service): floorplan.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('floorplan.feed.view',          'View lender profiles, feed adapter status, staged rows and import batches', '1.32.0'),
  ('floorplan.lender.manage',      'Configure a lender profile and its feed adapter wiring', '1.32.0'),
  ('floorplan.feed.import',        'Import a lender feed or manual statement batch as staged evidence rows', '1.32.0'),
  ('floorplan.match.view',         'View VIN match results and the floorplan liability tie-out', '1.32.0'),
  ('floorplan.match.execute',      'Execute a VIN match between a staged lender row and a unit floorplan liability item', '1.32.0'),
  ('floorplan.break.view',         'View the floorplan break worklist', '1.32.0'),
  ('floorplan.break.disposition',  'Disposition (resolve) a floorplan break worklist item', '1.32.0'),
  ('floorplan.liability.view',     'View floorplan liability items and the liability GL tie-out inquiry', '1.32.0'),
  ('floorplan.sot.view',           'View the sold-out-of-trust (SOT) exposure monitor, aging and drill-down', '1.32.0'),
  ('floorplan.sot.escalate',       'Transition a SOT exception escalation state', '1.32.0'),
  ('floorplan.delivery.enter',     'Manually record a unit-delivered event for SOT composition (fixture/manual path)', '1.32.0'),
  ('floorplan.interest.view',      'View entered lender interest statements and unit/department allocations', '1.32.0'),
  ('floorplan.interest.enter',     'Enter a lender interest statement figure and run its allocation', '1.32.0'),
  ('floorplan.curtailment.view',   'View curtailment schedule configuration and payment history', '1.32.0'),
  ('floorplan.curtailment.config', 'Configure a lender curtailment schedule', '1.32.0'),
  ('floorplan.curtailment.pay',    'Enter a curtailment payment and post its principal-relief journal', '1.32.0'),
  ('floorplan.config.view',        'View floorplan tenant configuration (SOT grace period, allocation basis)', '1.32.0'),
  ('floorplan.config.manage',      'Update floorplan tenant configuration (SOT grace period, allocation basis)', '1.32.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('floorplan.feed.view'),
  ('floorplan.match.view'),
  ('floorplan.break.view'),
  ('floorplan.liability.view'),
  ('floorplan.sot.view'),
  ('floorplan.interest.view'),
  ('floorplan.curtailment.view'),
  ('floorplan.config.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('floorplan.lender.manage'),
  ('floorplan.feed.import'),
  ('floorplan.match.execute'),
  ('floorplan.break.disposition'),
  ('floorplan.sot.escalate'),
  ('floorplan.delivery.enter'),
  ('floorplan.interest.enter'),
  ('floorplan.curtailment.config'),
  ('floorplan.curtailment.pay'),
  ('floorplan.config.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
