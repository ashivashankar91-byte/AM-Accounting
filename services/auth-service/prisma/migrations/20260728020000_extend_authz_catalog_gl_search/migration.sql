-- R0 Golden Fleet: extend the S207 permission catalog with the S221
-- (GL Search) permission key.
--
-- S221's approved Story Contract (GOLDEN_R0_STORY_CONTRACT_MATRIX.md field
-- 17) lists a single permission, `inquiry.search`. Per PO instruction to
-- "freeze and reuse the approved S220 inquiry result contract for S221",
-- this permission is granted to the exact same role set as S220's
-- `inquiry.account.view` -- ADMIN/CONTROLLER/ACCOUNTANT -- rather than a
-- newly invented set, since S221 (cross-account search across the whole
-- ledger) is at least as broad a read surface as S220 (single-account
-- inquiry) and no approved contract establishes a narrower or wider grant
-- for it. CLERK is deliberately excluded for the same documented reason as
-- S220: this exposes a broader cross-store/cross-department read surface
-- than a single posted JE.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.7.0', 'Golden-R0 Fleet: inquiry.search (S221 GL Search) permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('inquiry.search', 'Search across the whole ledger by amount, date range, source, memo, poster, and reference/control number, with drill-down into GL Account Activity Inquiry (S220)', '1.7.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'inquiry.search'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;
