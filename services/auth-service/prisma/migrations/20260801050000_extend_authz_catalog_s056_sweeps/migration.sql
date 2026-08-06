-- S056 — ZBA Sweeps & FP-Offset Allocation. Extends the permission catalog
-- with 8 cash-service permission keys: sweep account-pair configuration,
-- sweep recording/view/post/void, and FP-offset allocation create/view/post.
-- Follows the S052/S053/S055 precedent exactly.
--
-- Role design: pair configuration and posting are back-office
-- (ADMIN/CONTROLLER) actions; day-to-day sweep recording is also granted
-- to CONTROLLER (mirrors deposit-preparation precedent) but NOT to
-- CASHIER, since sweeps move funds between GL-significant accounts, not
-- till cash. SUPERVISOR is view-only, matching every other CE-09 story.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.32.0', 'S056: ZBA sweeps & FP-offset allocation — 8 cash.sweep.*/cash.fpoffset.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('cash.sweep.config',    'Configure a ZBA sweep store/operating account pair',            '1.32.0'),
  ('cash.sweep.record',    'Record a ZBA sweep (manual or feed-confirmed)',                  '1.32.0'),
  ('cash.sweep.view',      'View sweep account pairs and sweep records',                     '1.32.0'),
  ('cash.sweep.post',      'Post a recorded ZBA sweep (balanced matrix-row journal pair)',   '1.32.0'),
  ('cash.sweep.void',      'Void a recorded (not yet posted) ZBA sweep',                     '1.32.0'),
  ('cash.fpoffset.create', 'Create a floorplan-offset allocation of an entered statement figure', '1.32.0'),
  ('cash.fpoffset.view',   'View floorplan-offset allocations',                              '1.32.0'),
  ('cash.fpoffset.post',   'Post a floorplan-offset allocation',                             '1.32.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('cash.sweep.config'), ('cash.sweep.record'), ('cash.sweep.view'), ('cash.sweep.post'), ('cash.sweep.void'),
  ('cash.fpoffset.create'), ('cash.fpoffset.view'), ('cash.fpoffset.post')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('cash.sweep.view'), ('cash.fpoffset.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
