-- GL-service onboarding follow-up: outbox tables are internal cross-tenant
-- delivery queues, not tenant-facing data. Background drainers run outside any
-- request-scoped tenant context, so they must see all unpublished rows.
ALTER TABLE "audit_outbox" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" DISABLE ROW LEVEL SECURITY;
