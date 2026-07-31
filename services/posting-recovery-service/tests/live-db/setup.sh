#!/usr/bin/env bash
# S021 Posting Recovery — repeatable ephemeral Postgres for live-database /
# RLS integration tests, scoped to this service only (posting-recovery-
# service has no cross-service foreign keys, so — unlike
# tests/integration/rls-live-db/setup.sh, which bootstraps four services'
# combined schema — this only ever needs its own three migrations applied
# in order). NEVER touches the shared `amacc` dev database: this spins up a
# completely separate, disposable cluster on its own port/socket dir,
# matching the precedent in tests/integration/rls-live-db/setup.sh.
#
# Usage:
#   services/posting-recovery-service/tests/live-db/setup.sh
#   # ... run tests, using the printed connection strings ...
#   services/posting-recovery-service/tests/live-db/teardown.sh
#
# Requires local Postgres binaries (initdb, pg_ctl, psql).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/posting-recovery-service"
SCRATCH="${AMACC_PR_TEST_SCRATCH:-/tmp/amacc-posting-recovery-live-db}"
SOCKET_DIR="/tmp/amacc-pr-live-db-sock"
PGPORT="${AMACC_PR_TEST_PORT:-55440}"
DB_NAME="amacc_posting_recovery_test"

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

echo "==> creating test roles (amacc_app, amacc_admin — idempotent, same names/shape as"
echo "    infra/postgres/init/01-create-app-role.sql and tests/integration/rls-live-db)"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=0 <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_app') THEN CREATE ROLE amacc_app LOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_admin') THEN CREATE ROLE amacc_admin LOGIN; END IF; END $$;
SQL

echo "==> applying posting-recovery-service migrations, in order"
for f in \
  "$SVC_ROOT/prisma/migrations/20260729010000_init_posting_recovery_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260729010001_add_rls_policies_posting_recovery_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260729010002_add_immutability_posting_recovery_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260731010000_add_replay_lock_timeout_recovery/migration.sql"; do
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
