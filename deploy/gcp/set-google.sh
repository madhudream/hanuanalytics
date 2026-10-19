#!/usr/bin/env bash
# Enable "Continue with Google": store the OAuth client in Secret Manager and restart the server.
#   deploy/gcp/set-google.sh <client_id> <client_secret>
# Create the client first in the Google Cloud console (APIs & Services -> Credentials -> OAuth client ID,
# Web application) with the redirect URI  https://<your domain>/api/admin/oauth/google/callback
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f deploy/.env ] && { set -a; . deploy/.env; set +a; }
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}; ZONE=${ZONE:-us-central1-a}; NAME=${NAME:-hanu-1}
# arguments, or GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET from deploy/.env
CID=${1:-${GOOGLE_OAUTH_CLIENT_ID:-}}; CSEC=${2:-${GOOGLE_OAUTH_CLIENT_SECRET:-}}
[ -n "$CID" ] && [ -n "$CSEC" ] || { echo "usage: $0 <client_id> <client_secret>   (or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in deploy/.env)" >&2; exit 2; }
set -- "$CID" "$CSEC"
SA="hanuanalytics@$PROJECT.iam.gserviceaccount.com"
g() { gcloud --project "$PROJECT" --quiet "$@"; }
for s in hanu-google-client-id hanu-google-client-secret; do
  g secrets describe "$s" >/dev/null 2>&1 || g secrets create "$s" --replication-policy automatic >/dev/null
  g secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
done
printf '%s' "$1" | g secrets versions add hanu-google-client-id --data-file=- >/dev/null
printf '%s' "$2" | g secrets versions add hanu-google-client-secret --data-file=- >/dev/null
echo "stored; restarting the server on $NAME"
g compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command "sudo google_metadata_script_runner startup >/dev/null 2>&1; systemctl is-active hanu" 2>/dev/null
echo "done: the Google button appears on /setup and /login"
