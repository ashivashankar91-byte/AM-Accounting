#!/usr/bin/env bash
# S124/S125 Tax Service — repeatable ephemeral Postgres for live-database /
# RLS integration tests, scoped to this service only (tax-service has no
# cross-service foreign keys, so — like
# services/posting-recovery-service/tests/live-db/setup.sh — this only
# needs its own migrations applied in order). NEVER touches the shared
# `amacc` dev database: this spins up a completely separate, disposable
# cluster on its own port/socket dir.
#
# Deviation from the posting-recovery-service precedent: this repo's
# session-execution environment forbids writing anywhere under /tmp, so —
# unlike the sibling script, which defaults its scratch/socket dirs to
# /tmp — this defaults pgdata to a directory INSIDE this worktree
# (tests/live-db/.scratch, git-ignored) instead. The Unix-domain socket
# directory, however, cannot live inside the (deeply nested) worktree path:
# Postgres's socket path has a hard ~103-byte OS limit, and this worktree's
# absolute path plus tests/live-db/.scratch/sock exceeds it ("Unix-domain
# socket path ... is too long"). So the socket dir defaults to a short,
# non-/tmp path directly under $HOME instead. Override either with
# AMACC_TAX_TEST_SCRATCH / AMACC_TAX_TEST_SOCKET_DIR if your environment
# doesn't have these restrictions.
#
# Usage:
#   services/tax-service/tests/live-db/setup.sh
#   # ... run tests, using the printed connection strings ...
#   services/tax-service/tests/live-db/teardown.sh
#
# Requires local Postgres binaries (initdb, pg_ctl, psql, createdb).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/tax-service"
SCRATCH="${AMACC_TAX_TEST_SCRATCH:-$SVC_ROOT/tests/live-db/.scratch/pgdata}"
SOCKET_DIR="${AMACC_TAX_TEST_SOCKET_DIR:-$HOME/.amacc-tax-svc-test-sock}"
PGPORT="${AMACC_TAX_TEST_PORT:-55460}"
DB_NAME="amacc_tax_service_test"

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
echo "    infra/postgres/init/01-create-app-role.sql and posting-recovery-service's live-db)"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=0 <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_app') THEN CREATE ROLE amacc_app LOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_admin') THEN CREATE ROLE amacc_admin LOGIN; END IF; END $$;
SQL

echo "==> applying tax-service migrations, in order"
for f in \
  "$SVC_ROOT/prisma/migrations/20260801010000_init_tax_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260801010001_add_rls_policies_tax_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260801010002_add_immutability_tax_svc/migration.sql" \
  "$SVC_ROOT/prisma/migrations/20260801010003_add_partial_unique_idempotency_tax_svc/migration.sql"; do
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
echo "PG_SUPERUSER_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}?host=${SOCKET_DIR}"
echo "PG_APP_URL=postgresql://amacc_app@localhost:${PGPORT}/${DB_NAME}?host=${SOCKET_DIR}"
echo "PG_ADMIN_URL=postgresql://amacc_admin@localhost:${PGPORT}/${DB_NAME}?host=${SOCKET_DIR}"
echo "LIVE_DATABASE_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}?schema=public&host=${SOCKET_DIR}"
