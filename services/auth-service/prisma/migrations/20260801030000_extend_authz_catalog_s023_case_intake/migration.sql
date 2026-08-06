-- CE-07 / S023 (D-S023-23) — new permission for posting-recovery-service's
-- real production case-intake endpoint (POST /dead-letters), which
-- previously had no non-fixture entry point at all. Gated normally like
-- every other posting-recovery.* route; the genuine caller is
-- coa-service's posting engine authenticating with a signature-verified
-- SERVICE-role JWT, which already bypasses per-user RBAC in
-- createAuthzGuard — this permission still exists so an ordinary
-- authenticated (non-SERVICE) caller without it is denied normally, rather
-- than the route being left ungated. ADMIN also granted for manual/support
-- case creation. Additive-only.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-07/S023: posting-recovery.case.create permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting-recovery.case.create', 'Create or update a posting-recovery dead-letter case from a real posting-engine failure', '1.30.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'posting-recovery.case.create')
ON CONFLICT ("role", "permission_key") DO NOTHING;
