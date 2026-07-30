-- S052 — outbox tables are internal system delivery queues (this service's
-- own pending-work list), not tenant-facing queryable data. The audit-outbox
-- drainer (packages/shared-kernel/src/audit/audit-outbox-drainer.ts) is a
-- background poller with no per-request tenant context — it must see every
-- tenant's unpublished rows in one query. Same rationale and precedent as
-- coa-service's 20260727000001_exclude_outbox_tables_from_rls_coa_svc.
ALTER TABLE "audit_outbox" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_outbox_events" DISABLE ROW LEVEL SECURITY;
