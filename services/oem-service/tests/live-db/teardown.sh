#!/usr/bin/env bash
# Drops the throwaway database created by setup.sh. Never touches
# amacc_ce14_cert or any other database.
set -euo pipefail
PGHOST="${AMACC_OEM_TEST_PGHOST:-localhost}"
PGPORT="${AMACC_OEM_TEST_PGPORT:-5432}"
DB_NAME="amacc_oem_service_test"
psql -h "$PGHOST" -p "$PGPORT" -U amacc -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
echo "==> torn down: $DB_NAME dropped"
