#!/usr/bin/env bash
# Local development: HanuDB (in-memory bucket) + the hanu server against a local file bucket.
#   scripts/dev.sh            start both (logs in ./data/dev/*.log)
#   scripts/dev.sh stop       stop both
# Needs: a hanudb binary on PATH (install.sh from github.com/madhudream/hanudb, or HANUDB_BIN=...),
# and target/debug/hanu (cargo build). Ports: HanuDB 8080, hanu ${HANU_PORT:-8090}.
set -euo pipefail
cd "$(dirname "$0")/.."
DEV=${HANU_DEV_DIR:-./data/dev}
mkdir -p "$DEV"
DEV=$(cd "$DEV" && pwd)
if [ "${1:-}" = "stop" ]; then
  pkill -f "hanudb serve|twindb serve" 2>/dev/null || true
  pkill -f "target/(debug|release)/hanu" 2>/dev/null || true
  echo "stopped"; exit 0
fi
HANUDB_BIN=${HANUDB_BIN:-$(command -v hanudb || command -v twindb || true)}
[ -n "$HANUDB_BIN" ] || { echo "hanudb not found: install it (curl -fsSL https://raw.githubusercontent.com/madhudream/hanudb/main/install.sh | sh) or set HANUDB_BIN" >&2; exit 1; }
[ -x target/debug/hanu ] || cargo build
pkill -f "hanudb serve|twindb serve" 2>/dev/null || true
pkill -f "target/(debug|release)/hanu" 2>/dev/null || true
sleep 0.5
nohup "$HANUDB_BIN" serve --bucket "${HANUDB_BUCKET:-mem://}" --dir "$DEV/hanudb" --listen 127.0.0.1:8080 --token devtoken > "$DEV/hanudb.log" 2>&1 &
sleep 1.5
HANU_LISTEN=127.0.0.1:${HANU_PORT:-8090} HANU_BUCKET="file://$DEV/bucket" HANU_DIR="$DEV/cache" \
HANUDB_URL=http://127.0.0.1:8080 HANUDB_TOKEN=devtoken HANU_GEO=${HANU_GEO:-off} HANU_FLUSH_SECS=${HANU_FLUSH_SECS:-5} \
HANU_PUBLIC_URL=http://127.0.0.1:${HANU_PORT:-8090} RUST_LOG=${RUST_LOG:-info,tower_http=warn} \
nohup target/debug/hanu > "$DEV/hanu.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:${HANU_PORT:-8090}/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://127.0.0.1:${HANU_PORT:-8090}/health" >/dev/null && echo "hanu: http://127.0.0.1:${HANU_PORT:-8090}  (logs: $DEV/hanu.log, $DEV/hanudb.log)" || { echo "hanu failed to start:"; tail -20 "$DEV/hanu.log"; exit 1; }
