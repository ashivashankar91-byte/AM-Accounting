-- R0 Stabilization Phase 3: extend the S207 permission catalog to cover the
-- coa-service and journal-lifecycle permission keys that were, until now,
-- only enforced by 9 duplicated local stub route maps (never registered
-- centrally). Additive-only. No destructive DDL, no key removed, no existing
-- grant removed. Every key/grant here already existed as a documented
-- keyRules/perm string in MODULE_STATE.json or as shipped local-stub
-- behavior in services/coa-service/src/http/*.ts — this migration centralizes
-- what was already the design intent; it does not invent new authority.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.3.0', 'R0 Stabilization Phase 3: coa-service + journal-lifecycle permission keys, centralizing the 9 coa-service local stub route maps into the S207 catalog.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('coa.account.view',      'View chart-of-accounts entries',                     '1.3.0'),
  ('coa.account.manage',    'Create / edit / deactivate accounts, reparent tree', '1.3.0'),
  ('config.view',           'View configuration settings',                        '1.3.0'),
  ('config.manage',         'Create / edit configuration settings',               '1.3.0'),
  ('je.draft.create',       'Create a manual journal draft',                      '1.3.0'),
  ('je.draft.edit',         'Edit / validate a manual journal draft',             '1.3.0'),
  ('je.draft.view_all',     'View drafts created by other preparers',             '1.3.0'),
  ('je.draft.void',         'Void own manual journal draft',                      '1.3.0'),
  ('je.draft.void.any',     'Void another preparer''s manual journal draft',      '1.3.0'),
  ('fiscal.calendar.view',  'View the fiscal calendar',                           '1.3.0'),
  ('fiscal.calendar.manage','Define / generate the fiscal calendar',              '1.3.0'),
  ('je.view',               'View a posted journal entry',                        '1.3.0'),
  ('je.reverse',            'Reverse a posted journal entry',                     '1.3.0'),
  ('fiscal.period.view',    'View accounting period status',                      '1.3.0'),
  ('fiscal.period.open',    'Open an accounting period',                          '1.3.0'),
  ('coa.seed.run',          'Run the canonical COA seed',                         '1.3.0'),
  ('je.gap_report.view',    'View the journal numbering gap report',              '1.3.0'),
  ('je.sequence.allocate',  'Allocate the next journal number (internal, posting path)', '1.3.0'),
  ('coa.source.manage',     'Create / edit / deactivate journal sources',         '1.3.0'),
  ('coa.source.view',       'View journal sources',                               '1.3.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full manage + view across every new coa-service key.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('coa.account.view'), ('coa.account.manage'),
  ('config.view'), ('config.manage'),
  ('je.draft.create'), ('je.draft.edit'), ('je.draft.view_all'), ('je.draft.void'),
  ('fiscal.calendar.view'), ('fiscal.calendar.manage'),
  ('je.view'), ('je.reverse'),
  ('fiscal.period.view'), ('fiscal.period.open'),
  ('coa.seed.run'),
  ('je.gap_report.view'), ('je.sequence.allocate'),
  ('coa.source.manage'), ('coa.source.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN only: void-any (matches JE_DRAFT_PERMISSIONS.VOID_ANY local grant).
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'je.draft.void.any')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view-only across most coa-service keys, matching local stubs exactly.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ACCOUNTANT', 'coa.account.view'),
  ('ACCOUNTANT', 'config.view'),
  ('ACCOUNTANT', 'je.draft.create'),
  ('ACCOUNTANT', 'je.draft.edit'),
  ('ACCOUNTANT', 'je.draft.void'),
  ('ACCOUNTANT', 'fiscal.calendar.view'),
  ('ACCOUNTANT', 'je.view'),
  ('ACCOUNTANT', 'je.reverse'),
  ('ACCOUNTANT', 'fiscal.period.view'),
  ('ACCOUNTANT', 'je.gap_report.view'),
  ('ACCOUNTANT', 'coa.source.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- CLERK: matches services/coa-service/src/http/draft-routes.ts and
-- journal-routes.ts local stubs (create/edit/void own drafts; view posted JEs).
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('CLERK', 'je.draft.create'),
  ('CLERK', 'je.draft.edit'),
  ('CLERK', 'je.draft.void'),
  ('CLERK', 'je.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ── Reconciliation: je.post / ACCOUNTANT ────────────────────────────────────────
-- je.post already existed in the catalog (v1.0.0), granted only to ADMIN/
-- CONTROLLER — seeded before the Journal Lifecycle package (S013/S216) was
-- built. S216's own story text ("the accountant hits Post on a validated
-- draft") and the local journal-routes.ts stub (already shipped, already
-- tested) both grant je.post to ACCOUNTANT. The catalog's original grant was
-- a stale assumption from an earlier sprint, not a deliberate restriction;
-- centralizing must not silently take posting ability away from accountants
-- who already have it in production today. Adding the grant (not removing
-- one) reconciles the catalog with shipped behavior. See
-- docs/accounting-modernization/stabilization/AUTHORIZATION_CLOSURE_REPORT.md
-- for the full evidence trail behind this decision.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ACCOUNTANT', 'je.post')
ON CONFLICT ("role", "permission_key") DO NOTHING;
