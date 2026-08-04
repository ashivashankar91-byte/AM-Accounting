#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# seed-all-159-demo.sh
# All-159 prototype demonstration seed for AM-Accounting.
# Extends the certified R1 demo seed with scenarios covering all 159 stories.
#
# Usage:
#   ./scripts/seed-all-159-demo.sh               # append all-159 demo data
#   ./scripts/seed-all-159-demo.sh --reset       # wipe + re-seed (local only)
#   ./scripts/seed-all-159-demo.sh --verify      # verify seeded data
#
# Environment:
#   DATABASE_URL   defaults to postgresql://amacc:amacc_dev@localhost:5433/amacc
#   APP_URL        defaults to http://localhost:5174
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RESET=false
VERIFY=false

for arg in "$@"; do
  case "$arg" in
    --reset)   RESET=true ;;
    --verify)  VERIFY=true ;;
    --help|-h)
      echo "Usage: $0 [--reset] [--verify]"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

: "${DATABASE_URL:=postgresql://amacc:amacc_dev@localhost:5433/amacc}"
: "${APP_URL:=http://localhost:5174}"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Accounting ALL-159 Prototype Seed — Kunes Demo Automotive Group"
echo "═══════════════════════════════════════════════════════════════════"
echo "  DATABASE_URL: ${DATABASE_URL//:*@/:***@}"
echo "  APP_URL: $APP_URL"
echo ""

if [ "$VERIFY" = "true" ]; then
  echo "► Running verification..."
  npx tsx "$SCRIPT_DIR/verify-all-159-demo.ts" --url "$APP_URL"
  exit 0
fi

# Step 1: Run the certified R1 seed first (backward-compatible baseline)
echo "► Step 1/3: Seeding certified R1 baseline..."
bash "$SCRIPT_DIR/seed-r1-demo.sh" ${RESET:+--reset}
echo "✓ R1 baseline seeded."

# Step 2: Run all-159 extended seed TypeScript script
echo "► Step 2/3: Seeding all-159 extended demo scenarios..."
npx tsx "$SCRIPT_DIR/seed-all-159-demo.ts"
echo "✓ All-159 extended seed complete."

# Step 3: Verify basic counts
echo "► Step 3/3: Running quick data verification..."
npx tsx "$SCRIPT_DIR/verify-all-159-demo.ts" --url "$APP_URL" --quick || true

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  ALL-159 PROTOTYPE SEED COMPLETE"
echo "  Stories covered: 159"
echo "  Seed command: yarn seed:all-159-demo"
echo "═══════════════════════════════════════════════════════════════════"
