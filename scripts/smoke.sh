#!/usr/bin/env bash
# End-to-end check against a running server (default http://127.0.0.1:8090): setup or login, SDK config with
# origin rules, event ingest (plain + gzip), flush, every stats endpoint, recording chunks and replay download,
# SQL guard. Exit 1 on the first failure.   scripts/smoke.sh [base_url]
set -euo pipefail
B=${1:-http://127.0.0.1:8090}
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "  ok  $*"; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "== $B"
curl -sf "$B/health" >/dev/null || fail "health"
needs=$(curl -sf "$B/api/admin/setup" | j "d['needs_setup']")
if [ "$needs" = "True" ]; then
  curl -sf -c "$T/cj" -X POST "$B/api/admin/setup" -H 'content-type: application/json' \
    -d '{"email":"smoke@example.com","password":"smoke-pass-123","name":"Smoke","org_name":"Smoke org","project_name":"Smoke site","domains":["example.com","localhost"]}' > "$T/setup.json" || fail "setup"
  ok "setup"
else
  curl -sf -c "$T/cj" -X POST "$B/api/admin/login" -H 'content-type: application/json' -d "{\"email\":\"${SMOKE_EMAIL:-smoke@example.com}\",\"password\":\"${SMOKE_PASSWORD:-smoke-pass-123}\"}" >/dev/null || fail "login (set SMOKE_EMAIL / SMOKE_PASSWORD)"
  ok "login"
fi
ME=$(curl -sf -b "$T/cj" "$B/api/admin/me")
PID=$(echo "$ME" | j "d['projects'][0]['id']"); KEY=$(echo "$ME" | j "d['projects'][0]['public_key']")
ok "project $PID"
A="$B/api/admin/projects/$PID"

curl -sf "$B/api/v1/config?token=$KEY" -H "Origin: https://example.com" | grep -q '"ok":true' || fail "config"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/config?token=$KEY" -H "Origin: https://evil.example")" = "403" ] || fail "origin check"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/config?token=ha_pk_bad" -H "Origin: https://example.com")" = "401" ] || fail "token check"
ok "config + origin + token checks"

python3 scripts/seed.py "$KEY" "$B" 6 https://example.com >/dev/null || fail "seed"
now=$(date +%s)000
curl -sf -X POST "$B/api/v1/e" -H 'content-type: text/plain' -H 'Origin: https://example.com' -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' \
  -d "{\"token\":\"$KEY\",\"sent_at\":$now,\"events\":[{\"event\":\"smoke_event\",\"ts\":$now,\"distinct_id\":\"smoke_user\",\"anon_id\":\"smoke_anon\",\"session_id\":\"s_smoke_$now\",\"props\":{\"\$current_url\":\"https://example.com/smoke\",\"\$session_start\":true,\"k\":\"v\"}}]}" | grep -q '"accepted":1' || fail "ingest"
ok "ingest"
printf '{"token":"%s","session_id":"s_smoke_%s","distinct_id":"smoke_user","seq":0,"ts":%s,"events":[{"type":4,"data":{"href":"https://example.com/smoke","width":1,"height":1},"timestamp":%s},{"type":2,"data":{"node":{"type":0,"childNodes":[],"id":1},"initialOffset":{"left":0,"top":0}},"timestamp":%s}]}' "$KEY" "$now" "$now" "$now" "$now" | gzip > "$T/rec.gz"
curl -sf -X POST "$B/api/v1/r" -H 'content-type: text/plain' -H 'content-encoding: gzip' -H 'Origin: https://example.com' --data-binary @"$T/rec.gz" | grep -q '"ok":true' || fail "recording ingest"
ok "recording ingest (gzip)"

echo "  waiting for the flush..."
for i in $(seq 1 40); do
  n=$(curl -sf -b "$T/cj" -X POST "$A/sql" -H 'content-type: application/json' -d "{\"sql\":\"SELECT count(*) FROM events WHERE event = 'smoke_event' AND session_id = 's_smoke_$now'\"}" | j "d['rows'][0][0]" 2>/dev/null || echo 0)
  [ "$n" = "1" ] && break; sleep 2
done
[ "$n" = "1" ] || fail "event not queryable after flush"
ok "flushed to parquet and visible to SQL"

v=$(curl -sf -b "$T/cj" "$A/stats/overview?period=today&compare=1" | j "d['totals']['visitors']"); [ "$v" -ge 1 ] || fail "overview"; ok "overview ($v visitors today)"
for by in path source entry_path exit_path country browser device screen event; do
  curl -sf -b "$T/cj" "$A/stats/breakdown?by=$by&period=30d" | grep -q '"rows"' || fail "breakdown $by"
done; ok "breakdowns"
curl -sf -b "$T/cj" "$A/stats/breakdown?by=path&period=30d&filters=%5B%7B%22key%22%3A%22device%22%2C%22op%22%3A%22is%22%2C%22value%22%3A%22desktop%22%7D%5D" | grep -q '"rows"' || fail "filters"; ok "filters"
curl -sf -b "$T/cj" "$A/stats/events?period=30d" | grep -q 'smoke_event' || fail "events list"; ok "events"
curl -sf -b "$T/cj" "$A/stats/events/smoke_event/props?period=30d&key=k" | grep -q '"v"' || fail "event props"; ok "event props (json_get_str)"
curl -sf -b "$T/cj" "$A/stats/funnel?period=30d&steps=\$pageview,signup" | grep -q '"steps"' || fail "funnel"; ok "funnel"
curl -sf -b "$T/cj" "$A/stats/retention" | grep -q '"cohorts"' || fail "retention"; ok "retention"
curl -sf -b "$T/cj" "$A/stats/errors?period=30d" | grep -q '"rows"' || fail "errors"; ok "errors"
curl -sf -b "$T/cj" "$A/stats/vitals?period=30d" | grep -q '"lcp"' || fail "vitals"; ok "vitals"
curl -sf -b "$T/cj" "$A/live" | grep -q '"online"' || fail "live"; ok "live"
curl -sf -b "$T/cj" "$A/sessions?period=today&has_recording=1" | grep -q "s_smoke_$now" || fail "sessions index"; ok "sessions index (HanuDB)"
curl -sf -b "$T/cj" "$A/sessions/s_smoke_$now/recording" | grep -q '"type":4' || fail "replay download"; ok "replay download"
curl -sf -b "$T/cj" "$A/persons?limit=5" | grep -q '"rows"' || fail "persons"; ok "persons"
curl -s -b "$T/cj" -X POST "$A/sql" -H 'content-type: application/json' -d '{"sql":"CREATE TABLE x AS SELECT 1"}' | grep -q 'read-only' || fail "sql guard"; ok "sql guard"
curl -sf -b "$T/cj" "$B/api/admin/system" | grep -q '"hanudb":{"ok":true' || fail "system / hanudb"; ok "system"
curl -sf "$B/hanu.js" | head -c 20 | grep -q . || fail "sdk served"; curl -sf "$B/" | grep -qi "<!doctype html>" || fail "admin served"; ok "sdk + admin served"
echo "SMOKE OK"
