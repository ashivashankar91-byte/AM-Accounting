#!/usr/bin/env bash
# Committed, repeatable S026/S027 Playwright fixture-seeding entrypoint.
#
# Replaces the previous undocumented dependency on an ad-hoc, already-torn-
# down Docker Postgres instance (the "kunes-final-r0" tenant that only ever
# existed in one earlier local Docker session). This script produces the
# same tenant/user/schedule/open-item fixture data deterministically against
# ANY Postgres instance that already has every service's committed
# migrations applied (see scripts/migrate-all.sh) — no Docker required, no
# manual steps beyond running this one script.
#
# Requires: services/auth-service and services/schedule-service each
# pointed at the target database via their own DATABASE_URL (auth-service
# and schedule-service may be different logical databases in a split-DB
# topology, or the same shared `amacc` database — this script does not
# assume either, it just uses whatever DATABASE_URL each npx tsx invocation
# below is given).
#
# Usage:
#   AUTH_DATABASE_URL=postgres://... SCHEDULE_DATABASE_URL=postgres://... \
#     ./scripts/seed-s026-s027-e2e-fixtures.sh
#
# Env var overrides for tenant id / emails / password / schedule numbers all
# match the S026_*/S027_* defaults already hard-coded into
# tests/e2e/s026-schedule-open-items.spec.ts and
# tests/e2e/s027-schedule-aging.spec.ts, so this script's own defaults need
# no further configuration for a fresh certification run.
set -euo pipefail

AMACC_TENANT_ID="${S026_TENANT_ID:-1cf31f14-cb0b-4261-a41d-f79953594c86}"
ADMIN_EMAIL="${S026_ADMIN_EMAIL:-admin@kunes-final-r0.test}"
NO_GRANT_EMAIL="${S026_NO_GRANT_EMAIL:-clerk@kunes-final-r0.test}"
PASSWORD="${S026_PASSWORD:-FinalR0-Evidence-2026!}"

AUTH_DATABASE_URL="${AUTH_DATABASE_URL:?AUTH_DATABASE_URL is required (auth-service DATABASE_URL)}"
SCHEDULE_DATABASE_URL="${SCHEDULE_DATABASE_URL:?SCHEDULE_DATABASE_URL is required (schedule-service DATABASE_URL)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Seeding S026/S027 fixture tenant users (auth-service) =="
# Full CE-08 schedule.* grant set + iam catalog view, so the fixture admin
# can exercise every S026/S027/S028/S029/S030 journey step, mirroring
# bootstrap-admin.ts's real "grant every cataloged permission" convention
# but scoped to a fixed, reviewable list rather than "all permissions", since
# this fixture user is intentionally narrower than the production ADMIN
# role bootstrap-admin.ts creates.
SCHEDULE_PERMS="schedule.open_item.view,schedule.open_item.apply,schedule.open_item.reverse,\
schedule.open_item.split,schedule.open_item.transfer,schedule.open_item.writeoff,\
schedule.tie_out.view,schedule.tie_out.run,schedule.aging.view,schedule.aging.config,\
schedule.exception.view,schedule.exception.disposition,\
schedule.statement.view,schedule.statement.generate,\
gl.dashboard.view,acct.entity.view"

(cd "$REPO_ROOT/services/auth-service" && \
  DATABASE_URL="$AUTH_DATABASE_URL" \
  AMACC_TENANT_ID="$AMACC_TENANT_ID" \
  AMACC_ROLE_KEY="CE08_E2E_ADMIN" \
  AMACC_PERMISSIONS="$SCHEDULE_PERMS" \
  AMACC_USER_EMAIL="$ADMIN_EMAIL" \
  AMACC_USER_NAME="S026/S027 E2E Fixture Admin" \
  AMACC_USER_PASSWORD="$PASSWORD" \
  npx tsx scripts/bootstrap-role-user.ts)

(cd "$REPO_ROOT/services/auth-service" && \
  DATABASE_URL="$AUTH_DATABASE_URL" \
  AMACC_TENANT_ID="$AMACC_TENANT_ID" \
  AMACC_ROLE_KEY="CE08_E2E_NOGRANT" \
  AMACC_PERMISSIONS="iam.catalog.view" \
  AMACC_USER_EMAIL="$NO_GRANT_EMAIL" \
  AMACC_USER_NAME="S026/S027 E2E Fixture No-Grant Clerk" \
  AMACC_USER_PASSWORD="$PASSWORD" \
  npx tsx scripts/bootstrap-role-user.ts)

echo "== Seeding S026/S027 fixture schedule + open items (schedule-service) =="
(cd "$REPO_ROOT/services/schedule-service" && \
  DATABASE_URL="$SCHEDULE_DATABASE_URL" \
  AMACC_TENANT_ID="$AMACC_TENANT_ID" \
  npx tsx scripts/seed-e2e-fixtures.ts)

echo "== S026/S027 fixture seeding complete =="
