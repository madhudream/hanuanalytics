# Deploy HanuAnalytics on Google Cloud

One e2-micro (Always Free), one bucket, two Rust binaries, Caddy for HTTPS. The repository holds no cloud detail:
your project id, domain and names live in `deploy/.env` (gitignored) or are passed as flags.

## 0. Prerequisites

* `gcloud` logged in to the account that owns the project (`gcloud auth login`, `gcloud config set project ID`),
  billing enabled on the project (the free tier still needs a billing account).
* Rust (`rustup.rs`), Node 20+, and for the Linux build from a Mac: `brew install zig cargo-zigbuild`.
* A domain (or subdomain) you can point at an IP, e.g. `analytics.example.com`.

## 1. Deploy

```sh
cp deploy/env.example deploy/.env   # fill PROJECT, DOMAIN, EMAIL (ZONE defaults to us-central1-a)
deploy/gcp/up.sh
```

The script is idempotent; run it again after any failure. It:

1. builds `dist/hanu-linux-amd64` (SDK → admin → `cargo zigbuild`, glibc 2.31),
2. enables the APIs, creates the bucket `<project>-hanu` in the VM's region with a lifecycle rule (recording
   objects expire after 90 days as a backstop — the app applies each project's own retention earlier),
3. uploads the binary and this month's DB-IP City Lite GeoIP file into the bucket,
4. creates the `hanu@` service account (objectAdmin on the bucket, logging, secret access) and the secrets
   `hanudb-token` and `hanu-salt`,
5. opens 80/443 to the world and 22 only to IAP, reserves a static IP,
6. creates the VM with `deploy/gcp/startup.sh` as its startup script.

Then create a DNS **A record** `DOMAIN -> IP`. Caddy requests the Let's Encrypt certificate as soon as the name
resolves (it retries by itself). Open `https://DOMAIN/setup` and create the admin account, the organization and
the first project; the setup wizard shows the snippet and waits for the first event.

### Without a public IP (Cloudflare Tunnel)

Create a tunnel in Cloudflare Zero Trust, route `DOMAIN -> http://localhost:8090`, and run
`deploy/gcp/up.sh --tunnel <token>`. The VM gets no address at all; `cloudflared` connects out. Cloudflare's edge
then also caches `hanu.js`, absorbs bots, and gives you the WAF. The GeoIP file still works because `up.sh`
uploads it to the bucket (the VM reaches the bucket through Private Google Access).

## 2. What runs on the VM

| unit | listens | role | memory |
|---|---|---|---|
| `hanudb` | 127.0.0.1:8080 | users, orgs, projects, keys, session index, persons; truth in `gs://…/hanudb` | capped at 280 MB (`TWINDB_MAX_RSS_MB`) |
| `hanu` | 127.0.0.1:8090 | ingest, Parquet writer, DataFusion queries, admin API + app, SDK | ~60 MB idle, query budget 160 MB (`HANU_QUERY_MEM_MB`) |
| `caddy` | :80 / :443 | HTTPS, compression, reverse proxy | ~30 MB |

A 1 GB swap file is created on first boot; the kernel pages the memory-mapped GeoIP database (130 MB) in and out
as needed. Environment files: `/etc/hanudb.env`, `/etc/hanu.env`. Data: `/var/lib/hanudb`, `/var/lib/hanu`
(both are caches; wiping them and rebooting rebuilds from the bucket).

## 3. Operations

```sh
deploy/gcp/logs.sh              # journalctl -f for hanu, hanudb, caddy (through IAP)
deploy/gcp/ssh.sh               # a shell on the VM
deploy/gcp/up.sh --upgrade      # build, upload, re-run the startup script: new binary live in ~30 s
deploy/gcp/down.sh              # delete the VM (the bucket and secrets stay)
```

* **Flushes.** Events are buffered for up to 60 s (`HANU_FLUSH_SECS`) or 5 000 events, then written as one
  Parquet file per project per UTC day, to disk and to the bucket. A SIGTERM (`systemctl stop`, reboot) flushes
  everything first. The hourly job merges the previous hour's files; the daily job (00:20 UTC) merges whole days,
  applies each project's retention (events and recordings) and refreshes the GeoIP file monthly.
* **A new VM.** `deploy/gcp/up.sh` with the same bucket brings everything back: HanuDB rebuilds from its log and
  snapshots, `hanu` lists the bucket for its catalog and downloads days as dashboards ask for them.
* **Backups.** The bucket *is* the data. Turn on Object Versioning or a second region with
  `gcloud storage buckets update --versioning`, or HanuDB's twin-bucket mode for the database part.
* **The System page** (`/system`) shows HanuDB's status, the bucket, pending buffers, the GeoIP build, disk and
  memory, and has the compaction button and the sign-up switch (invite-only or open).

## 4. Cost (us-central1, 2026 list prices)

| item | monthly |
|---|---|
| e2-micro, 30 GB pd-standard | free (one per billing account in us-west1/us-central1/us-east1) |
| static external IP | free while attached to the free-tier VM; otherwise ~$3.6 (or use the tunnel: $0) |
| bucket storage | ~$0.02 per GB; a million events ≈ 60 MB; a 10-minute recording ≈ 300 KB |
| bucket writes | $5 per million; a site with constant traffic: ~1 500 writes/day ≈ $0.23 |
| egress | 1 GB free; `hanu.js` is 8 KB gzipped (100 000 pageviews ≈ 0.8 GB), or $0 behind Cloudflare |
| HanuDB | the same VM and bucket; its own writes are a few cents |

A small product with a few hundred thousand pageviews a month and recordings on: **under $1**.

## 5. Scaling past one VM

The design keeps the door open: `hanu` instances are stateless apart from their buffers, the bucket is the truth,
and HanuDB has followers and a leader lease. Before any of that, an e2-small (2 GB) or e2-medium (4 GB) with
`HANU_QUERY_MEM_MB=1024` serves tens of millions of events a month; change `--machine-type` in `up.sh`.
