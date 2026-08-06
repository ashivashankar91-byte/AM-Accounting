-- S009 Statement Metadata & COA Governance permission catalog extension
-- (gl-service ownership, per S009_DECISION_MEMO.md).
--
-- Adds the two permission keys required to manage effective-dated
-- statement-line/statement-metadata mappings:
--   - gl.statement_line.manage: create/update/deactivate the statement-line
--     catalog itself (StatementLine rows -- the presentation taxonomy).
--   - gl.statement_metadata.manage: create effective-dated reclassification/
--     mapping history entries on a GL account (GLAccountStatementLineHistory
--     rows) -- requires effective period, reason, and authenticated actor
--     per BLK-09 (Option 2, fully effective-dated, prospective).
-- Both are write/governance permissions distinct from the existing
-- read-only report.fs.view (S227) permission, granted only to
-- CONTROLLER/ADMIN, matching the existing gl.ledger.manage /
-- fiscal.period.soft_close precedent (governance authority sits with
-- Controller/Admin, not Accountant/Clerk).
-- Additive-only. No existing key or grant is modified or removed.

-- R1 Controlled Integration renumbering: this migration originally declared
-- catalog_version 1.11.0, but S003's auth migration
-- (20260728120000_extend_authz_catalog_s003_elimination_entity) was
-- integrated first and already claims 1.11.0. Renumbered to 1.12.0 to avoid
-- a silent ON CONFLICT DO NOTHING collision on the catalog_version row.
INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.12.0', 'S009 Statement Metadata & COA Governance: gl.statement_line.manage and gl.statement_metadata.manage permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('gl.statement_line.manage',      'Create/update/deactivate statement-line catalog entries (BS/IS presentation taxonomy)', '1.12.0'),
  ('gl.statement_metadata.manage',  'Create effective-dated GL account statement-line reclassification/mapping history (requires effective period, reason, actor)', '1.12.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('gl.statement_line.manage'),
  ('gl.statement_metadata.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
