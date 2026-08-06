-- S043B — AP Payment Runs & Rails. Extends the permission catalog with 6
-- apar-service permission keys covering proposal, SoD-gated approval/
-- rejection, execution, and rail-artifact generation.
--
-- Role design: view/propose are broad (ADMIN/CONTROLLER/ACCOUNTANT — the
-- everyday proposal-building step). approve/reject/execute/generate_rail
-- are restricted to ADMIN/CONTROLLER — segregation of duties (D-CE09-01-
-- style: proposer != approver) is enforced in PaymentRunService.approveRun
-- itself via an identity comparison, not by this permission grant alone;
-- restricting the grant to a smaller set of roles is a defense-in-depth
-- measure on top of that server-side identity check, not a substitute
-- for it.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.39.0', 'S043B: AP Payment Runs & Rails — 6 ap.payment_run.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.payment_run.view',          'View AP payment runs, their items, and rail artifacts',                                            '1.39.0'),
  ('ap.payment_run.propose',       'Propose a new AP payment run (select invoices by due date / vendor filter, cash-requirement preview)', '1.39.0'),
  ('ap.payment_run.approve',       'Approve a proposed AP payment run (server-enforced SoD: approver must differ from the proposer)', '1.39.0'),
  ('ap.payment_run.reject',        'Reject a proposed AP payment run with a reason',                                                   '1.39.0'),
  ('ap.payment_run.execute',       'Execute an approved AP payment run (creates per-invoice payments; idempotent by run id)',          '1.39.0'),
  ('ap.payment_run.generate_rail', 'Generate a rail artifact (check-print, positive-pay, or ACH/NACHA file) for an executed run',      '1.39.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.payment_run.view'),
  ('ap.payment_run.propose'),
  ('ap.payment_run.approve'),
  ('ap.payment_run.reject'),
  ('ap.payment_run.execute'),
  ('ap.payment_run.generate_rail')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view/propose only — NOT approve/reject/execute/generate_rail
-- (defense-in-depth alongside the server-enforced SoD identity check).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', k
FROM (VALUES
  ('ap.payment_run.view'),
  ('ap.payment_run.propose')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
