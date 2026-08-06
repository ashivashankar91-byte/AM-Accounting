-- CE-11 S063 gap-closure — approved unapplied-time absorption policy.
-- New fixedops-service permission keys for labor-rate configuration
-- (governed, Controller-tier ceremony — same grant shape as
-- fixedops.mapping.manage) and absorption reversal (operational
-- correction — same grant shape as fixedops.ro.reversal.execute).
--
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.31.0', 'CE-11 gap-closure: fixedops-service labor-rate config + tech-time reversal permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('fixedops.laborrate.view', 'View LaborRateConfig rows (technician/department burdened labor-cost rates)', '1.31.0'),
  ('fixedops.laborrate.manage', 'Set an effective-dated technician or department burdened labor-cost rate (Controller-tier ceremony)', '1.31.0'),
  ('fixedops.techtime.reverse', 'Reverse a posted tech-time absorption, reusing its captured rate/amount', '1.31.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: every new key.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('fixedops.laborrate.view'), ('fixedops.laborrate.manage'), ('fixedops.techtime.reverse')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view labor rates (same tier as fixedops.mapping.view) plus
-- the reversal action (same tier as fixedops.ro.reversal.execute, which
-- ACCOUNTANT already holds) — NOT laborrate.manage, matching the existing
-- mapping.manage precedent of keeping rate/mapping governance
-- Controller-tier only.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', p.key
FROM (VALUES
  ('fixedops.laborrate.view'), ('fixedops.techtime.reverse')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
