#!/usr/bin/env bash
# Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
# APPLICATION): there was previously no single command that applied every
# service's Prisma migrations to the shared `amacc` database, and no
# automated step in docker-compose.yml that ran migrations at all —
# services just booted straight against whatever schema state the DB
# happened to already be in. Two services (fs-service, payroll-service)
# additionally had legacy flat .sql files sitting directly in
# prisma/migrations/ instead of Prisma's folder-per-migration format, which
# `prisma migrate deploy` silently ignores ("No migration found") — fixed
# separately as baseline migrations alongside this script.
#
# This script applies every service's own migration history via
# `prisma migrate deploy`, run as the privileged `amacc` superuser (DDL +
# RLS setup) — never the least-privilege `amacc_app` runtime role used by
# application services (see infra/postgres/init/01-create-app-role.sql).
# All services share one physical `amacc` database and therefore one
# `_prisma_migrations` table; `prisma migrate deploy` only inspects rows
# whose migration_name matches a folder in that service's own
# prisma/migrations/ directory, so running every service in sequence
# against the same shared table is safe. The one genuinely shared table
# across services (outbox_events, mapped from six different services'
# OutboxEvent models) is created with CREATE TABLE IF NOT EXISTS in every
# service that defines it, so whichever service runs first legitimately
# creates it and the rest no-op on it.
#
# Usage:
#   MIGRATE_DATABASE_URL=postgresql://amacc:amacc_dev@localhost:5433/amacc \
#     ./scripts/migrate-all.sh
#
# Defaults to the in-network hostname (postgres:5432) so it also works
# unmodified when run as the `migrator` docker-compose service.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="${MIGRATE_DATABASE_URL:-postgresql://amacc:amacc_dev@postgres:5432/amacc}"

# Order is not load-bearing (see header) but foundational/catalog services
# are listed first for readability of migration output.
SERVICES=(
  tenant-service
  auth-service
  coa-service
  posting-recovery-service
  tax-service
  audit-service
  gl-service
  apar-service
  cash-service
  schedule-service
  vehicle-accounting-service
  floorplan-service
  deal-accounting-service
  fni-reserve-service
  eom-service
  payroll-service
  fs-service
  recon-service
  cashflow-service
  fixedops-service
  parts-accounting-service
  oem-service
  close-service
  migration-service
)

echo "==> Applying migrations to ${DATABASE_URL%%@*}@... (amacc superuser)"

for svc in "${SERVICES[@]}"; do
  dir="$REPO_ROOT/services/$svc"
  if [[ ! -d "$dir/prisma/migrations" ]]; then
    echo "==> [$svc] no prisma/migrations directory — skipping"
    continue
  fi
  echo "==> [$svc] prisma migrate deploy"
  ( cd "$dir" && npx prisma migrate deploy --schema=prisma/schema.prisma )
done

echo "==> All service migrations applied."
