-- Runtime stabilization: required GL journal source codes (PO-DEC-004 —
-- numeric source code + lookup, not a free-text dropdown). gl_sources was
-- entirely empty, so /admin/journal-templates and journal-entry source
-- lookups had nothing to resolve against.
INSERT INTO "gl_sources" ("tenant_id", "source_code", "name", "auto_post", "is_active")
VALUES
  ('tenant-kunes', '88', 'Standard General Journal', false, true),
  ('tenant-kunes', '03', 'Prior Month Entries',      false, true),
  ('tenant-kunes', '30', 'Service Repair Orders',    true,  true),
  ('tenant-kunes', '32', 'Part Sales',               true,  true),
  ('tenant-kunes', '40', 'Warranty Remittances',     false, true)
ON CONFLICT ("tenant_id", "source_code") DO NOTHING;
