-- CE-16 Accounting Migration epic — authz permission catalog extension.
--
-- Stories: S129 (item-level schedule migration & gates), S130 (TB conversion &
-- COA mapping workbench), S131 (parallel-run comparison harness),
-- S132 (statement archive import & runbooks).
--
-- The tier is deliberately split finer than "read / write". Migration carries
-- three irreversible authorities that must never collapse into one role:
--
--   migration.mapping.manage   vs  migration.mapping.approve
--       -- whoever decides a mapping may not approve their own decision.
--
--   migration.cutover.prepare  vs  migration.cutover.approve
--       -- preparation is not approval. The preparer is refused final
--          approval by the ceremony itself, and the grants below make that
--          separation structural rather than merely procedural.
--
--   migration.sensitive.view
--       -- unmasked legacy payload fields (tax ids, bank details) are a
--          separate grant from ordinary staging read, so an operator can run
--          a migration without ever seeing clear-text sensitive data.
--
-- Additive only. No existing keys removed. No existing grants removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.31.0', 'CE-16 Accounting Migration epic: migration.* permission tier (24 keys) — source/mapping/staging/validation/exception/reconcile/cutover/rollback authorities with dual SoD boundaries.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('migration.source.view',         'View registered legacy source systems and their configuration status',            '1.31.0'),
  ('migration.source.register',     'Register a legacy source system for migration',                                   '1.31.0'),
  ('migration.extract.read',        'Read source snapshots, files and extracted rows',                                 '1.31.0'),
  ('migration.extract.import',      'Import a source extract into controlled migration staging',                       '1.31.0'),
  ('migration.mapping.view',        'View COA mapping sets, entries and coverage meter',                               '1.31.0'),
  ('migration.mapping.manage',      'Create mapping sets and record ALIGN/MAP/DIVERGE decisions (SoD: cannot approve own decision)', '1.31.0'),
  ('migration.mapping.approve',     'Approve mapping decisions and freeze a mapping set version',                      '1.31.0'),
  ('migration.staging.read',        'Read staged datasets, staged rows and transformation previews',                   '1.31.0'),
  ('migration.staging.execute',     'Execute staging and financial promotion through governed posting',                '1.31.0'),
  ('migration.validation.read',     'Read gate results G1-G5 for a migration run',                                     '1.31.0'),
  ('migration.validation.execute',  'Evaluate gates G1-G5 against staged datasets',                                    '1.31.0'),
  ('migration.exception.view',      'View the migration exception queue',                                              '1.31.0'),
  ('migration.exception.disposition','Disposition migration exceptions with documented reason',                        '1.31.0'),
  ('migration.reconcile.view',      'View control totals, parallel-run comparisons and differences',                   '1.31.0'),
  ('migration.reconcile.execute',   'Run parallel-run comparisons, classify differences and sign off a period',        '1.31.0'),
  ('migration.rehearsal.execute',   'Execute a rehearsal migration run against an isolated target',                    '1.31.0'),
  ('migration.cutover.prepare',     'Prepare a cutover ceremony and attest the legacy source freeze (SoD: cannot approve)', '1.31.0'),
  ('migration.cutover.approve',     'Grant final cutover approval acknowledging irreversible effect (SoD: cannot be the preparer)', '1.31.0'),
  ('migration.cutover.execute',     'Execute an approved cutover ceremony',                                            '1.31.0'),
  ('migration.rollback.execute',    'Execute a governed migration rollback including financial reversal entries',      '1.31.0'),
  ('migration.audit.view',          'View migration lineage, run audit trail and archived legacy statements',          '1.31.0'),
  ('migration.sensitive.view',      'View unmasked sensitive fields in legacy source and staged payloads',             '1.31.0'),
  ('migration.run.read',            'View migration runs, readiness and runbook instances',                            '1.31.0'),
  ('migration.run.create',          'Create migration runs and manage runbook instances',                              '1.31.0')
ON CONFLICT ("key") DO NOTHING;

-- ── Role grants ───────────────────────────────────────────────────────────────

-- READ-BROAD: ADMIN, CONTROLLER, ACCOUNTANT may observe a migration in flight.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('migration.source.view'),
  ('migration.extract.read'),
  ('migration.mapping.view'),
  ('migration.staging.read'),
  ('migration.validation.read'),
  ('migration.exception.view'),
  ('migration.reconcile.view'),
  ('migration.run.read')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- OPERATOR AUTHORITIES: ADMIN + CONTROLLER run the migration machinery.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('migration.source.register'),
  ('migration.extract.import'),
  ('migration.mapping.manage'),
  ('migration.staging.execute'),
  ('migration.validation.execute'),
  ('migration.exception.disposition'),
  ('migration.reconcile.execute'),
  ('migration.rehearsal.execute'),
  ('migration.run.create'),
  ('migration.audit.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Mapping approval: CONTROLLER only. Held apart from migration.mapping.manage
-- so the identity that classified an account is structurally unable to also
-- approve it under the default role model.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'migration.mapping.approve')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Cutover preparation: CONTROLLER prepares the ceremony and attests the freeze.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'migration.cutover.prepare')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Final cutover approval and execution: ADMIN only, and never granted to the
-- preparer role. Combined with the ceremony's own preparer != approver check,
-- a single identity cannot carry a migration into production alone.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ADMIN', p.permission_key
FROM (VALUES
  ('migration.cutover.approve'),
  ('migration.cutover.execute'),
  ('migration.rollback.execute')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Unmasked sensitive legacy data: ADMIN only.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'migration.sensitive.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN also carries cutover preparation so a single-admin tenant can stage a
-- ceremony; the preparer != approver check still applies at execution time.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'migration.cutover.prepare')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- No AUDITOR grants are emitted here. No AUDITOR role exists in this
-- repository yet (see 20260727000002_extend_authz_catalog_org_and_audit_history),
-- and inventing one in a migration migration would create a role that nothing
-- assigns. Read-only auditor visibility over migration.audit.view remains a
-- documented gap rather than a silently fabricated grant.
