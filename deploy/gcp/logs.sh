#!/usr/bin/env bash
# Tail the VM's logs through IAP (no public ssh).   deploy/gcp/logs.sh [unit...]   (default: hanu hanudb caddy)
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f deploy/.env ] && { set -a; . deploy/.env; set +a; }
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}; ZONE=${ZONE:-us-central1-a}; NAME=${NAME:-hanu-1}
units=${*:-hanu hanudb caddy}
args=""; for u in $units; do args="$args -u $u"; done
gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command "sudo journalctl $args -n 100 -f"
