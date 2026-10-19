#!/usr/bin/env bash
# Shell on the VM through IAP.   deploy/gcp/ssh.sh [command]
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f deploy/.env ] && { set -a; . deploy/.env; set +a; }
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}; ZONE=${ZONE:-us-central1-a}; NAME=${NAME:-hanu-1}
if [ $# -gt 0 ]; then gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command "$*"
else gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap; fi
