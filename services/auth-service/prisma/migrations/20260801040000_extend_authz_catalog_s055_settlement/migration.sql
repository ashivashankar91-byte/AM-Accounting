-- S055 — Merchant Settlement Reconciliation. Extends the permission catalog
-- with 6 cash-service permission keys for settlement batch import/match/
-- post and chargeback intake/disposition. Follows the S052/S053 precedent
-- exactly: keys seeded here BEFORE cash-service's settlement routes are
-- wired.
--
-- Role design: back-office (controller-level) actions only, matching
-- S053's deposit permission design — no CASHIER grants. Chargeback
-- disposition is a distinct, narrower permission from chargeback intake
-- (separation of duties: the person who intakes a chargeback need not be
-- the one who dispositions it), matching the ADMIN/CONTROLLER-only pattern
-- used for other governed-adjustment actions in this catalog.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.31.0', 'S055: merchant settlement reconciliation — 6 cash.settlement.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('cash.settlement.import',                'Import a merchant card-settlement batch',                    '1.31.0'),
  ('cash.settlement.view',                  'View/search settlement batches, worklist, and chargebacks',  '1.31.0'),
  ('cash.settlement.match',                 'Match settlement lines to receipts/deposits; manage worklist','1.31.0'),
  ('cash.settlement.post',                  'Post a settlement batch (fee recognition journal)',          '1.31.0'),
  ('cash.settlement.chargeback_intake',     'Record chargeback intake against a settlement batch',        '1.31.0'),
  ('cash.settlement.chargeback_disposition','Disposition a chargeback (customer-responsibility or merchant-absorbed)', '1.31.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('cash.settlement.import'), ('cash.settlement.view'), ('cash.settlement.match'), ('cash.settlement.post'),
  ('cash.settlement.chargeback_intake'), ('cash.settlement.chargeback_disposition')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('cash.settlement.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;
