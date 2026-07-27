-- GL-service onboarding: centralize the permission keys used by the legacy
-- GL stack's new createAuthzGuard wiring. Keys are intentionally few and route-
-- aligned: dashboard reads, general ledger reads, ledger mutations, and admin/
-- configuration mutations. No CLERK or OFFICE_MGR grant is added without an
-- approved contract precedent.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.6.0', 'Golden-R0 Fleet: gl.dashboard.view / gl.ledger.view / gl.ledger.manage / gl.admin.manage for gl-service onboarding.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('gl.dashboard.view', 'View GL dashboard, command-center and ESG summary surfaces', '1.6.0'),
  ('gl.ledger.view', 'View GL accounts, journals, inquiries, statements and other read-only ledger surfaces', '1.6.0'),
  ('gl.ledger.manage', 'Create and mutate GL journals and other non-admin GL operational records', '1.6.0'),
  ('gl.admin.manage', 'Manage GL admin/configuration surfaces such as sources, templates, mappings and system configuration', '1.6.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('gl.dashboard.view'),
  ('gl.ledger.view'),
  ('gl.ledger.manage'),
  ('gl.admin.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ACCOUNTANT', 'gl.dashboard.view'),
  ('ACCOUNTANT', 'gl.ledger.view'),
  ('ACCOUNTANT', 'gl.ledger.manage')
ON CONFLICT ("role", "permission_key") DO NOTHING;
