-- S051 — NSF (returned-payment) Handling. Extends the permission catalog
-- with 3 apar-service permission keys: NSF view/record, and the
-- admin/test-only deposit-reconciled marker.
--
-- Role design: view/record are broad (ADMIN/CONTROLLER/ACCOUNTANT —
-- everyday AR operations, manual NSF entry). mark_deposit_reconciled_test_only
-- is restricted to ADMIN/CONTROLLER only — it is a documented PUTR
-- integration-boundary/test-only endpoint standing in for recon-service
-- (S054A/S054B) until that cross-service wiring exists, mirroring the
-- S045 ap.manual_payment.mark_cleared_test_only precedent exactly.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.38.0', 'S051: NSF (returned-payment) handling — 3 ar.nsf.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.nsf.view',                             'View NSF (returned-payment) events',                                                              '1.38.0'),
  ('ar.nsf.record',                           'Record a returned-payment (NSF) event (manual entry; reverses the original receipt application)',  '1.38.0'),
  ('ar.nsf.mark_deposit_reconciled_test_only','Test/admin-only: mark an AR entry''s deposit reconciled (PUTR boundary with recon-service S054A/S054B)', '1.38.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant including the test-only reconciled marker.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ar.nsf.view'),
  ('ar.nsf.record'),
  ('ar.nsf.mark_deposit_reconciled_test_only')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: everyday NSF view/record, but NOT the test-only reconciled marker.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', k
FROM (VALUES
  ('ar.nsf.view'),
  ('ar.nsf.record')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
