#!/usr/bin/env bash
# Build everything for this machine: SDK, admin app, then the server (release) with both embedded.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
(cd sdk && npm ci --silent && npm run build)
(cd admin && npm ci --silent && npm run build --silent)
cargo build --release
ls -la target/release/hanu
