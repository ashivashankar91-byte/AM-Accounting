#!/usr/bin/env bash
# ALL-159 DEMO PREFLIGHT CHECK
# Verifies environment is ready for stakeholder demonstration.
# Exits non-zero if any critical check fails.
set -euo pipefail

PASS=0; FAIL=0
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-amacc}"
DB_PASS="${DB_PASS:-amacc_dev}"
DB_NAME="${DB_NAME:-amacc}"
FRONTEND_URL="${APP_URL:-http://localhost:5174}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3100}"
EXPECTED_BRANCH="accounting-all-159-integration"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC}  $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ALL-159 DEMO PREFLIGHT — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. BRANCH & CLEAN WORKTREE ─────────────────────────────────────────────
echo "▶ 1/9  Git environment"
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$BRANCH" = "$EXPECTED_BRANCH" ]; then
  ok "Branch: $BRANCH"
else
  fail "Expected branch $EXPECTED_BRANCH, got $BRANCH"
fi
SHA=$(git rev-parse HEAD 2>/dev/null | head -c 8)
ok "HEAD: $SHA"
DIRTY=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" = "0" ]; then
  ok "Worktree clean"
else
  fail "Worktree dirty ($DIRTY file(s) — run git status)"
fi

# ── 2. DATABASE ────────────────────────────────────────────────────────────
echo ""
echo "▶ 2/9  Database"
if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  ok "PostgreSQL reachable at $DB_HOST:$DB_PORT/$DB_NAME"
else
  fail "PostgreSQL NOT reachable at $DB_HOST:$DB_PORT/$DB_NAME"
fi

# ── 3. TENANT DATA ─────────────────────────────────────────────────────────
echo ""
echo "▶ 3/9  Seed data"
TENANT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM tenants WHERE id='tenant-kunes'" 2>/dev/null | tr -d ' \n' || echo "0")
if [ "$TENANT" = "1" ]; then
  ok "Demo tenant tenant-kunes exists"
else
  fail "Demo tenant tenant-kunes NOT found — run: yarn seed:all-159-demo --reset"
fi

LE_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM legal_entities WHERE tenant_id='tenant-kunes'" 2>/dev/null | tr -d ' \n' || echo "0")
if [ "${LE_COUNT:-0}" -ge 2 ]; then
  ok "Legal entities: $LE_COUNT"
else
  fail "Legal entities missing (found $LE_COUNT, need ≥ 2)"
fi

JE_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM journal_entries WHERE tenant_id='tenant-kunes'" 2>/dev/null | tr -d ' \n' || echo "0")
if [ "${JE_COUNT:-0}" -ge 3 ]; then
  ok "Journal entries: $JE_COUNT"
else
  fail "Journal entries missing (found $JE_COUNT)"
fi

VENDOR_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM vendors WHERE tenant_id='tenant-kunes'" 2>/dev/null | tr -d ' \n' || echo "0")
if [ "${VENDOR_COUNT:-0}" -ge 3 ]; then
  ok "Vendors: $VENDOR_COUNT"
else
  fail "Vendors missing (found $VENDOR_COUNT)"
fi

EMP_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM employees WHERE tenant_id='tenant-kunes'" 2>/dev/null | tr -d ' \n' || echo "0")
if [ "${EMP_COUNT:-0}" -ge 3 ]; then
  ok "Employees: $EMP_COUNT"
else
  fail "Employees missing (found $EMP_COUNT)"
fi

# ── 4. SERVICES ────────────────────────────────────────────────────────────
echo ""
echo "▶ 4/9  Service health"
SERVICES=(
  "auth-service:3001"
  "tenant-service:3002"
  "gl-service:3010"
  "eom-service:3011"
  "payroll-service:3012"
  "apar-service:3013"
  "recon-service:3014"
  "fs-service:3015"
  "coa-service:3016"
  "schedule-service:3018"
  "cash-service:3050"
  "tax-service:3051"
  "fixedops-service:3060"
  "parts-accounting-service:3061"
  "vehicle-accounting-service:3090"
  "floorplan-service:3091"
  "deal-accounting-service:3092"
  "fni-reserve-service:3093"
  "notification-service:3030"
  "audit-service:3031"
  "connector-service:3032"
  "approval-service:3033"
  "onboarding-service:3035"
  "webhook-service:3036"
  "cashflow-service:3037"
  "compliance-service:3043"
  "orchestrator-service:3048"
  "posting-recovery-service:3049"
)
HEALTHY=0; UNHEALTHY=0
for svc_port in "${SERVICES[@]}"; do
  SVC="${svc_port%%:*}"; PORT="${svc_port##*:}"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    HEALTHY=$((HEALTHY + 1))
  else
    fail "$SVC (port $PORT) health returned $STATUS"
    UNHEALTHY=$((UNHEALTHY + 1))
  fi
done
if [ "$UNHEALTHY" -eq 0 ]; then
  ok "All $HEALTHY checked services healthy"
fi

# ── 5. FRONTEND ────────────────────────────────────────────────────────────
echo ""
echo "▶ 5/9  Frontend"
FE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$FRONTEND_URL" 2>/dev/null || echo "000")
if [ "$FE_STATUS" = "200" ] || [ "$FE_STATUS" = "302" ] || [ "$FE_STATUS" = "301" ]; then
  ok "Frontend $FRONTEND_URL → HTTP $FE_STATUS"
else
  fail "Frontend $FRONTEND_URL → HTTP $FE_STATUS"
fi

# ── 6. GATEWAY ─────────────────────────────────────────────────────────────
echo ""
echo "▶ 6/9  API Gateway"
GW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$GATEWAY_URL/health" 2>/dev/null || echo "000")
if [ "$GW_STATUS" = "200" ] || [ "$GW_STATUS" = "404" ]; then
  ok "Gateway $GATEWAY_URL reachable (HTTP $GW_STATUS)"
else
  fail "Gateway $GATEWAY_URL → HTTP $GW_STATUS"
fi

# ── 7. SEED VERIFICATION ───────────────────────────────────────────────────
echo ""
echo "▶ 7/9  Seed verification"
VERIFY_OUT=$(DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME" \
  APP_URL="$FRONTEND_URL" \
  bash "$(dirname "$0")/seed-all-159-demo.sh" --verify 2>&1 || true)
if echo "$VERIFY_OUT" | grep -q "9/9 checks passed"; then
  ok "Seed verification: 9/9 checks passed"
else
  PASSED=$(echo "$VERIFY_OUT" | grep -oE "[0-9]+/9 checks passed" | head -1 || echo "0/9")
  fail "Seed verification: $PASSED"
fi

# ── 8. MIGRATIONS CURRENT ─────────────────────────────────────────────────
echo ""
echo "▶ 8/9  Migration state"
MIGRATION_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL" 2>/dev/null | tr -d ' \n' || echo "unknown")
if [ "$MIGRATION_COUNT" != "unknown" ] && [ "${MIGRATION_COUNT:-0}" -gt 0 ]; then
  ok "Applied migrations: $MIGRATION_COUNT"
else
  warn "Could not determine migration count"
fi

# ── 9. JOURNALS BALANCED ──────────────────────────────────────────────────
echo ""
echo "▶ 9/9  Financial integrity"
UNBALANCED=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
  SELECT COUNT(*) FROM journal_entries je
  WHERE tenant_id='tenant-kunes' AND status='POSTED'
  AND EXISTS (
    SELECT 1 FROM (
      SELECT journal_entry_id, SUM(debit) - SUM(credit) AS diff
      FROM journal_lines
      GROUP BY journal_entry_id
      HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
    ) unbal WHERE unbal.journal_entry_id = je.id
  )
" 2>/dev/null | tr -d ' \n' || echo "unknown")
if [ "$UNBALANCED" = "0" ]; then
  ok "All posted journals balanced"
elif [ "$UNBALANCED" = "unknown" ]; then
  warn "Could not verify journal balance"
else
  fail "Unbalanced posted journals: $UNBALANCED"
fi

# ── SUMMARY ───────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo -e "  PREFLIGHT RESULT: ${GREEN}$PASS passed${NC} / ${RED}$FAIL failed${NC} / $TOTAL total"
echo "══════════════════════════════════════════════════════"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}✅  DEMO ENVIRONMENT READY${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}❌  DEMO ENVIRONMENT NOT READY — fix $FAIL issue(s) above${NC}"
  echo ""
  exit 1
fi
