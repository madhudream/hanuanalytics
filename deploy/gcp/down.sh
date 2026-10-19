#!/usr/bin/env bash
# Delete the VM and its address. The bucket (all data) and secrets are kept; delete them by hand if you mean it.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f deploy/.env ] && { set -a; . deploy/.env; set +a; }
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}; ZONE=${ZONE:-us-central1-a}; NAME=${NAME:-hanu-1}; REGION=${ZONE%-*}
gcloud --project "$PROJECT" --quiet compute instances delete "$NAME" --zone "$ZONE"
gcloud --project "$PROJECT" --quiet compute addresses delete "$NAME-ip" --region "$REGION" 2>/dev/null || true
echo "VM deleted. Data is still in the bucket; deploy/gcp/up.sh brings a new VM back from it."
