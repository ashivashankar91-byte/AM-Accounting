-- CE-11 Fixed Ops Integrations epic (S059-S072) — new manifest permission
-- keys for the new fixedops-service (Workstream A/B: RO close/reopen/void,
-- WIP, sublet, unapplied time, deferred maintenance, warranty claims) and
-- parts-accounting-service (Workstream C/D: parts movement/tie-out,
-- price-tape, obsolescence/scrap, physical inventory, deposits, OEM
-- returns, valuation config).
--
-- Consolidated from services/fixedops-service/PERMISSIONS.md and
-- services/parts-accounting-service/PERMISSIONS.md — grant shape follows
-- the same convention as 20260801020000_add_ce10_tax_permissions:
-- ADMIN/CONTROLLER hold every key including all .manage/.execute/.elect/
-- .approve/.disposition/.resolve keys; ACCOUNTANT holds view + the
-- operational actions the CE-11 package explicitly names for that persona;
-- two new personas are introduced per the package's own screen-persona
-- list (MANDATORY ACCOUNTING UI section) — WARRANTY_ADMIN (screen #4) and
-- PARTS_MANAGER (screens #8, #10) — layered alongside the existing roles,
-- not replacing them, at the tier the package implies (operational, not
-- approval-authority) until dedicated role definitions exist.
--
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-11 Fixed Ops Integrations epic: fixedops-service (S059-S065) + parts-accounting-service (S066-S072) permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  -- fixedops-service
  ('fixedops.ro.view', 'View RO close postings, distribution, and detail', '1.30.0'),
  ('fixedops.ro.close.execute', 'Execute an RO close event (S059)', '1.30.0'),
  ('fixedops.ro.reversal.execute', 'Execute a reopen/void reversal (S060)', '1.30.0'),
  ('fixedops.wip.view', 'View WIP mode history and open-RO/WIP report', '1.30.0'),
  ('fixedops.wip.elect', 'Elect WIP mode (ceremony, Controller-tier)', '1.30.0'),
  ('fixedops.sublet.view', 'View sublet PO lifecycle', '1.30.0'),
  ('fixedops.sublet.manage', 'Create sublet PO, match invoice, accrue', '1.30.0'),
  ('fixedops.techtime.view', 'View unapplied-time/guarantee absorption', '1.30.0'),
  ('fixedops.techtime.post', 'Post period-boundary time absorption', '1.30.0'),
  ('fixedops.deferred.view', 'View deferred maintenance contracts', '1.30.0'),
  ('fixedops.deferred.manage', 'Sell/redeem deferred maintenance contracts', '1.30.0'),
  ('fixedops.warranty.view', 'View warranty claim lifecycle and aging', '1.30.0'),
  ('fixedops.warranty.disposition', 'Submit/remit/disposition a warranty claim', '1.30.0'),
  ('fixedops.mapping.view', 'View FixedOpsAccountMapping rows', '1.30.0'),
  ('fixedops.mapping.manage', 'Set a tenant-configured GL account for a fixedops mapping role (Controller-tier)', '1.30.0'),
  ('fixedops.exception.view', 'View the S021-aligned Fixed Ops exception/recovery queue', '1.30.0'),
  ('fixedops.exception.resolve', 'Resolve/re-request a Fixed Ops exception', '1.30.0'),
  ('fixedops.audit.view', 'View audit history for Fixed Ops entities', '1.30.0'),
  -- parts-accounting-service
  ('parts.movement.view', 'View parts movements', '1.30.0'),
  ('parts.movement.post', 'Post a parts movement (receipt/issue/sale/return)', '1.30.0'),
  ('parts.reconciliation.view', 'View perpetual-to-GL reconciliation runs', '1.30.0'),
  ('parts.reconciliation.run', 'Trigger an on-demand reconciliation run', '1.30.0'),
  ('parts.valuation.view', 'View valuation config (method, landed-cost rules)', '1.30.0'),
  ('parts.valuation.manage', 'Create/update valuation config (effective-dated ceremony)', '1.30.0'),
  ('parts.pricetape.view', 'View price-tape loads and history', '1.30.0'),
  ('parts.pricetape.approve', 'Load/preview/approve a price-tape revaluation', '1.30.0'),
  ('parts.obsolescence.view', 'View obsolescence provision runs', '1.30.0'),
  ('parts.obsolescence.approve', 'Preview/approve an obsolescence provision', '1.30.0'),
  ('parts.scrap.view', 'View scrap disposals', '1.30.0'),
  ('parts.scrap.execute', 'Execute a scrap disposal (distinct permission per S068, deliberately independent of obsolescence.approve)', '1.30.0'),
  ('parts.physical.view', 'View physical-inventory sessions/variance reports', '1.30.0'),
  ('parts.physical.count', 'Open a session, freeze scope, enter counts', '1.30.0'),
  ('parts.physical.approve', 'Approve a variance-reviewed session (posts the adjustment)', '1.30.0'),
  ('parts.deposit.view', 'View special-order deposits, abandoned queue', '1.30.0'),
  ('parts.deposit.manage', 'Create/apply/refund/escheat a deposit', '1.30.0'),
  ('parts.oemreturn.view', 'View OEM parts-return authorizations', '1.30.0'),
  ('parts.oemreturn.manage', 'Authorize/ship/credit/disposition an OEM return', '1.30.0'),
  ('parts.exception.view', 'View the CE-11 parts posting exception/recovery queue', '1.30.0'),
  ('parts.exception.manage', 'Resolve/re-request a parts posting exception', '1.30.0'),
  ('parts.mapping.view', 'View tenant account-mapping status per parts event family', '1.30.0'),
  ('parts.mapping.manage', 'Set a tenant-configured GL account for a parts mapping role (Controller-tier)', '1.30.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: every key, including all .manage/.execute/.elect/
-- .approve/.disposition/.resolve/.run/.post/.count keys.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('fixedops.ro.view'), ('fixedops.ro.close.execute'), ('fixedops.ro.reversal.execute'),
  ('fixedops.wip.view'), ('fixedops.wip.elect'),
  ('fixedops.sublet.view'), ('fixedops.sublet.manage'),
  ('fixedops.techtime.view'), ('fixedops.techtime.post'),
  ('fixedops.deferred.view'), ('fixedops.deferred.manage'),
  ('fixedops.warranty.view'), ('fixedops.warranty.disposition'),
  ('fixedops.mapping.view'), ('fixedops.mapping.manage'),
  ('fixedops.exception.view'), ('fixedops.exception.resolve'),
  ('fixedops.audit.view'),
  ('parts.movement.view'), ('parts.movement.post'),
  ('parts.reconciliation.view'), ('parts.reconciliation.run'),
  ('parts.valuation.view'), ('parts.valuation.manage'),
  ('parts.pricetape.view'), ('parts.pricetape.approve'),
  ('parts.obsolescence.view'), ('parts.obsolescence.approve'),
  ('parts.scrap.view'), ('parts.scrap.execute'),
  ('parts.physical.view'), ('parts.physical.count'), ('parts.physical.approve'),
  ('parts.deposit.view'), ('parts.deposit.manage'),
  ('parts.oemreturn.view'), ('parts.oemreturn.manage'),
  ('parts.exception.view'), ('parts.exception.manage'),
  ('parts.mapping.view'), ('parts.mapping.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view everywhere in both services, plus the operational
-- actions the CE-11 package assigns to the Accountant persona (RO close,
-- reversal, sublet management, tech-time posting, deferred contract
-- sell/redeem, exception resolution, reconciliation runs, deposit
-- lifecycle) — mirrors the CE-10 migration's ACCOUNTANT rationale.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', p.key
FROM (VALUES
  ('fixedops.ro.view'), ('fixedops.ro.close.execute'), ('fixedops.ro.reversal.execute'),
  ('fixedops.wip.view'),
  ('fixedops.sublet.view'), ('fixedops.sublet.manage'),
  ('fixedops.techtime.view'), ('fixedops.techtime.post'),
  ('fixedops.deferred.view'), ('fixedops.deferred.manage'),
  ('fixedops.warranty.view'),
  ('fixedops.mapping.view'),
  ('fixedops.exception.view'), ('fixedops.exception.resolve'),
  ('fixedops.audit.view'),
  ('parts.movement.view'),
  ('parts.reconciliation.view'), ('parts.reconciliation.run'),
  ('parts.valuation.view'),
  ('parts.pricetape.view'),
  ('parts.obsolescence.view'),
  ('parts.scrap.view'),
  ('parts.physical.view'),
  ('parts.deposit.view'), ('parts.deposit.manage'),
  ('parts.oemreturn.view'),
  ('parts.exception.view'), ('parts.exception.manage'),
  ('parts.mapping.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- WARRANTY_ADMIN — new persona (CE11_FABLE_EPIC_PACKAGE.md, MANDATORY
-- ACCOUNTING UI screen #4 "Warranty Receivable & Claim Aging"): warranty
-- lifecycle actions at the same tier as ACCOUNTANT, layered alongside the
-- existing roles until a dedicated role definition exists.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'WARRANTY_ADMIN', p.key
FROM (VALUES
  ('fixedops.ro.view'),
  ('fixedops.warranty.view'), ('fixedops.warranty.disposition'),
  ('fixedops.audit.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- PARTS_MANAGER — new persona (CE11_FABLE_EPIC_PACKAGE.md, MANDATORY
-- ACCOUNTING UI screens #8 "Physical Inventory Adjustment Review" and #10
-- "Price-Tape / Revaluation & Obsolescence"): operational parts actions
-- (movement posting, physical counts, scrap execution, OEM return
-- handling), NOT approval-authority actions (valuation-config ceremony,
-- price-tape/obsolescence/physical approval remain Controller-tier per the
-- package's preview-approve discipline).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'PARTS_MANAGER', p.key
FROM (VALUES
  ('parts.movement.view'), ('parts.movement.post'),
  ('parts.reconciliation.view'),
  ('parts.valuation.view'),
  ('parts.pricetape.view'),
  ('parts.obsolescence.view'),
  ('parts.scrap.view'), ('parts.scrap.execute'),
  ('parts.physical.view'), ('parts.physical.count'),
  ('parts.oemreturn.view'), ('parts.oemreturn.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
