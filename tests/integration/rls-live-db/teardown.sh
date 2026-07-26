#!/usr/bin/env bash
# Fully tears down the ephemeral Postgres instance created by setup.sh —
# stops the server and deletes the scratch data directory. Never touches
# the shared `amacc` dev database (a completely separate instance/port).
set -euo pipefail
SCRATCH="${AMACC_RLS_TEST_SCRATCH:-/tmp/amacc-rls-live-db}"
SOCKET_DIR="/tmp/amacc-rls-live-db-sock"

if [[ -f "$SCRATCH/postmaster.pid" ]]; then
  pg_ctl -D "$SCRATCH" stop -m fast || true
fi
rm -rf "$SCRATCH" "$SOCKET_DIR"
echo "==> torn down: $SCRATCH and $SOCKET_DIR removed"
