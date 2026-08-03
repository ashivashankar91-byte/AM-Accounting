-- CE-13 gap-closure follow-up — dedicated permission keys for the CE-09
-- payment-handoff surface, replacing the payroll.batch.* reuse from the
-- prior integration pass. Additive-only — no existing key, grant, or role
-- removed or altered.
--
-- payroll.audit.view is NOT redefined here: it already exists and is
-- already role-granted to ADMIN/CONTROLLER/ACCOUNTANT by
-- 20260803000000_add_ce13_payroll_permissions — what was missing was a
-- real route to enforce it against, now wired
-- (services/payroll-service/src/http/ce13-routes.ts's GET /audit +
-- security.ts's resolvePayrollPermission). No catalog change needed for it.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.44.0', 'CE-13 payroll gap-closure: dedicated payment-handoff inquiry/manage permission keys (replaces payroll.batch.* reuse).')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('payroll.payment_handoff.view',   'View CE-09 payroll payment-handoff records and status', '1.44.0'),
  ('payroll.payment_handoff.manage', 'Mark a payroll payment handoff transmitted, settle it against verified CE-09 evidence, or void it', '1.44.0')
ON CONFLICT ("key") DO NOTHING;

-- View-only tier: ADMIN/CONTROLLER/ACCOUNTANT — matches every other
-- payroll.*.view key's existing tiering (20260803000000_add_ce13_payroll_permissions).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('payroll.payment_handoff.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Mutating tier (financially consequential — transmit/settle/void a real
-- payment handoff): ADMIN/CONTROLLER only, matching payroll.batch.void_reverse's tier.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('payroll.payment_handoff.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
