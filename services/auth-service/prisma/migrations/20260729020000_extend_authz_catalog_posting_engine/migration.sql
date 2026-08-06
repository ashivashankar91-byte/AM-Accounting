-- S019/S020 Posting Engine permission catalog extension.
--
-- Adds the six permission keys required by the certification posting slice:
--   - posting_engine.rule_pack.view:     view rule packs/versions/history.
--   - posting_engine.rule_pack.edit:     create/edit a DRAFT rule pack version.
--   - posting_engine.rule_pack.validate: run structural/semantic validation
--     against a draft (non-destructive — read of reference data only).
--   - posting_engine.rule_pack.activate: activate an eligible VALIDATED
--     version (ADMIN only — matches the fiscal.period.lock precedent:
--     the highest-risk, hardest-to-reverse transition in its lifecycle).
--   - posting_engine.execution.view:     view posting executions.
--   - posting_engine.exception.view:     view durable posting exceptions
--     (no-rule-match / identity-conflict records).
-- Additive-only. No existing key or grant is modified or removed.
--
-- R1 Controlled Integration renumbering: this migration originally declared
-- catalog_version 1.13.0, but S011's auth migration
-- (20260728070000_extend_authz_catalog_analysis_codes) and S032's corrective
-- pass (20260729010000_revoke_je_template_manage_from_accountant, 1.15.0)
-- were both integrated first, and 1.13.0 is already claimed. Renumbered to
-- 1.16.0 — the next free slot after this branch's highest integrated
-- version (1.15.0) — to avoid a silent ON CONFLICT DO NOTHING collision on
-- the catalog_version row, the same way S009 renumbered itself around S003.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.16.0', 'S019/S020 Posting Engine: rule_pack.view/edit/validate/activate and execution.view/exception.view permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting_engine.rule_pack.view',     'View posting-engine rule packs, versions, and version history',                 '1.16.0'),
  ('posting_engine.rule_pack.edit',     'Create or edit a DRAFT posting-engine rule pack version',                       '1.16.0'),
  ('posting_engine.rule_pack.validate', 'Run structural/semantic/balance validation against a posting-engine rule pack version', '1.16.0'),
  ('posting_engine.rule_pack.activate', 'Activate an eligible VALIDATED posting-engine rule pack version (immutable thereafter)', '1.16.0'),
  ('posting_engine.execution.view',     'View posting-engine executions (posted, duplicate, no-rule-match, identity-conflict, rejected)', '1.16.0'),
  ('posting_engine.exception.view',     'View durable posting-engine exceptions (no-rule-match / identity-conflict records)', '1.16.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER + ACCOUNTANT: read-only / non-destructive actions.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('posting_engine.rule_pack.view'),
  ('posting_engine.rule_pack.validate'),
  ('posting_engine.execution.view'),
  ('posting_engine.exception.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN + CONTROLLER: rule-pack authoring (configuration authority),
-- matching the gl.statement_metadata.manage / acct.entity.elimination_configure
-- precedent (Controller/Admin, not Accountant/Clerk).
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('posting_engine.rule_pack.edit')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN only: activation is the highest-risk, hardest-to-reverse transition
-- (immutable thereafter) — matches the fiscal.period.lock precedent.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'posting_engine.rule_pack.activate')
ON CONFLICT ("role", "permission_key") DO NOTHING;
