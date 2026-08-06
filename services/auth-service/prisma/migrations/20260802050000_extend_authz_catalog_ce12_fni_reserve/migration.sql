-- CE-12 Workstream R (S091 Finance Reserve & Flat-% Chargeback Reserve,
-- S092 F&I Product Income & Remit Accrual, S093 Product Cancellations,
-- S094 Dealer-Obligor Deferral Mode) — fni-reserve-service permission
-- catalog extension.
--
-- catalog_version numbering precedent: 1.29.0 (CE-08 complete), 1.30.0
-- (CE-12 S024 posting_engine.rule_pack.simulate), 1.32.0 (CE-12 floorplan
-- workstream, concurrent sibling). This migration claims 1.34.0 (the next
-- free slot after 1.32.0, leaving 1.33.0 free for any other concurrent
-- CE-12 sibling migration authored in parallel) — verified unclaimed in the
-- repository at authoring time (no existing migration references 1.33.0 or
-- 1.34.0).
--
-- Risk tiering: recognition-run APPROVAL and deferral-config management are
-- the highest-risk actions this service exposes (approval posts a batch of
-- journals; deferral-config changes which GL treatment a whole product type
-- gets) — ADMIN/CONTROLLER only, same tier as schedule-service's
-- open_item.writeoff / posting_engine.rule_pack.activate precedent. Process/
-- execute actions (remittance processing, short-pay disposition, chargeback
-- draw, remit-run execution, cancellation processing, deferral-booking
-- registration, recognition-run compute) are ADMIN/CONTROLLER/ACCOUNTANT —
-- same tier as apar-service's payment-processing precedent. All *.view keys
-- are ADMIN/CONTROLLER/ACCOUNTANT (read-broad, matching every other CE-12
-- service's view-permission precedent).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.
--
-- Gap-closure addendum (same file, additive INSERT ... ON CONFLICT DO
-- NOTHING statements below claim catalog_version 1.34.1): two new preview
-- keys, chargeback.preview and cancellation.preview, mirroring the existing
-- recognition_run.compute / recognition_run.approve precedent already in
-- this file (a distinct, lower-risk permission for a read-only dry-run
-- computation vs the mutating draw/process action) — POST /chargebacks/
-- preview and POST /cancellations/preview never post or persist anything,
-- so they are tiered identically to the *.view keys (ADMIN/CONTROLLER/
-- ACCOUNTANT), not to chargeback.draw/cancellation.process.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.34.0', 'CE-12 Workstream R (S091/S092/S093/S094): fni-reserve-service permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.34.1', 'CE-12 Workstream R gap-closure: fni-reserve-service chargeback/cancellation dry-run preview permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('fni_reserve.remittance.process',      'Process a lender reserve remittance notification (relieve reserve receivable, accrue chargeback reserve)', '1.34.0'),
  ('fni_reserve.remittance.view',         'View lender reserve remittances', '1.34.0'),
  ('fni_reserve.lender_config.manage',    'Manage lender-program flat-% chargeback reserve configuration', '1.34.0'),
  ('fni_reserve.lender_config.view',      'View lender-program chargeback reserve configuration', '1.34.0'),
  ('fni_reserve.provider_config.manage',  'Manage provider-program pro-rata refund table configuration', '1.34.0'),
  ('fni_reserve.provider_config.view',    'View provider-program pro-rata refund table configuration', '1.34.0'),
  ('fni_reserve.schedule_mapping.manage', 'Manage the schedule-service GL/schedule-number mapping this service reads from', '1.34.0'),
  ('fni_reserve.shortpay.disposition',    'Disposition a short-paid reserve remittance (write off to expense or flag for follow-up)', '1.34.0'),
  ('fni_reserve.chargeback.draw',         'Process an actual finance-reserve chargeback (draws the chargeback reserve, excess to expense)', '1.34.0'),
  ('fni_reserve.chargeback.view',         'View chargeback reserve accruals, draws, and the reserve tie-out inquiry', '1.34.0'),
  ('fni_reserve.remit_run.execute',       'Execute a product remittance run to a provider', '1.34.0'),
  ('fni_reserve.remit_run.view',          'View product remittance runs and the unremitted-liability tie-out inquiry', '1.34.0'),
  ('fni_reserve.reconciliation.manage',   'Upload a provider statement and review/disposition reconciliation variances', '1.34.0'),
  ('fni_reserve.reconciliation.view',     'View provider statement reconciliation worklists', '1.34.0'),
  ('fni_reserve.cancellation.process',    'Process an F&I product cancellation ceremony', '1.34.0'),
  ('fni_reserve.cancellation.view',       'View F&I product cancellations', '1.34.0'),
  ('fni_reserve.deferral_config.manage',  'Manage the dealer-obligor deferral mode election and earning-pattern configuration', '1.34.0'),
  ('fni_reserve.deferral_config.view',    'View the dealer-obligor deferral mode configuration', '1.34.0'),
  ('fni_reserve.deferral_booking.register','Register a deferred F&I product income booking', '1.34.0'),
  ('fni_reserve.recognition_run.compute', 'Compute a deferred-income recognition run preview batch', '1.34.0'),
  ('fni_reserve.recognition_run.approve', 'Approve a computed deferred-income recognition run batch for posting', '1.34.0'),
  ('fni_reserve.recognition_run.view',    'View deferred-income recognition run batches and lines', '1.34.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('fni_reserve.chargeback.preview',    'Dry-run preview of an actual chargeback draw (drawn-from-reserve/excess-to-expense split) without posting', '1.34.1'),
  ('fni_reserve.cancellation.preview',  'Dry-run preview of a product cancellation three-leg breakdown without posting', '1.34.1')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('fni_reserve.remittance.view'),
  ('fni_reserve.chargeback.view'),
  ('fni_reserve.remit_run.view'),
  ('fni_reserve.reconciliation.view'),
  ('fni_reserve.cancellation.view'),
  ('fni_reserve.deferral_config.view'),
  ('fni_reserve.recognition_run.view'),
  ('fni_reserve.lender_config.view'),
  ('fni_reserve.provider_config.view'),
  ('fni_reserve.remittance.process'),
  ('fni_reserve.shortpay.disposition'),
  ('fni_reserve.chargeback.draw'),
  ('fni_reserve.remit_run.execute'),
  ('fni_reserve.reconciliation.manage'),
  ('fni_reserve.cancellation.process'),
  ('fni_reserve.deferral_booking.register'),
  ('fni_reserve.recognition_run.compute'),
  ('fni_reserve.lender_config.manage'),
  ('fni_reserve.provider_config.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Highest-risk actions: ADMIN/CONTROLLER only (no ACCOUNTANT).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('fni_reserve.deferral_config.manage'),
  ('fni_reserve.recognition_run.approve'),
  ('fni_reserve.schedule_mapping.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Gap-closure addendum: the two new dry-run preview keys, same tier as
-- every other *.view key (ADMIN/CONTROLLER/ACCOUNTANT) — see the
-- catalog_version 1.34.1 addendum comment above.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('fni_reserve.chargeback.preview'),
  ('fni_reserve.cancellation.preview')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
