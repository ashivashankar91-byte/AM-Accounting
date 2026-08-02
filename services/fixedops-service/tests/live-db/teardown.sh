#!/usr/bin/env bash
# Fully tears down the ephemeral Postgres instance created by setup.sh —
# stops the server and deletes the scratch data directory. Never touches
# the shared `amacc` dev database (a completely separate instance/port).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SVC_ROOT="$REPO_ROOT/services/fixedops-service"
SCRATCH="${AMACC_FIXEDOPS_TEST_SCRATCH:-$SVC_ROOT/tests/live-db/.scratch/pgdata}"
SOCKET_DIR="${AMACC_FIXEDOPS_TEST_SOCKET_DIR:-$HOME/.amacc-fixedops-svc-test-sock}"

if [[ -f "$SCRATCH/postmaster.pid" ]]; then
  pg_ctl -D "$SCRATCH" stop -m fast || true
fi
rm -rf "$SCRATCH" "$SOCKET_DIR"
echo "==> torn down: $SCRATCH and $SOCKET_DIR removed"
