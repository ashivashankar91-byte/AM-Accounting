-- S048 — Wholesale Vehicle AR & Title Gate. Extends the permission catalog
-- with 5 apar-service permission keys: view/create/record-payment on
-- wholesale vehicle AR items, the server-enforced release-title gate, and
-- the distinct release-title exception (override) permission.
--
-- Role design: view/create/record_payment/release_title are broad
-- (ADMIN/CONTROLLER/ACCOUNTANT — everyday AR operations). The title
-- release EXCEPTION path bypasses the paid-in-full gate (D-CE09 hard
-- rule per the fable package AC) and is restricted to ADMIN/CONTROLLER
-- only, mirroring the "higher-authority override" precedent used for
-- S050's write-off-over-threshold override.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.35.0', 'S048: wholesale vehicle AR title gate — 5 ar.wholesale.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.wholesale.view',                   'View wholesale vehicle AR items and their title-release status',              '1.35.0'),
  ('ar.wholesale.create',                 'Create a wholesale vehicle AR item',                                          '1.35.0'),
  ('ar.wholesale.record_payment',         'Record a payment against a wholesale vehicle AR item',                       '1.35.0'),
  ('ar.wholesale.release_title',          'Release title on a wholesale vehicle AR item (server-enforced paid-in-full gate)', '1.35.0'),
  ('ar.wholesale.title_release_exception','Override the paid-in-full title-release gate with a mandatory audited reason',     '1.35.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant including the exception override.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ar.wholesale.view'),
  ('ar.wholesale.create'),
  ('ar.wholesale.record_payment'),
  ('ar.wholesale.release_title'),
  ('ar.wholesale.title_release_exception')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: everyday AR operations, but NOT the exception override.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', k
FROM (VALUES
  ('ar.wholesale.view'),
  ('ar.wholesale.create'),
  ('ar.wholesale.record_payment'),
  ('ar.wholesale.release_title')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
