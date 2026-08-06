-- CE-12 gap-closure — deal-accounting-service due-bill/we-owe permission
-- keys. Same additive-only precedent as 20260802040000_extend_authz_
-- catalog_ce12_deal_accounting: a route-level createAuthzGuard() check is
-- worthless against the real HttpAuthzClient unless the key exists here AND
-- is granted to at least one role. Tiering: routine intake ceremony (not a
-- release/reversal/override action) -> ADMIN/CONTROLLER/ACCOUNTANT, matching
-- deal_accounting.cit.fund / deal_accounting.deal.finalize precedent.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.34.0', 'CE-12 gap-closure: deal_accounting.duebill.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('deal_accounting.duebill.record', 'Record a due-bill/we-owe obligation against a deal — posts a real journal (schedule 91)', '1.34.0'),
  ('deal_accounting.duebill.view',   'View due-bill/we-owe items recorded against deals', '1.34.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('deal_accounting.duebill.record'),
  ('deal_accounting.duebill.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
