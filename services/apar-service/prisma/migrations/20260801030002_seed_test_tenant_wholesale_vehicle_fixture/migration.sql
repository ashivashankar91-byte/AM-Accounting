-- CE-09 S048: TEST-TENANT certification fixture ONLY — never a production
-- default. Seeds a single OPEN wholesale vehicle AR item for the dedicated
-- certification tenant 'tenant-ce09-cert' so the title-release gate can be
-- exercised end-to-end in certification (paid-in-full auto-eligibility,
-- unpaid refusal, and the exception path) without any tenant supplying
-- real customer/VIN data.
INSERT INTO ar_wholesale_vehicle_items (id, tenant_id, customer_id, vehicle_vin, sale_amount, amount_paid, status, updated_at)
SELECT gen_random_uuid(), 'tenant-ce09-cert', '22222222-2222-4222-8222-222222222201', 'TESTVIN00000000001', 25000.00, 0, 'OPEN', CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM ar_wholesale_vehicle_items WHERE tenant_id = 'tenant-ce09-cert' AND vehicle_vin = 'TESTVIN00000000001'
);
