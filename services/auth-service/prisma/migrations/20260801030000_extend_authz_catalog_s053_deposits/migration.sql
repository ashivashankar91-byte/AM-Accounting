-- S053 — Deposit Workflow & Bank Feed Match. Extends the permission catalog
-- with 6 cash-service permission keys for deposit batches and bank-feed
-- import/match. Follows the S052 precedent exactly (20260729050000_extend_
-- authz_catalog_s052_cash_receipts): keys seeded here BEFORE cash-service's
-- deposit routes are wired, so createAuthzGuard() checks are never
-- worthless-against-a-missing-key.
--
-- Role design: CASHIER/SUPERVISOR do not get deposit-post or bank-feed
-- keys by default — deposit preparation/posting and bank-feed import/match
-- are back-office (controller-level) actions in this package's scope, not
-- POS/cashier actions. ADMIN/CONTROLLER get every key, matching the
-- existing broadest-grant precedent (e.g. je.post, cash.receipt.*).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- Renumbered 1.29.0 -> 1.30.0 (folder moved 20260801010000 -> 20260801030000):
-- a concurrently-landed migration (20260801010000_extend_authz_catalog_s042_use_tax,
-- CE-09 S042 use-tax) already claims catalog_version 1.29.0 and the identical
-- folder timestamp. Same collision-avoidance precedent as S052/S009/S036A's
-- prior renumberings noted in their own migration headers.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'S053: deposit workflow and bank feed match — 6 cash.deposit.*/cash.bankfeed.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('cash.deposit.create',    'Create a deposit batch from undeposited cash receipts', '1.30.0'),
  ('cash.deposit.view',      'View/search deposit batches and deposit slips',         '1.30.0'),
  ('cash.deposit.post',      'Post a deposit batch (clearing to cash)',               '1.30.0'),
  ('cash.deposit.void',      'Void an unposted deposit batch',                        '1.30.0'),
  ('cash.bankfeed.import',   'Import a bank feed/statement line (manual or feed)',    '1.30.0'),
  ('cash.bankfeed.match',    'Match a bank feed line to a deposit or receipt',        '1.30.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('cash.deposit.create'), ('cash.deposit.view'), ('cash.deposit.post'), ('cash.deposit.void'),
  ('cash.bankfeed.import'), ('cash.bankfeed.match')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight of deposits/bank-feed, matching its
-- existing oversight-only design from the S052 catalog migration.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('cash.deposit.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
