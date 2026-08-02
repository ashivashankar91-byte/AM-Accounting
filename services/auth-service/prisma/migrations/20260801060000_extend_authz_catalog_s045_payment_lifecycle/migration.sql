-- CE-09 S045: Void/Stop/Reissue & Check Escheat — permission catalog extension.
-- Per the S036A/S038/S039/S041/S043A/S042 catalog-extension precedent, a
-- route-level createAuthzGuard() check is worthless against the real
-- HttpAuthzClient unless the permission key actually exists here AND is
-- granted to at least one role.
--
-- ap.payment_lifecycle.mark_cleared_test_only is intentionally restricted
-- to ADMIN/CONTROLLER ONLY — it is a documented PUTR (Point Until The Real
-- thing) integration boundary standing in for recon-service (S054A/S054B)
-- until that cross-service wiring exists, and must never be reachable by
-- an ordinary AP clerk/accountant.
--
-- ap.payment_lifecycle.stop_payment_resolve (recording a bank
-- acknowledgement/outcome) is ADMIN/CONTROLLER only, mirroring the
-- higher-authority precedent used elsewhere for outcome-recording actions.
--
-- All other new keys (reissue, stop-payment request, escheat view/due-
-- diligence/transfer) are ADMIN/CONTROLLER/ACCOUNTANT, matching the broad
-- AP-clerk-level grant precedent used for ap.manual_payment.create and
-- ap.use_tax.assess.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.33.0', 'CE-09 S045: ap.payment_lifecycle.* permission keys for void/stop/reissue/escheat.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.payment_lifecycle.mark_cleared_test_only', 'Admin/test-only: mark a manual payment cleared/reconciled (PUTR boundary with recon-service S054A/S054B)', '1.33.0'),
  ('ap.payment_lifecycle.reissue',                'Reissue a new payment linked to a voided original manual payment', '1.33.0'),
  ('ap.payment_lifecycle.stop_payment_request',    'Request a stop-payment on an outstanding manual payment', '1.33.0'),
  ('ap.payment_lifecycle.stop_payment_resolve',    'Resolve a stop-payment request with a bank acknowledgement outcome', '1.33.0'),
  ('ap.payment_lifecycle.escheat_view',            'View the escheat aging queue and due-diligence history', '1.33.0'),
  ('ap.payment_lifecycle.escheat_due_diligence',   'Record a due-diligence attempt against an outstanding check', '1.33.0'),
  ('ap.payment_lifecycle.escheat_transfer',         'Post an escheat transfer for an outstanding check (requires jurisdiction timing configuration)', '1.33.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.payment_lifecycle.mark_cleared_test_only'),
  ('ap.payment_lifecycle.stop_payment_resolve')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.payment_lifecycle.reissue'),
  ('ap.payment_lifecycle.stop_payment_request'),
  ('ap.payment_lifecycle.escheat_view'),
  ('ap.payment_lifecycle.escheat_due_diligence'),
  ('ap.payment_lifecycle.escheat_transfer')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
