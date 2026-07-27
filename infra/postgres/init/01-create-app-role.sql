-- FINAL-R0 Priority 1 (R0_TRUST_BASELINE_RECERTIFICATION): create a
-- least-privilege application role that is NOT a superuser and does NOT
-- have BYPASSRLS.
--
-- CRITICAL FINDING this fixes: docker-compose.yml (and the k8s manifests)
-- provision Postgres with only POSTGRES_USER=amacc, and the Postgres docker
-- entrypoint always creates that user as a superuser. Every AMACC service's
-- DATABASE_URL connected as this same superuser. Postgres exempts
-- superusers (and any role with BYPASSRLS) from row-level security
-- unconditionally — ENABLE ROW LEVEL SECURITY and even FORCE ROW LEVEL
-- SECURITY have no effect on such a role. Verified empirically: connected
-- as `amacc`, a session scoped to tenant-B could freely SELECT a row that
-- belongs to tenant-A, despite tenant_isolation policies existing on the
-- table and relrowsecurity/relforcerowsecurity both being true. Every prior
-- "real RLS-enforced" / "tenant isolation" certification that ran services
-- against this docker-compose stack was therefore certifying inert policies.
--
-- Fix: application services now connect as `amacc_app` (this role) at
-- runtime — ordinary DML privileges only, no BYPASSRLS, not a superuser —
-- so RLS policies actually apply. `prisma migrate deploy` (DDL) must still
-- be run with the superuser `amacc` connection string; ALTER DEFAULT
-- PRIVILEGES below ensures any tables created by future migrations
-- automatically grant amacc_app the DML it needs, with no manual step.
--
-- This file is mounted into /docker-entrypoint-initdb.d/ so a fresh Postgres
-- data volume creates the role automatically; docker-compose.yml's
-- DATABASE_URL anchor now points services at amacc_app instead of amacc.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_app') THEN
    CREATE ROLE amacc_app WITH LOGIN PASSWORD 'amacc_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO amacc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amacc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amacc_app;

-- Applies automatically to tables/sequences created by later migrations
-- (run as the amacc superuser) without a manual GRANT step each time.
ALTER DEFAULT PRIVILEGES FOR ROLE amacc IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amacc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE amacc IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO amacc_app;
