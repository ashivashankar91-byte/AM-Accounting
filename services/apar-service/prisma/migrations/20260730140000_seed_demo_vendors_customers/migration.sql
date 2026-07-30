-- Runtime stabilization: minimum demo vendors/customers so AP/AR inquiry,
-- vendor invoice entry (S039) and cash-receipt-linked AR flows have real
-- master records to reference (previously vendors/customers were empty).
-- id is a real `uuid` column (default gen_random_uuid()) — unlike most
-- other seed migrations in this repo, human-readable ids are NOT valid
-- here; omit id and let the column default generate one.
INSERT INTO "vendors"
  ("tenant_id", "vendor_number", "normalized_vendor_number", "vendor_name", "normalized_vendor_name", "vendor_type", "city", "state", "status")
VALUES
  ('tenant-kunes', 'V0001', 'V0001', 'ADESA Auto Auction',      'adesa auto auction',      'SUPPLIER', 'Milwaukee', 'WI', 'ACTIVE'),
  ('tenant-kunes', 'V0002', 'V0002', 'Snap-on Tools Corp',      'snap-on tools corp',      'SUPPLIER', 'Kenosha',   'WI', 'ACTIVE')
ON CONFLICT ("tenant_id", "vendor_number") DO NOTHING;

INSERT INTO "customers"
  ("tenant_id", "customer_number", "normalized_customer_number", "customer_name", "normalized_customer_name", "customer_type", "city", "state", "status")
VALUES
  ('tenant-kunes', 'C0001', 'C0001', 'Jane Miller',                     'jane miller',                     'Individual', 'Delavan', 'WI', 'ACTIVE'),
  ('tenant-kunes', 'C0002', 'C0002', 'Rock County Fleet Services LLC',  'rock county fleet services llc',  'Fleet',      'Delavan', 'WI', 'ACTIVE')
ON CONFLICT ("tenant_id", "customer_number") DO NOTHING;
