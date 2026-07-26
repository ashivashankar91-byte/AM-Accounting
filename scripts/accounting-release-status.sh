#!/usr/bin/env bash
# accounting-release-status.sh
# Reads docs/accounting-modernization/MODULE_STATE.json and prints a
# human-readable release dashboard. Requires: bash 4+, jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$REPO_ROOT/docs/accounting-modernization/MODULE_STATE.json"

# ── Colour codes ──────────────────────────────────────────────────────────────
BOLD=$'\e[1m'; RESET=$'\e[0m'
GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; CYAN=$'\e[36m'; DIM=$'\e[2m'

if ! command -v jq &>/dev/null; then
  echo "jq is required. Install with: brew install jq" >&2
  exit 1
fi

if [[ ! -f "$STATE_FILE" ]]; then
  echo "MODULE_STATE.json not found at $STATE_FILE" >&2
  exit 1
fi

# ── Parse state ───────────────────────────────────────────────────────────────
PACKAGE=$(jq -r '.activePackage'            "$STATE_FILE")
EXEC_MODE=$(jq -r '.executionMode'          "$STATE_FILE")
NEXT=$(jq -r '.nextEligibleStory'           "$STATE_FILE")
LAST_UPDATED=$(jq -r '._meta.lastUpdated'   "$STATE_FILE")
SEQUENCE=$(jq -r '.sequence[]'             "$STATE_FILE")
TOTAL=$(jq -r '.sequence | length'          "$STATE_FILE")

# ── Counts ────────────────────────────────────────────────────────────────────
DONE_COUNT=$(jq '[.stories[] | select(.status == "DONE")] | length'                        "$STATE_FILE")
DPI_COUNT=$(jq '[.stories[] | select(.status == "DONE_PENDING_INTEGRATION")] | length'     "$STATE_FILE")
READY_COUNT=$(jq '[.stories[] | select(.status == "READY")] | length'                      "$STATE_FILE")
BLOCKED_COUNT=$(jq '[.stories[] | select(.status == "BLOCKED")] | length'                  "$STATE_FILE")
NOT_STARTED_COUNT=$(jq '[.stories[] | select(.status == "NOT_STARTED")] | length'          "$STATE_FILE")

COMPLETE_COUNT=$(( DONE_COUNT + DPI_COUNT ))
PCT=$(( COMPLETE_COUNT * 100 / TOTAL ))

# ── Progress bar ──────────────────────────────────────────────────────────────
BAR_WIDTH=30
FILLED=$(( PCT * BAR_WIDTH / 100 ))
EMPTY=$(( BAR_WIDTH - FILLED ))
BAR="${GREEN}$(printf '█%.0s' $(seq 1 $FILLED 2>/dev/null || true))${DIM}$(printf '░%.0s' $(seq 1 $EMPTY 2>/dev/null || true))${RESET}"
# Fallback for older bash (seq is fine, but printf repeat trick can vary)
if (( FILLED > 0 )); then
  BAR_FILLED=$(printf '%0.s█' $(seq 1 $FILLED))
else
  BAR_FILLED=""
fi
if (( EMPTY > 0 )); then
  BAR_EMPTY=$(printf '%0.s░' $(seq 1 $EMPTY))
else
  BAR_EMPTY=""
fi
BAR="${GREEN}${BAR_FILLED}${DIM}${BAR_EMPTY}${RESET}"

# ── Status colour helper ──────────────────────────────────────────────────────
status_colour() {
  case "$1" in
    DONE)                   echo "${GREEN}DONE${RESET}" ;;
    DONE_PENDING_INTEGRATION) echo "${YELLOW}DONE_PENDING_INTEGRATION${RESET}" ;;
    READY)                  echo "${CYAN}READY${RESET}" ;;
    NOT_STARTED)            echo "${DIM}NOT_STARTED${RESET}" ;;
    BLOCKED)                echo "${RED}BLOCKED${RESET}" ;;
    *)                      echo "$1" ;;
  esac
}

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "${BOLD}  AMACC Accounting Modernisation — Release Status${RESET}"
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
printf "  %-18s %s\n" "Package:"       "${BOLD}${PACKAGE}${RESET}"
printf "  %-18s %s\n" "Execution mode:" "$EXEC_MODE"
printf "  %-18s %s\n" "Last updated:"  "$LAST_UPDATED"
echo ""

# ── Progress ──────────────────────────────────────────────────────────────────
echo "${BOLD}  Package Completion: ${PCT}% (${COMPLETE_COUNT}/${TOTAL})${RESET}"
echo "  ${BAR}"
echo ""

# ── Story table ───────────────────────────────────────────────────────────────
echo "${BOLD}  Stories (build order):${RESET}"
echo "  ─────────────────────────────────────────────────────────"
printf "  %-6s  %-38s  %s\n" "ID" "Title" "Status"
echo "  ─────────────────────────────────────────────────────────"

while IFS= read -r story_id; do
  TITLE=$(jq -r --arg id "$story_id" '.stories[$id].title' "$STATE_FILE")
  STATUS=$(jq -r --arg id "$story_id" '.stories[$id].status' "$STATE_FILE")
  COMP_DATE=$(jq -r --arg id "$story_id" '.stories[$id].completedDate // ""' "$STATE_FILE")

  TITLE_TRUNC="${TITLE:0:38}"
  INDICATOR=""
  [[ "$story_id" == "$NEXT" ]] && INDICATOR=" ${CYAN}◄ next${RESET}"
  [[ "$STATUS" == "BLOCKED" ]]  && INDICATOR=" ${RED}◄ BLOCKED${RESET}"

  printf "  %-6s  %-38s  %s%s" \
    "$story_id" "$TITLE_TRUNC" "$(status_colour "$STATUS")" "$INDICATOR"

  if [[ -n "$COMP_DATE" && "$COMP_DATE" != "null" ]]; then
    printf "  ${DIM}(%s)${RESET}" "$COMP_DATE"
  fi
  echo ""
done <<< "$SEQUENCE"

echo "  ─────────────────────────────────────────────────────────"
echo ""

# ── Summary counts ────────────────────────────────────────────────────────────
echo "${BOLD}  Summary:${RESET}"
printf "  %-30s ${GREEN}%d${RESET}\n"  "Done:"                         "$DONE_COUNT"
printf "  %-30s ${YELLOW}%d${RESET}\n" "Done (pending integration):"   "$DPI_COUNT"
printf "  %-30s ${CYAN}%d${RESET}\n"   "Ready:"                        "$READY_COUNT"
printf "  %-30s ${DIM}%d${RESET}\n"    "Not started:"                  "$NOT_STARTED_COUNT"
if (( BLOCKED_COUNT > 0 )); then
printf "  %-30s ${RED}%d${RESET}\n"    "Blocked:"                      "$BLOCKED_COUNT"
fi
echo ""

# ── Next story detail ─────────────────────────────────────────────────────────
if [[ "$NEXT" != "null" && -n "$NEXT" ]]; then
  NEXT_TITLE=$(jq -r --arg id "$NEXT" '.stories[$id].title'   "$STATE_FILE")
  NEXT_LAYMAN=$(jq -r --arg id "$NEXT" '.stories[$id].layman' "$STATE_FILE")
  echo "${BOLD}  Next story: ${CYAN}${NEXT}${RESET} — ${BOLD}${NEXT_TITLE}${RESET}"
  echo "  ${DIM}${NEXT_LAYMAN}${RESET}"
  echo ""
fi

# ── Blocked stories ───────────────────────────────────────────────────────────
BLOCKED_LIST=$(jq -r '[.stories | to_entries[] | select(.value.status == "BLOCKED") | "\(.key): \(.value.blockers[0] // "reason unspecified")"] | .[]' "$STATE_FILE")
if [[ -n "$BLOCKED_LIST" ]]; then
  echo "${RED}${BOLD}  Blocked stories:${RESET}"
  while IFS= read -r line; do
    echo "  ${RED}✖${RESET} $line"
  done <<< "$BLOCKED_LIST"
  echo ""
fi

# ── Integration gate ──────────────────────────────────────────────────────────
PENDING_INTEGRATION=$(jq -r '.integrationGateStatus | to_entries[] | "  \(.key): \(.value)"' "$STATE_FILE")
if [[ -n "$PENDING_INTEGRATION" ]]; then
  echo "${BOLD}  Integration gate (stubs awaiting real S007/S207):${RESET}"
  while IFS= read -r line; do
    echo "${YELLOW}  ⏳${RESET}${line}"
  done <<< "$PENDING_INTEGRATION"
  echo ""
fi

# ── Test status (live vitest check) ──────────────────────────────────────────
TENANT_SVC="$REPO_ROOT/services/tenant-service"
if [[ -d "$TENANT_SVC" ]]; then
  echo "${BOLD}  Live test status (tenant-service vitest):${RESET}"
  TEST_OUT=$(cd "$TENANT_SVC" && npx vitest run --reporter=verbose 2>&1 | tail -6)
  PASS_LINE=$(echo "$TEST_OUT" | grep -E "Tests\s+[0-9]+ passed" || true)
  FAIL_LINE=$(echo "$TEST_OUT" | grep -E "failed" || true)
  if [[ -n "$FAIL_LINE" ]]; then
    echo "  ${RED}✖ Tests failing — see vitest output${RESET}"
    echo "  $FAIL_LINE"
  elif [[ -n "$PASS_LINE" ]]; then
    echo "  ${GREEN}✔ $PASS_LINE${RESET}"
  else
    echo "  ${DIM}(run 'npx vitest run' in services/tenant-service for details)${RESET}"
  fi
  echo ""
fi

# ── Stop conditions ───────────────────────────────────────────────────────────
echo "${DIM}  Auto-stop triggers: business decision missing | architecture blocker |"
echo "  destructive migration | failing tests | package boundary reached${RESET}"
echo ""
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
