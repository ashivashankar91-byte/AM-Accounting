#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# seed-r1-demo.sh
# Authoritative R1 demo-data seed wrapper for Kunes Demo Automotive Group.
#
# Usage:
#   ./scripts/seed-r1-demo.sh               # seed demo data
#   ./scripts/seed-r1-demo.sh --reset       # wipe + re-seed (local only)
#   ./scripts/seed-r1-demo.sh --verify      # verify seeded data
#   ./scripts/seed-r1-demo.sh --migrate     # run migrations then seed
#
# Environment:
#   DATABASE_URL   defaults to postgresql://amacc:amacc_dev@localhost:5433/amacc
#   APP_URL        defaults to http://localhost:5174
#
# This script never prints JWT secrets or database passwords.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RESET=false
VERIFY=false
MIGRATE=false

for arg in "$@"; do
  case "$arg" in
    --reset)   RESET=true ;;
    --verify)  VERIFY=true ;;
    --migrate) MIGRATE=true ;;
    --help|-h)
      echo "Usage: $0 [--reset] [--verify] [--migrate]"
      echo "  --reset    Wipe demo tenant data and re-seed (local database only)"
      echo "  --verify   Verify seeded data without modifying anything"
      echo "  --migrate  Run service migrations before seeding"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ── Environment validation ────────────────────────────────────────────────────
: "${DATABASE_URL:=postgresql://amacc:amacc_dev@localhost:5433/amacc}"
: "${APP_URL:=http://localhost:5174}"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Accounting R1 Demo Seed — Kunes Demo Automotive Group"
echo "═══════════════════════════════════════════════════════════"
echo "  Database : [host redacted — see DATABASE_URL env var]"
echo "  App URL  : ${APP_URL}"
echo ""

# ── Safety check for --reset ──────────────────────────────────────────────────
if [ "$RESET" = true ]; then
  if ! echo "${DATABASE_URL}" | grep -qE 'localhost|127\.0\.0\.1'; then
    echo "ERROR: --reset refused. DATABASE_URL does not appear to be a local target." >&2
    echo "       --reset is only permitted against localhost databases." >&2
    exit 1
  fi
  echo "⚠️  WARNING: --reset will delete all demo tenant data for tenant-kunes."
  read -rp "  Continue? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Dependency check ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH." >&2
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "ERROR: npx is required but not found in PATH." >&2
  exit 1
fi

# ── Optional: run migrations ──────────────────────────────────────────────────
if [ "$MIGRATE" = true ]; then
  echo "[0/1] Running service migrations..."
  if [ -f "${ROOT_DIR}/scripts/migrate-all.sh" ]; then
    bash "${ROOT_DIR}/scripts/migrate-all.sh"
  else
    echo "  WARN: migrate-all.sh not found; skipping."
  fi
fi

# ── Build args ────────────────────────────────────────────────────────────────
SEED_ARGS=""
[ "$RESET" = true ]  && SEED_ARGS="${SEED_ARGS} --reset"
[ "$VERIFY" = true ] && SEED_ARGS="${SEED_ARGS} --verify"

# ── Run seed ──────────────────────────────────────────────────────────────────
export DATABASE_URL
export APP_URL

npx tsx "${SCRIPT_DIR}/seed-r1-demo.ts" ${SEED_ARGS}

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && [ "$VERIFY" = false ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  ✅  Seed complete."
  echo "  App: ${APP_URL}"
  echo "  Login: controller@kunes-demo.local / KunesDemo2026!"
  echo "═══════════════════════════════════════════════════════════"
fi

exit $EXIT_CODE
