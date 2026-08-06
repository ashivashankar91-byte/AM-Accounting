-- AMACC-R1 S026: Schedule Open-Item Core — permission catalog extension.
-- Per the S220/S003/S009/S036A catalog-extension precedent, a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists here AND is granted to at least
-- one role — seeded before schedule-service's open-item routes are wired to
-- enforce these keys.
--
-- schedule.open_item.apply and schedule.tie_out.run are restricted to
-- ADMIN/CONTROLLER only (sensitive: manual balance mutation and triggering a
-- GL reconciliation run). schedule.open_item.view / schedule.tie_out.view
-- are granted to ACCOUNTANT as well (read-broad pattern, matches
-- ap.vendor.view / je.view).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- R1 Controlled Selective Integration renumbering: this migration originally
-- declared catalog_version 1.18.0 and lived under timestamp
-- 20260730010000 on the source certification branch
-- (r1-s026-s027-schedule-engine-v2 @ 62b5a39). r1-integration's own
-- 20260729050000_extend_authz_catalog_s052_cash_receipts migration already
-- claims 1.18.0 (the highest version integrated at the time this branch was
-- certified). Renumbered to 1.19.0 — the next free slot after 1.18.0 — and
-- moved to timestamp 20260730040000 (after S052's 20260729050000) so no two
-- auth-service migrations share a timestamp prefix. Same precedent as
-- S009/S011/S032/posting-engine/S036A's own renumbering history in this
-- migrations directory.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.19.0', 'AMACC-R1 S026: schedule.open_item.* / schedule.tie_out.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('schedule.open_item.view',   'View schedule open items, balances, and application history', '1.19.0'),
  ('schedule.open_item.apply',  'Manually apply a payment/credit against a schedule open item', '1.19.0'),
  ('schedule.open_item.reverse','Reverse a schedule application', '1.19.0'),
  ('schedule.tie_out.view',     'View nightly GL-to-schedule tie-out results and discrepancies', '1.19.0'),
  ('schedule.tie_out.run',      'Trigger an on-demand schedule-to-GL tie-out run', '1.19.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.open_item.view'),
  ('schedule.tie_out.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.open_item.apply'),
  ('schedule.open_item.reverse'),
  ('schedule.tie_out.run')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
