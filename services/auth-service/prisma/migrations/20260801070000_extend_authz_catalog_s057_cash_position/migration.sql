-- S057 — Daily Cash Position Dashboard. Extends the permission catalog
-- with 2 cash-service permission keys: view the composed read-only cash
-- position, and export/retain an audited snapshot of it. Follows the
-- S052/S053/S055/S056 precedent exactly.
--
-- Role design: view is broad (ADMIN/CONTROLLER/SUPERVISOR — this is a
-- read-only dashboard, no money movement), export is restricted to
-- ADMIN/CONTROLLER since it creates a retained audit record.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.34.0', 'S057: daily cash position dashboard — 2 cash.position.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('cash.position.view',   'View the daily cash position dashboard (read-only composition)', '1.34.0'),
  ('cash.position.export', 'Export and retain an audited daily cash position snapshot',       '1.34.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES ('cash.position.view'), ('cash.position.export')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('cash.position.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
