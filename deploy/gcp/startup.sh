#!/bin/bash
# HanuAnalytics VM startup (Debian 12 on GCE). Runs on every boot and on `up.sh --upgrade`.
# Installs Caddy, fetches HanuDB (public release bucket) and hanu (this project's bucket), reads the secrets,
# writes the systemd units and starts everything. Idempotent.
set -eu
md() { curl -sf -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true; }
BUCKET=$(md hanu-bucket); DOMAIN=$(md hanu-domain); EMAIL=$(md hanu-email); TUNNEL=$(md hanu-tunnel)
export DEBIAN_FRONTEND=noninteractive

# ---- swap: the e2-micro has 1 GB of RAM; 1 GB of swap keeps a burst from becoming an OOM kill
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
fi

# ---- packages
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq caddy curl >/dev/null
fi
if [ -n "$TUNNEL" ] && ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq && apt-get install -y -qq cloudflared >/dev/null
fi

mkdir -p /opt/hanu /var/lib/hanu /var/lib/hanudb

# ---- HanuDB (latest release, checksum verified)
REL=https://storage.googleapis.com/hanudb-releases/latest
cd /opt/hanu
curl -fsSL "$REL/hanudb-linux-amd64" -o hanudb.new
curl -fsSL "$REL/SHA256SUMS" | sed 's/hanudb-linux-amd64$/hanudb.new/' | grep ' hanudb.new$' | sha256sum -c - >/dev/null
chmod +x hanudb.new

# ---- hanu (from this project's bucket)
gcloud storage cp "gs://$BUCKET/bin/hanu-linux-amd64" hanu.new --quiet
gcloud storage cp "gs://$BUCKET/bin/hanu-linux-amd64.sha256" hanu.sha256 --quiet
sed 's/hanu-linux-amd64$/hanu.new/' hanu.sha256 | sha256sum -c - >/dev/null
chmod +x hanu.new

HANUDB_TOKEN=$(gcloud secrets versions access latest --secret hanudb-token)
SALT=$(gcloud secrets versions access latest --secret hanu-salt)

# ---- HanuDB: tuned for the 1 GB VM (the defaults assume it has the machine to itself)
cat > /etc/hanudb.env <<ENV
TWINDB_BUCKET=gs://$BUCKET/hanudb
TWINDB_DIR=/var/lib/hanudb
TWINDB_LISTEN=127.0.0.1:8080
TWINDB_TOKEN=$HANUDB_TOKEN
TWINDB_MAX_RSS_MB=280
TWINDB_CACHE_MB=32
TWINDB_KV_MEMTABLE_MB=32
TWINDB_KV_WRITE_BUFFER_MB=32
TWINDB_INDEX_HEAP_MB=32
TWINDB_FILTER_CACHE_MB=16
TWINDB_DOC_CACHE_ITEMS=50000
RUST_LOG=info
ENV
chmod 600 /etc/hanudb.env
cat > /etc/systemd/system/hanudb.service <<UNIT
[Unit]
Description=HanuDB
After=network-online.target
Wants=network-online.target
[Service]
EnvironmentFile=/etc/hanudb.env
ExecStart=/opt/hanu/hanudb serve
Restart=always
RestartSec=2
KillSignal=SIGINT
TimeoutStopSec=30
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
UNIT

# ---- hanu
PRIMARY=${DOMAIN%%,*}
PUBLIC_URL="https://${PRIMARY}"; [ -n "$DOMAIN" ] || PUBLIC_URL="http://$(curl -sf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || echo localhost)"
cat > /etc/hanu.env <<ENV
HANU_LISTEN=127.0.0.1:8090
HANU_BUCKET=gs://$BUCKET/hanu
HANU_DIR=/var/lib/hanu
HANUDB_URL=http://127.0.0.1:8080
HANUDB_TOKEN=$HANUDB_TOKEN
HANU_PUBLIC_URL=$PUBLIC_URL
HANU_SALT=$SALT
HANU_GEO=auto
HANU_QUERY_MEM_MB=160
HANU_FLUSH_SECS=60
HANU_FLUSH_EVENTS=5000
HANU_TRUST_PROXY=true
RUST_LOG=info,tower_http=warn,datafusion=warn
ENV
chmod 600 /etc/hanu.env
cat > /etc/systemd/system/hanu.service <<UNIT
[Unit]
Description=HanuAnalytics
After=network-online.target hanudb.service
Wants=network-online.target hanudb.service
[Service]
EnvironmentFile=/etc/hanu.env
ExecStart=/opt/hanu/hanu
Restart=always
RestartSec=2
# SIGTERM = flush buffered events and recordings to the bucket before exiting
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
UNIT

# ---- Caddy: HTTPS on the domain (or plain http on :80 without one); the tunnel talks to hanu directly
if [ -n "$DOMAIN" ] && [ -z "$TUNNEL" ]; then
cat > /etc/caddy/Caddyfile <<CADDY
{
	email ${EMAIL:-admin@$PRIMARY}
}
$(echo "$DOMAIN" | sed 's/,/, /g') {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8090
}
CADDY
elif [ -z "$TUNNEL" ]; then
cat > /etc/caddy/Caddyfile <<CADDY
:80 {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8090
}
CADDY
fi
if [ -n "$TUNNEL" ]; then
  TOKEN=$(gcloud secrets versions access latest --secret hanu-tunnel)
  cloudflared service install "$TOKEN" >/dev/null 2>&1 || true
  systemctl disable --now caddy >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl stop hanu 2>/dev/null || true
systemctl stop hanudb 2>/dev/null || true
mv hanudb.new hanudb
mv hanu.new hanu
systemctl enable --now hanudb
sleep 2
systemctl enable --now hanu
[ -n "$TUNNEL" ] || systemctl enable --now caddy && systemctl reload caddy 2>/dev/null || true
echo "hanu startup done"
