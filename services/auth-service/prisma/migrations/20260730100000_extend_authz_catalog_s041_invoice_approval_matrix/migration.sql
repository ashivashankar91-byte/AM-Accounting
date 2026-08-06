-- AMACC-CH04 S041: Invoice Approval Matrix — permission catalog extension.
-- Per the S036A/S038/S039 catalog-extension precedent, a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists here AND is granted to at
-- least one role.
--
-- ap.invoice_approval.configure (defining the matrix's dollar tiers) and
-- ap.invoice_approval.retry_gl_posting are ADMIN/CONTROLLER-only —
-- mirrors the sensitive-action precedent (ap.vendor.delete,
-- ap.invoice.void). ap.invoice_approval.approve/reject are granted to
-- ADMIN, CONTROLLER and ACCOUNTANT — the approval matrix's own
-- requiredRole check (enforced in InvoiceApprovalService, not here) is
-- what actually restricts which specific role may act on a given tier;
-- this permission grant only gates "can this user participate in
-- approvals at all" the same way ap.invoice.submit gates submission.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.25.0', 'AMACC-CH04 S041: ap.invoice_approval.* permission keys for the invoice approval matrix.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.invoice_approval.view',              'View invoice approval rules and approval instance/step history', '1.25.0'),
  ('ap.invoice_approval.configure',         'Configure the tenant''s invoice approval matrix (threshold/role tiers)', '1.25.0'),
  ('ap.invoice_approval.start',             'Start the approval workflow for a submitted vendor invoice', '1.25.0'),
  ('ap.invoice_approval.approve',           'Approve the current tier of a vendor invoice''s approval instance', '1.25.0'),
  ('ap.invoice_approval.reject',            'Reject a vendor invoice''s approval instance', '1.25.0'),
  ('ap.invoice_approval.retry_gl_posting',  'Retry posting the AP liability GL entry for an approved invoice', '1.25.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.invoice_approval.view'),
  ('ap.invoice_approval.start'),
  ('ap.invoice_approval.approve'),
  ('ap.invoice_approval.reject')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.invoice_approval.configure'),
  ('ap.invoice_approval.retry_gl_posting')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;
