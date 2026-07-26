#!/usr/bin/env bash
# R0 Stabilization Phase 6 — repeatable ephemeral Postgres for live-database
# integration tests. NEVER touches the shared `amacc` dev database (that
# lives at localhost:5433 per docker-compose.yml) — this spins up a
# completely separate, disposable cluster, matching the precedent already
# established by the S200 audit (see docs/accounting-modernization/
# audit-results/S200-AUDIT_RESULTS_v1.2.md's "ephemeral sandbox" section).
#
# Usage:
#   tests/integration/rls-live-db/setup.sh
#   # ... run tests, using the printed connection strings ...
#   tests/integration/rls-live-db/teardown.sh
#
# Requires local Postgres binaries (initdb, pg_ctl, psql) — e.g. via
# `brew install postgresql@16`. Does not require Docker (CI may instead
# substitute a `services: postgres:` container and skip straight to the
# "apply schema + RLS migrations" step below).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRATCH="${AMACC_RLS_TEST_SCRATCH:-/tmp/amacc-rls-live-db}"
SOCKET_DIR="/tmp/amacc-rls-live-db-sock"   # short path — Postgres Unix sockets cap at 103 bytes
PGPORT="${AMACC_RLS_TEST_PORT:-55439}"
DB_NAME="amacc_rls_test"

mkdir -p "$SCRATCH" "$SOCKET_DIR"

if [[ ! -f "$SCRATCH/PG_VERSION" ]]; then
  echo "==> initdb (fresh ephemeral cluster, trust auth, superuser=amacc_test)"
  initdb -D "$SCRATCH" -U amacc_test --auth=trust --no-locale --encoding=UTF8
fi

echo "==> starting Postgres on port $PGPORT (socket: $SOCKET_DIR)"
pg_ctl -D "$SCRATCH" -l "$SCRATCH/pg.log" -o "-p $PGPORT -k $SOCKET_DIR" start
trap 'echo "(leaving Postgres running — call teardown.sh when done)"' EXIT

for i in $(seq 1 20); do
  if pg_isready -h "$SOCKET_DIR" -p "$PGPORT" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

export PGHOST="$SOCKET_DIR" PGPORT PGUSER=amacc_test

if ! psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -lqt | cut -d '|' -f 1 | grep -qw "$DB_NAME"; then
  echo "==> createdb $DB_NAME"
  createdb -h "$PGHOST" -p "$PGPORT" -U amacc_test "$DB_NAME"
fi

echo "==> creating test roles (amacc_app, amacc_admin — idempotent)"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=0 <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_app') THEN CREATE ROLE amacc_app LOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_admin') THEN CREATE ROLE amacc_admin LOGIN; END IF; END $$;
SQL

echo "==> generating combined base schema from each service's current Prisma model"
COMBINED="$SCRATCH/combined_schema.sql"
: > "$COMBINED"
for svc in tenant-service auth-service coa-service audit-service; do
  ( cd "$REPO_ROOT/services/$svc" && npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script ) \
    | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/g; s/^CREATE (UNIQUE )?INDEX /CREATE \1INDEX IF NOT EXISTS /g' \
    >> "$COMBINED"
done
echo "==> applying combined base schema (proves: migrations apply cleanly to an empty database)"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$COMBINED"

echo "==> IMPORTANT: prisma migrate diff --to-schema-datamodel only reconstructs what the"
echo "    Prisma schema LANGUAGE can express — hand-written raw SQL in historical migration"
echo "    files (custom triggers/functions) is NOT included. Applying those explicitly:"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/services/coa-service/prisma/migrations/20260724180000_add_journal_posting/migration.sql" \
  2>&1 | grep -v "^CREATE TABLE\|^CREATE INDEX\|^ALTER TABLE" || true

echo "==> applying R0 Stabilization RLS policy migrations"
for f in \
  "$REPO_ROOT/services/tenant-service/prisma/migrations/20260726000003_add_rls_policies/migration.sql" \
  "$REPO_ROOT/services/auth-service/prisma/migrations/20260726000003_add_rls_policies/migration.sql" \
  "$REPO_ROOT/services/coa-service/prisma/migrations/20260726000002_add_rls_policies/migration.sql" \
  "$REPO_ROOT/services/audit-service/prisma/migrations/20260726000002_add_rls_policies/migration.sql"; do
  psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo "==> granting table privileges to amacc_app / amacc_admin, and bypass membership to amacc_admin"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" <<'SQL'
GRANT USAGE ON SCHEMA public TO amacc_app, amacc_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amacc_app, amacc_admin;
GRANT amacc_rls_bypass TO amacc_admin;
SQL

echo ""
echo "==> ready. Connection strings:"
echo "PG_SUPERUSER_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}"
echo "PG_APP_URL=postgresql://amacc_app@localhost:${PGPORT}/${DB_NAME}"
echo "PG_ADMIN_URL=postgresql://amacc_admin@localhost:${PGPORT}/${DB_NAME}"
echo "LIVE_DATABASE_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}?schema=public"
