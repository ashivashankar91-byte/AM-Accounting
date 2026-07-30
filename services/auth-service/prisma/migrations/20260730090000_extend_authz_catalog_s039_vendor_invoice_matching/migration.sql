-- AMACC-CH04 S039: AP Invoice Entry & 2/3-Way Match — permission catalog
-- extension. Per the S036A/S038/S046 catalog-extension precedent, a
-- route-level createAuthzGuard() check is worthless against the real
-- HttpAuthzClient unless the permission key actually exists here AND is
-- granted to at least one role.
--
-- ap.invoice.match_override, ap.invoice.void and ap.invoice.audit_view are
-- restricted to ADMIN/CONTROLLER only (sensitive: bypassing a match
-- exception, voiding an invoice, viewing full audit history) — mirrors the
-- S036A precedent for ap.vendor.delete/audit_view.
-- ap.invoice.duplicate_override is also ADMIN/CONTROLLER-only, mirroring
-- ap.vendor.duplicate_override.
-- ap.invoice.view/create/edit/match/submit and the goods-receipt
-- view/create keys are granted to ACCOUNTANT as well (matches the
-- read/write-broad pattern already used for ap.vendor.view/create/edit).
-- ap.goods_receipt.void is ADMIN/CONTROLLER-only, mirroring ap.invoice.void.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.24.0', 'AMACC-CH04 S039: ap.invoice.* and ap.goods_receipt.* permission keys for AP invoice entry and 2/3-way matching.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.invoice.view',               'View vendor invoices, lines and match history', '1.24.0'),
  ('ap.invoice.create',             'Create a new vendor invoice (DRAFT)', '1.24.0'),
  ('ap.invoice.edit',               'Edit a DRAFT vendor invoice''s lines/fields', '1.24.0'),
  ('ap.invoice.match',              'Run 2-way/3-way match on a vendor invoice', '1.24.0'),
  ('ap.invoice.match_override',     'Submit a vendor invoice despite an unresolved match exception', '1.24.0'),
  ('ap.invoice.submit',             'Submit a vendor invoice for approval (hand-off to S041)', '1.24.0'),
  ('ap.invoice.void',               'Void a vendor invoice', '1.24.0'),
  ('ap.invoice.duplicate_override', 'Create a vendor invoice despite a duplicate invoice-number warning', '1.24.0'),
  ('ap.invoice.audit_view',         'View a vendor invoice''s audit/history timeline', '1.24.0'),
  ('ap.goods_receipt.view',         'View goods receipts against a purchase order', '1.24.0'),
  ('ap.goods_receipt.create',       'Record a goods receipt against a purchase order', '1.24.0'),
  ('ap.goods_receipt.void',         'Void a goods receipt', '1.24.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.invoice.view'),
  ('ap.invoice.create'),
  ('ap.invoice.edit'),
  ('ap.invoice.match'),
  ('ap.invoice.submit'),
  ('ap.goods_receipt.view'),
  ('ap.goods_receipt.create')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.invoice.match_override'),
  ('ap.invoice.void'),
  ('ap.invoice.duplicate_override'),
  ('ap.invoice.audit_view'),
  ('ap.goods_receipt.void')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
