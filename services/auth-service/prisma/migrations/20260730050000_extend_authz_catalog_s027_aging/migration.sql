-- AMACC-R1 S027: Schedule Aging Engine — permission catalog extension.
-- schedule.aging.view is granted broadly (ADMIN/CONTROLLER/ACCOUNTANT),
-- matching schedule.open_item.view's read-broad pattern. schedule.aging.
-- config (per-tenant bucket boundary configuration) is ADMIN/CONTROLLER
-- only — it changes what every user sees as "overdue," a control-sensitive
-- setting.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- R1 Controlled Selective Integration renumbering: this migration originally
-- declared catalog_version 1.19.0 and lived under timestamp
-- 20260730020000 on the source certification branch
-- (r1-s026-s027-schedule-engine-v2 @ 62b5a39). Renumbered to 1.20.0 — the
-- next free slot after this integration's S026 migration
-- (20260730040000_extend_authz_catalog_s026_open_items, 1.19.0) — and moved
-- to timestamp 20260730050000 so no two auth-service migrations share a
-- timestamp prefix. Same precedent as S009/S011/S032/posting-engine/S036A's
-- own renumbering history in this migrations directory.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.20.0', 'AMACC-R1 S027: schedule.aging.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('schedule.aging.view',   'View the schedule aging report', '1.20.0'),
  ('schedule.aging.config', 'Configure per-tenant aging bucket boundaries', '1.20.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.aging.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.aging.config')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
