#!/usr/bin/env bash
# Build the Linux x86-64 release binary (GCE e2-micro) from any machine with Rust + zig:
#   brew install zig cargo-zigbuild      (macOS)   |   cargo install cargo-zigbuild && pip install ziglang (Linux)
#   deploy/build-linux.sh                -> dist/hanu-linux-amd64 (+ .sha256)
# The admin app and the SDK are compiled into the binary, so they are built first.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
if [ "${SKIP_WEB:-}" != "1" ]; then
  (cd sdk && npm ci --silent && npm run build --silent)
  (cd admin && npm ci --silent && npm run build --silent)
fi
rustup target add x86_64-unknown-linux-gnu >/dev/null
# glibc 2.31 keeps the binary compatible with Debian 11+/Ubuntu 20.04+
cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.31
mkdir -p dist
cp target/x86_64-unknown-linux-gnu/release/hanu dist/hanu-linux-amd64
(cd dist && shasum -a 256 hanu-linux-amd64 > hanu-linux-amd64.sha256)
ls -la dist/hanu-linux-amd64
