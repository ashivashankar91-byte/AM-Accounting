#!/usr/bin/env bash
# CE-14 — fresh migration-replay proof: applies oem-service's entire Prisma
# migration history via `prisma migrate deploy` (never `db push`) against a
# throwaway, completely empty database and asserts every on-disk migration
# folder recorded a successful, non-rolled-back row. Same proof shape as
# services/tax-service/tests/live-db/migration-replay.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/oem-service"
PGHOST="${AMACC_OEM_TEST_PGHOST:-localhost}"
PGPORT="${AMACC_OEM_TEST_PGPORT:-5432}"
DB_NAME="amacc_oem_service_migration_replay_test"

psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB_NAME;"
psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME OWNER amacc;"

cd "$SVC_ROOT"
DATABASE_URL="postgresql://amacc:amacc_dev@${PGHOST}:${PGPORT}/${DB_NAME}" \
  npx prisma migrate deploy --schema=prisma/schema.prisma

EXPECTED_COUNT=$(find "$SVC_ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
ACTUAL_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U amacc -d "$DB_NAME" -t -A -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")

if [[ "$ACTUAL_COUNT" == "$EXPECTED_COUNT" ]]; then
  echo "==> PASS: $ACTUAL_COUNT/$EXPECTED_COUNT migrations applied cleanly to a fresh database"
else
  echo "==> FAIL: expected $EXPECTED_COUNT successfully-applied migrations, found $ACTUAL_COUNT" >&2
  exit 1
fi

psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
