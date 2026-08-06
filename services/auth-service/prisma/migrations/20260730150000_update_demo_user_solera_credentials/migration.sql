-- Runtime stabilization: switch the demo login credentials (dev-user,
-- acct-user) to simpler SOLERA-branded email/password for easier manual
-- demo access. Tenant ID is left unchanged (tenant-kunes) since it is a
-- real primary key referenced across every service's schema (RLS policies,
-- foreign keys) -- renaming it would require a much larger, higher-risk
-- migration across the whole system, not just a credential change.
--
-- Demo credentials (tenant-kunes):
--   solera-admin@solera.demo / SOLERA  (ADMIN)
--   solera-acct@solera.demo  / SOLERA  (ACCOUNTANT)
UPDATE "user" SET "email" = 'solera-admin@solera.demo',
  "password_hash" = '$2a$10$nuJr3A/dfssflukOWyYeAu5CJddKp0iY1cooe.XpR979GsVbkDnXi'
  WHERE "id" = 'dev-user';
UPDATE "user" SET "email" = 'solera-acct@solera.demo',
  "password_hash" = '$2a$10$nuJr3A/dfssflukOWyYeAu5CJddKp0iY1cooe.XpR979GsVbkDnXi'
  WHERE "id" = 'acct-user';
