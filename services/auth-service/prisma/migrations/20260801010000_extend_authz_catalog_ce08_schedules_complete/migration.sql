-- CE-08 Schedules epic completion (S028 auto-application, S029 split/
-- transfer/write-off ceremonies, S027 exception-queue disposition, S030
-- statements/dunning) — permission catalog extension.
--
-- Per the S026/S027/S036A/S041/S021 catalog-extension precedent, a
-- route-level createAuthzGuard() check in schedule-service's http/routes.ts
-- is worthless against the real HttpAuthzClient unless the permission key
-- actually exists here AND is granted to at least one role. schedule-service
-- already references these keys as of this epic's routes:
--   schedule.open_item.split / .transfer / .writeoff
--   schedule.exception.view / .disposition
--   schedule.statement.view / .generate
-- None of the above existed prior to this migration; schedule.open_item.view/
-- .apply/.reverse and schedule.tie_out.* were already seeded by
-- 20260730040000_extend_authz_catalog_s026_open_items and are untouched here.
--
-- Split/transfer/write-off ceremonies are destructive/GL-posting-adjacent
-- (write-off posts a real journal entry; split and transfer mutate open-item
-- lineage) — restricted to ADMIN/CONTROLLER only, same tier as
-- schedule.open_item.apply/reverse. Exception disposition and statement
-- generation are likewise restricted to ADMIN/CONTROLLER (disposition
-- resolves a control exception; generation produces external-facing customer
-- correspondence). schedule.exception.view and schedule.statement.view follow
-- the existing read-broad pattern (ADMIN/CONTROLLER/ACCOUNTANT), matching
-- schedule.open_item.view / schedule.tie_out.view / schedule.aging.view.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.29.0', 'CE-08 Schedules epic completion (S028/S029/S030 + S027 exception disposition): schedule.open_item.split/transfer/writeoff, schedule.exception.view/disposition, schedule.statement.view/generate permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('schedule.open_item.split',        'Split a schedule open item into multiple parts preserving amount conservation', '1.29.0'),
  ('schedule.open_item.transfer',     'Transfer a schedule open item to another control account within the same schedule', '1.29.0'),
  ('schedule.open_item.writeoff',     'Write off a schedule open item and post the corresponding GL journal entry', '1.29.0'),
  ('schedule.exception.view',         'View schedule exception-queue items and their rule configuration', '1.29.0'),
  ('schedule.exception.disposition',  'Disposition (resolve/dismiss) a schedule exception-queue item', '1.29.0'),
  ('schedule.statement.view',         'View generated customer statements and dunning run history', '1.29.0'),
  ('schedule.statement.generate',     'Generate a customer statement or dunning run', '1.29.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.exception.view'),
  ('schedule.statement.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('schedule.open_item.split'),
  ('schedule.open_item.transfer'),
  ('schedule.open_item.writeoff'),
  ('schedule.exception.disposition'),
  ('schedule.statement.generate')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
