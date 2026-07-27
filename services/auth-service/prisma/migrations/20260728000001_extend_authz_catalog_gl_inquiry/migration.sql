-- R0 Golden Fleet: extend the S207 permission catalog with the S220
-- (GL Account Activity Inquiry) permission key.
--
-- Per the S004A/S224 catalog-extension precedent (see
-- 20260727000002_extend_authz_catalog_org_and_audit_history), a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists in this catalog and is granted
-- to at least one role — otherwise every caller, including ADMIN, is denied.
-- Seeded here BEFORE the coa-service route is wired, to avoid repeating that
-- defect class a third time.
--
-- S220's approved Story Contract lists a single permission,
-- `inquiry.account.view` (view + CSV export share the same permission — no
-- separate export permission is defined in the approved contract, so none is
-- invented here). Granted to the exact same role set already holding
-- `je.view` — ADMIN/CONTROLLER/ACCOUNTANT (see
-- 20260726000001_extend_authz_catalog_r0_stabilization) — rather than a
-- newly invented set. CLERK, which also holds je.view, is deliberately
-- excluded: GL Inquiry exposes cross-store/cross-department account totals
-- (beginning/ending balance, full period activity), a broader read surface
-- than a single posted JE, and no approved contract or shipped role grant
-- establishes CLERK access to it. This is a documented scope decision, not
-- an oversight.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.5.0', 'Golden-R0 Fleet: inquiry.account.view (S220 GL Account Activity Inquiry) permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('inquiry.account.view', 'View a GL account''s beginning balance, period activity and ending balance, and export it as CSV', '1.5.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'inquiry.account.view'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;
