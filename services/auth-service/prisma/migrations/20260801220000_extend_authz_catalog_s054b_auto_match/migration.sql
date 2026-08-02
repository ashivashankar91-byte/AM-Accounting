-- S054B — Rule-Based Bank Auto-Match. Extends the permission catalog with
-- 4 recon-service permission keys covering: tenant match-rule
-- configuration, running the auto-match engine against a session,
-- viewing the resulting suggestion worklist, and resolving (confirm/
-- reject) a suggestion. Gated on S054A's recon.session.* permissions
-- (a session must already be viewable/matchable). Follows the
-- S052/S053/S055/S056/S057/S054A precedent exactly.
--
-- Role design: RULE_CONFIG (defines what auto-clears money-adjacent
-- lines) and RUN/RESOLVE (execute or confirm/reject clearing actions) are
-- restricted to ADMIN/CONTROLLER; SUGGESTION_VIEW is broad (ADMIN/
-- CONTROLLER/SUPERVISOR — read-only oversight of the worklist).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.38.0', 'S054B: rule-based bank auto-match — 4 recon.matchrule.*/recon.automatch.*/recon.suggestion.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('recon.matchrule.config',   'Create and list tenant-configurable bank auto-match rules',                 '1.38.0'),
  ('recon.automatch.run',      'Run the rule-based auto-match engine against a reconciliation session',     '1.38.0'),
  ('recon.suggestion.view',    'View the auto-match suggestion worklist for a reconciliation session',      '1.38.0'),
  ('recon.suggestion.resolve', 'Confirm or reject a pending auto-match suggestion',                         '1.38.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('recon.matchrule.config'), ('recon.automatch.run'), ('recon.suggestion.view'), ('recon.suggestion.resolve')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight of the suggestion worklist.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('recon.suggestion.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
