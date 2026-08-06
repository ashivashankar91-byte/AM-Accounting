#!/usr/bin/env bash
# CE-14 oem-service — repeatable throwaway Postgres database for live-
# database / RLS integration tests, against the ALREADY-RUNNING local
# Postgres instance (this session verified native Postgres is running and
# reachable; no Docker daemon available in this environment — see the
# epic's certification report). NEVER touches the shared amacc_ce14_cert
# certification database or any other epic worktree's database: this
# creates a separate, disposable database on the SAME server, dropped by
# teardown.sh.
#
# Usage:
#   services/oem-service/tests/live-db/setup.sh
#   PG_SUPERUSER_URL=... PG_APP_URL=... npx tsx services/oem-service/tests/live-db/rls-isolation.ts
#   services/oem-service/tests/live-db/teardown.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/oem-service"
PGHOST="${AMACC_OEM_TEST_PGHOST:-localhost}"
PGPORT="${AMACC_OEM_TEST_PGPORT:-5432}"
DB_NAME="amacc_oem_service_test"

export PGHOST PGPORT

echo "==> dropping + recreating throwaway database: $DB_NAME"
psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB_NAME;"
psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME OWNER amacc;"

echo "==> applying oem-service migrations (prisma migrate deploy)"
cd "$SVC_ROOT"
DATABASE_URL="postgresql://amacc:amacc_dev@${PGHOST}:${PGPORT}/${DB_NAME}" \
  npx prisma migrate deploy --schema=prisma/schema.prisma

echo "==> granting amacc_app least-privilege access (same shape as infra/postgres/init/01-create-app-role.sql)"
psql -h "$PGHOST" -p "$PGPORT" -U amacc -d "$DB_NAME" <<'SQL'
GRANT USAGE ON SCHEMA public TO amacc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amacc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amacc_app;
SQL

echo ""
echo "==> ready. Connection strings:"
echo "PG_SUPERUSER_URL=postgresql://amacc:amacc_dev@${PGHOST}:${PGPORT}/${DB_NAME}"
echo "PG_APP_URL=postgresql://amacc_app:amacc_app_dev@${PGHOST}:${PGPORT}/${DB_NAME}"
