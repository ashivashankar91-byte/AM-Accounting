-- Runtime stabilization: bootstrap deterministic demo credentials.
-- 20260727010000_add_user_password_hash added the nullable password_hash
-- column and the S205 login route, but no migration ever populated it for
-- the two seed users (dev-user, acct-user) created in
-- 20260724000004_add_user_lifecycle. Without a password_hash, login()
-- always throws InvalidCredentialsError (401 UNAUTHORIZED) — there was no
-- way to actually authenticate as the demo tenant. This sets a known
-- bcrypt(10)-hashed password for both, consistent with the repo's existing
-- convention of embedding deterministic demo/seed data directly in
-- migrations (see 20260521000003_seed_automotive_coa,
-- 20260521000005_seed_intercompany, 20260724000004_add_user_lifecycle).
--
-- Demo credentials (tenant-kunes):
--   dev@kunes.example  / Kunes2026!  (ADMIN)
--   acct@kunes.example / Kunes2026!  (ACCOUNTANT)
UPDATE "user" SET "password_hash" = '$2a$10$.Xp2EE28NPF2Bwxc425BSu2sGQIakWgejwcyuXLydAhjA4Bys0QIS'
  WHERE "id" IN ('dev-user', 'acct-user') AND "password_hash" IS NULL;
