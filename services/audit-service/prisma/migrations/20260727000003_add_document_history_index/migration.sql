-- S224 Document Audit History View: GET /audit/documents/:docType/:docId
-- filters audit_logs by (tenant_id, entity_type, entity_id) and orders by
-- occurred_at. Purely additive (no column/data change) — matches the S224
-- packet's own data-entities note: "no new writable entities; additive
-- migrations only if any supporting view/index is needed."
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_entity_occurred_idx"
  ON "audit_logs" ("tenant_id", "entity_type", "entity_id", "occurred_at");
