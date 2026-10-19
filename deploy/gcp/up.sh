#!/usr/bin/env bash
# HanuAnalytics on Google Cloud in one command: a bucket (the durable home), a free-tier e2-micro running
# HanuDB + hanu + Caddy (HTTPS), a least-privilege service account, and the secrets in Secret Manager.
#
#   deploy/gcp/up.sh --project my-project --domain analytics.example.com --email you@example.com
#   deploy/gcp/up.sh --upgrade                 re-upload the binary and restart (seconds of downtime)
#
# Options (or deploy/.env, see deploy/env.example):
#   --project ID   --domain HOST   --email ADDR   --zone ZONE (us-central1-a)   --name NAME (hanu-1)
#   --bucket NAME (<project>-hanu)   --tunnel TOKEN (Cloudflare Tunnel: no public IP)   --network NAME (default)
#   --skip-build   use the existing dist/hanu-linux-amd64
# Safe to run again: every step checks before it creates. Nothing here is written into the repo.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f deploy/.env ] && { set -a; . deploy/.env; set +a; }
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}
DOMAIN=${DOMAIN:-} EMAIL=${EMAIL:-} ZONE=${ZONE:-us-central1-a} NAME=${NAME:-hanu-1} BUCKET=${BUCKET:-} TUNNEL=${TUNNEL:-} NETWORK=${NETWORK:-default}
UPGRADE= SKIP_BUILD=
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT=$2; shift 2 ;; --domain) DOMAIN=$2; shift 2 ;; --email) EMAIL=$2; shift 2 ;; --zone) ZONE=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;; --bucket) BUCKET=$2; shift 2 ;; --tunnel) TUNNEL=$2; shift 2 ;; --network) NETWORK=$2; shift 2 ;;
    --upgrade) UPGRADE=1; shift ;; --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$PROJECT" ] || { echo "no project: pass --project or set PROJECT in deploy/.env" >&2; exit 2; }
REGION=${ZONE%-*}
BUCKET=${BUCKET:-$PROJECT-hanu}
SA="hanu@$PROJECT.iam.gserviceaccount.com"
g() { gcloud --project "$PROJECT" --quiet "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
retry() { for i in 1 2 3 4 5 6 7 8 9 10; do "$@" && return 0; echo "  (retrying in 5 s)"; sleep 5; done; return 1; }

step "binary"
if [ -z "$SKIP_BUILD" ] || [ ! -f dist/hanu-linux-amd64 ]; then deploy/build-linux.sh; fi
ls -la dist/hanu-linux-amd64

step "APIs"
g services enable compute.googleapis.com storage.googleapis.com secretmanager.googleapis.com iap.googleapis.com >/dev/null

step "bucket gs://$BUCKET (events, recordings, HanuDB's log; recordings auto-expire after 90 days as a backstop)"
g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || g storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access
lc=$(mktemp); echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90,"matchesPrefix":["hanu/rec/"]}}]}' > "$lc"
g storage buckets update "gs://$BUCKET" --lifecycle-file="$lc" >/dev/null; rm -f "$lc"

step "upload binary -> gs://$BUCKET/bin/"
g storage cp dist/hanu-linux-amd64 dist/hanu-linux-amd64.sha256 "gs://$BUCKET/bin/" >/dev/null

step "GeoIP (DB-IP City Lite, CC BY 4.0) -> gs://$BUCKET/hanu/geo/ (so the VM never downloads it)"
month=$(date -u +%Y-%m); key="hanu/geo/dbip-city-lite-$month.mmdb"
if ! g storage ls "gs://$BUCKET/$key" >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  if curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz" -o "$tmp/geo.gz" 2>/dev/null || \
     { prev=$(date -u -v-1m +%Y-%m 2>/dev/null || date -u -d "-1 month" +%Y-%m); key="hanu/geo/dbip-city-lite-$prev.mmdb"; curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$prev.mmdb.gz" -o "$tmp/geo.gz"; }; then
    gunzip -c "$tmp/geo.gz" > "$tmp/geo.mmdb" && g storage cp "$tmp/geo.mmdb" "gs://$BUCKET/$key" >/dev/null && echo "  uploaded $key"
  else
    echo "  could not download the GeoIP file now; the server retries daily"
  fi
  rm -rf "$tmp"
else
  echo "  present"
fi

step "service account $SA"
g iam service-accounts describe "$SA" >/dev/null 2>&1 || g iam service-accounts create hanu --display-name "HanuAnalytics VM"
retry g storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null
retry g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role roles/logging.logWriter --condition None >/dev/null

step "secrets (hanudb-token, hanu-salt)"
for s in hanudb-token hanu-salt; do
  if ! g secrets describe "$s" >/dev/null 2>&1; then
    g secrets create "$s" --replication-policy automatic >/dev/null
    openssl rand -hex 24 | tr -d '\n' | g secrets versions add "$s" --data-file=- >/dev/null
  fi
  retry g secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
done
if [ -n "$TUNNEL" ]; then
  g secrets describe hanu-tunnel >/dev/null 2>&1 || g secrets create hanu-tunnel --replication-policy automatic >/dev/null
  printf '%s' "$TUNNEL" | g secrets versions add hanu-tunnel --data-file=- >/dev/null
  retry g secrets add-iam-policy-binding hanu-tunnel --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
fi

step "network"
g compute networks subnets update "$NETWORK" --region "$REGION" --enable-private-ip-google-access >/dev/null
g compute firewall-rules describe hanu-allow-iap-ssh >/dev/null 2>&1 || \
  g compute firewall-rules create hanu-allow-iap-ssh --network "$NETWORK" --direction INGRESS --source-ranges 35.235.240.0/20 --allow tcp:22 --target-tags hanu >/dev/null
if [ -z "$TUNNEL" ]; then
  g compute firewall-rules describe hanu-allow-web >/dev/null 2>&1 || \
    g compute firewall-rules create hanu-allow-web --network "$NETWORK" --direction INGRESS --source-ranges 0.0.0.0/0 --allow tcp:80,tcp:443 --target-tags hanu >/dev/null
  g compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 || g compute addresses create "$NAME-ip" --region "$REGION" >/dev/null
  IP=$(g compute addresses describe "$NAME-ip" --region "$REGION" --format 'value(address)')
fi

startup=$(mktemp); trap 'rm -f "$startup"' EXIT
cp deploy/gcp/startup.sh "$startup"

META="hanu-bucket=$BUCKET,hanu-domain=$DOMAIN,hanu-email=$EMAIL,hanu-tunnel=${TUNNEL:+1}"
step "VM $NAME (e2-micro, Debian 12)"
if g compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances add-metadata "$NAME" --zone "$ZONE" --metadata "$META" --metadata-from-file "startup-script=$startup" >/dev/null
  if [ -n "$UPGRADE" ]; then
    echo "re-running the startup script (fetches the new binary, restarts)"
    g compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command "sudo google_metadata_script_runner startup && systemctl is-active hanudb hanu caddy"
  else
    echo "exists; metadata updated (run with --upgrade to roll out the binary now)"
  fi
else
  g compute instances create "$NAME" --zone "$ZONE" --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
    --service-account "$SA" --scopes cloud-platform --tags hanu ${TUNNEL:+--no-address} ${IP:+--address "$IP"} \
    --metadata "$META" --metadata-from-file "startup-script=$startup" >/dev/null
fi

cat <<DONE

HanuAnalytics is starting on $NAME (the first boot takes 2-3 minutes: packages, binaries, certificates).

  bucket:    gs://$BUCKET   (hanu/ = events + recordings, hanudb/ = the database)
$( [ -n "${IP:-}" ] && echo "  public IP: $IP   -> create a DNS A record: $DOMAIN -> $IP  (Caddy issues the certificate once it resolves)" )
$( [ -n "$TUNNEL" ] && echo "  tunnel:    route $DOMAIN -> http://localhost:8090 in Cloudflare Zero Trust" )
  open:      https://${DOMAIN:-$IP}/setup       (first run: create the admin, the organization and the first project)
  logs:      deploy/gcp/logs.sh
  upgrade:   deploy/gcp/up.sh --upgrade
DONE
