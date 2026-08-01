#!/usr/bin/env bash
# S124/S125 — fresh migration-replay proof: applies tax-service's entire
# Prisma migration history via `prisma migrate deploy` (never `db push`)
# against a throwaway, completely empty database and asserts success. This
# is the same command scripts/migrate-all.sh uses for every other service
# in this repo (see that script's header) — tax-service had no equivalent
# proof of its own yet, so this fills that gap for CE-10.
#
# Usage:
#   services/tax-service/tests/live-db/setup.sh   # starts the shared ephemeral cluster
#   services/tax-service/tests/live-db/migration-replay.sh
#   services/tax-service/tests/live-db/teardown.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/tax-service"
SOCKET_DIR="${AMACC_TAX_TEST_SOCKET_DIR:-$HOME/.amacc-tax-svc-test-sock}"
PGPORT="${AMACC_TAX_TEST_PORT:-55460}"
DB_NAME="amacc_tax_service_migration_replay_test"

if ! pg_isready -h "$SOCKET_DIR" -p "$PGPORT" >/dev/null 2>&1; then
  echo "FATAL: no Postgres listening on $SOCKET_DIR:$PGPORT — run setup.sh first." >&2
  exit 1
fi

export PGHOST="$SOCKET_DIR" PGPORT PGUSER=amacc_test

echo "==> dropping + recreating a throwaway, completely empty database: $DB_NAME"
dropdb -h "$PGHOST" -p "$PGPORT" -U amacc_test --if-exists "$DB_NAME"
createdb -h "$PGHOST" -p "$PGPORT" -U amacc_test "$DB_NAME"

echo "==> npx prisma migrate deploy (applies every migration in prisma/migrations/, in order, additive-only)"
cd "$SVC_ROOT"
DATABASE_URL="postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}?host=${SOCKET_DIR}" \
  npx prisma migrate deploy

echo "==> verifying every on-disk migration folder recorded a successful, non-rolled-back row"
EXPECTED_COUNT=$(find "$SVC_ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
ACTUAL_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -t -A -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")

if [[ "$ACTUAL_COUNT" == "$EXPECTED_COUNT" ]]; then
  echo "==> PASS: $ACTUAL_COUNT/$EXPECTED_COUNT migrations applied cleanly to a fresh database"
else
  echo "==> FAIL: expected $EXPECTED_COUNT successfully-applied migrations, found $ACTUAL_COUNT" >&2
  exit 1
fi

echo "==> cleaning up the throwaway database"
dropdb -h "$PGHOST" -p "$PGPORT" -U amacc_test "$DB_NAME"
