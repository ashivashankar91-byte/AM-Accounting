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

echo "==> mirroring infra/postgres/init/01-create-app-role.sql's ALTER DEFAULT"
echo "    PRIVILEGES so amacc_app automatically gets SELECT/INSERT/UPDATE/DELETE"
echo "    on any table created LATER in this script by amacc_test (this ephemeral"
echo "    cluster's migration-running superuser, standing in for production's"
echo "    'amacc' role) — without this, tables the S008 migration creates further"
echo "    below (fiscal_period_transition, adjusting_entry_attestation) would get"
echo "    no privilege grant at all from the one-shot blanket GRANT further down,"
echo "    since that only covers tables that already exist at the time it runs."
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE amacc_test IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amacc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE amacc_test IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO amacc_app;
SQL

echo "==> AMACC-CH04 S036A: applying apar-service's own migration history via"
echo "    'prisma migrate deploy' — unlike tenant-service/auth-service/coa-service/"
echo "    audit-service below, apar-service's prisma/migrations directory is now a"
echo "    complete, standard folder-per-migration history (fixed as part of S036A;"
echo "    it previously had no migration_lock.toml and three flat, non-folder .sql"
echo "    files that 'prisma migrate deploy' could not have run at all), so it does"
echo "    not need the diff-from-empty bootstrap trick the other four services"
echo "    require for their own pre-existing history gaps. Run here, immediately"
echo "    after the ALTER DEFAULT PRIVILEGES above and before any other service"
echo "    creates a single table: 'prisma migrate deploy' fails with P3005 (\"schema"
echo "    is not empty\") the moment ANY table exists anywhere in the shared public"
echo "    schema, even one it doesn't own — so apar-service's real migration history"
echo "    must be the very first thing applied to this database. New tables created"
echo "    here (vendors, ap_vendor_number_counters, ap_vendor_duplicate_acknowledgements,"
echo "    audit_outbox, ar_entries, ap_entries, ap_payments, customers,"
echo "    purchase_orders, po_lines, ap_bank_accounts, outbox_events) automatically"
echo "    inherit the amacc_app grant via the ALTER DEFAULT PRIVILEGES set immediately"
echo "    above — no separate GRANT needed here."
( cd "$REPO_ROOT/services/apar-service" && \
  DATABASE_URL="postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}" npx prisma migrate deploy )

echo "==> generating combined base schema from each service's current Prisma model"
COMBINED="$SCRATCH/combined_schema.sql"
: > "$COMBINED"
for svc in tenant-service auth-service coa-service audit-service; do
  GEN="( cd \"$REPO_ROOT/services/$svc\" && npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script )"
  if [[ "$svc" == "coa-service" ]]; then
    # S008 finding: Prisma's `@default(uuid())` on FiscalPeriodTransition.id /
    # AdjustingEntryAttestation.id is a CLIENT-side default only — `prisma
    # migrate diff --to-schema-datamodel` does not know about the hand-written
    # `DEFAULT gen_random_uuid()::text` the real migration.sql adds at the SQL
    # level, so the bootstrap step below would create both tables WITHOUT that
    # default. Left alone, applying the real S008 migration.sql afterward with
    # `IF NOT EXISTS` would then skip re-creating them (they'd already
    # "exist"), silently keeping the default-less version — and every
    # `record_period_transition()` insert (which never supplies an `id`,
    # relying on the DB default) would fail NOT NULL on `id`. Discovered
    # exactly this way, empirically, while writing this test suite. This is a
    # test-harness-only artifact of the from-empty-diff bootstrap technique,
    # not a production bug: a real deployment uses `prisma migrate deploy`,
    # which replays the actual migration.sql (default included), never this
    # synthesized bootstrap. Fixed here by excluding both tables (and their
    # indexes) from the bootstrap output so the real migration.sql — applied
    # further below — is the sole, correct creator of both.
    # S019/S020 finding (same class as the S008 one above): the posting-engine
    # tables carry hand-written CHECK constraints + an immutability trigger
    # that `prisma migrate diff --to-schema-datamodel` cannot express. If the
    # bootstrap step below created them first, the real migration.sql's
    # (IF-NOT-EXISTS-rewritten) CREATE TABLE statements would be skipped as
    # "already exists", silently dropping the CHECK constraints and leaving
    # the immutability trigger the only defense — untested here. Excluded the
    # same way: the real migration.sql (applied further below, unrewritten,
    # as sole creator) is what actually runs.
    eval "$GEN" \
      | sed -E '/^CREATE TABLE "fiscal_period_transition"/,/^\);$/d; /^CREATE TABLE "adjusting_entry_attestation"/,/^\);$/d; /ON "fiscal_period_transition"/d; /ON "adjusting_entry_attestation"/d; /^ALTER TABLE "fiscal_period_transition" ADD CONSTRAINT/d' \
      | sed -E '/^CREATE TABLE "posting_rule_pack"/,/^\);$/d; /^CREATE TABLE "posting_rule_pack_version"/,/^\);$/d; /^CREATE TABLE "posting_execution"/,/^\);$/d; /^CREATE TABLE "posting_execution_attempt"/,/^\);$/d; /^CREATE TABLE "posting_exception"/,/^\);$/d; /^CREATE TABLE "posting_execution_replay"/,/^\);$/d; /ON "posting_rule_pack"/d; /ON "posting_rule_pack_version"/d; /ON "posting_execution"/d; /ON "posting_execution_attempt"/d; /ON "posting_exception"/d; /ON "posting_execution_replay"/d; /^ALTER TABLE "posting_rule_pack_version" ADD CONSTRAINT/d; /^ALTER TABLE "posting_execution" ADD CONSTRAINT/d; /^ALTER TABLE "posting_execution_attempt" ADD CONSTRAINT/d; /^ALTER TABLE "posting_exception" ADD CONSTRAINT/d; /^ALTER TABLE "posting_execution_replay" ADD CONSTRAINT/d' \
      | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/g; s/^CREATE (UNIQUE )?INDEX /CREATE \1INDEX IF NOT EXISTS /g' \
      >> "$COMBINED"
  else
    eval "$GEN" \
      | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/g; s/^CREATE (UNIQUE )?INDEX /CREATE \1INDEX IF NOT EXISTS /g' \
      >> "$COMBINED"
  fi
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
  "$REPO_ROOT/services/tenant-service/prisma/migrations/20260726000003_add_rls_policies_tenant_svc/migration.sql" \
  "$REPO_ROOT/services/auth-service/prisma/migrations/20260726000003_add_rls_policies/migration.sql" \
  "$REPO_ROOT/services/coa-service/prisma/migrations/20260726000002_add_rls_policies/migration.sql" \
  "$REPO_ROOT/services/audit-service/prisma/migrations/20260726000002_add_rls_policies_audit_svc/migration.sql"; do
  psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo "==> granting table privileges to amacc_app / amacc_admin, and bypass membership to amacc_admin"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" <<'SQL'
GRANT USAGE ON SCHEMA public TO amacc_app, amacc_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amacc_app, amacc_admin;
GRANT amacc_rls_bypass TO amacc_admin;
SQL

echo "==> S008: applying period-close hand-written triggers/functions/roles/RLS"
echo "    (enforce_period_transition, enforce_period_postable, fiscal_period_transition +"
echo "    adjusting_entry_attestation RLS, amacc_period_ledger_writer). Deliberately applied"
echo "    AFTER the blanket amacc_app grant above: this migration's own REVOKE INSERT/UPDATE/"
echo "    DELETE ... FROM amacc_app on the two new tables must be the LAST word (matches real"
echo "    deployment order — 20260728010000 is timestamp-later than the RLS policy migrations"
echo "    and the infra-init default-privilege grant it REVOKEs from). The new columns"
echo "    (closed_by/closed_at/locked_by/locked_at/is_adjusting/...) and the two new tables"
echo "    ARE expressible in Prisma schema language and were already created by the combined-"
echo "    schema step above — so unlike the journal_posting migration, this one is rewritten"
echo "    to IF NOT EXISTS on those specific statements (ON_ERROR_STOP=1 would otherwise abort"
echo "    this file at the first duplicate-column/duplicate-table error, before ever reaching"
echo "    the trigger/function/RLS statements later in the same file)."
sed -E \
  -e 's/^ALTER TABLE "([a-zA-Z_]+)" ADD COLUMN "/ALTER TABLE "\1" ADD COLUMN IF NOT EXISTS "/' \
  -e 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
  -e 's/^CREATE (UNIQUE )?INDEX "/CREATE \1INDEX IF NOT EXISTS "/' \
  "$REPO_ROOT/services/coa-service/prisma/migrations/20260728010000_s008_period_close_control/migration.sql" \
  | psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -

echo "==> S019/S020: applying posting-engine tables + CHECK constraints + immutability"
echo "    trigger + RLS (excluded from the bootstrap step above; sole creator here)."
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/services/coa-service/prisma/migrations/20260729010000_add_posting_engine/migration.sql" >/dev/null

echo "==> S023: applying replay evidence table + widened posting_exception reason-code"
echo "    CHECK constraint (posting_execution_replay excluded from the bootstrap step"
echo "    above for the same reason as the posting-engine tables; applied in order,"
echo "    after its own posting_execution FK target already exists)."
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/services/coa-service/prisma/migrations/20260801010000_posting_engine_s023_replay_and_taxonomy/migration.sql" >/dev/null

echo "==> CE-07: applying single-authoritative-ledger posting_execution status CHECK widening"
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/services/coa-service/prisma/migrations/20260802010000_posting_engine_single_ledger_status/migration.sql" >/dev/null

echo "==> CE-07: applying legal-entity isolation (posting_rule_pack.entity_id,"
echo "    posting_execution.entity_id, and both widened unique constraints)."
psql -h "$PGHOST" -p "$PGPORT" -U amacc_test -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/services/coa-service/prisma/migrations/20260802020000_ce07_rule_pack_entity_isolation/migration.sql" >/dev/null

echo ""
echo "==> ready. Connection strings:"
echo "PG_SUPERUSER_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}"
echo "PG_APP_URL=postgresql://amacc_app@localhost:${PGPORT}/${DB_NAME}"
echo "PG_ADMIN_URL=postgresql://amacc_admin@localhost:${PGPORT}/${DB_NAME}"
echo "LIVE_DATABASE_URL=postgresql://amacc_test@localhost:${PGPORT}/${DB_NAME}?schema=public"
