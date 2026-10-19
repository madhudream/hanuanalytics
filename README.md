<p align="center"><img src="brand/logo.svg" width="128" alt="HanuAnalytics"></p>

# HanuAnalytics

Open-source product analytics and session replay that runs on **one free VM** with a **bucket as its home**.
Pageviews, visitors, sources, UTM campaigns, locations (city level), devices, custom events, funnels, retention,
JavaScript errors, Web Vitals, a live view, person profiles, **session recordings with replay** (rrweb), and a
read-only **SQL explorer** over your raw events. It replaces Google Analytics and the parts of PostHog most sites
use, with your data in your own bucket and a monthly bill of about one cent for the storage.

Built with [HanuDB](https://github.com/madhudream/hanudb) (the same "a VM is a cache, the bucket is the truth"
design) for the metadata, the session index and the person profiles; **Apache DataFusion** over **Parquet** for
the analytics; a Rust server (axum) that serves the SDK, the ingest API, the admin API and the admin app from
one binary; a 8 KB JavaScript SDK; and a React admin.

```
 your site  ──<script src=…/hanu.js>──▶  one e2-micro (free tier)            ──▶  GCS bucket (the truth)
                                         caddy :443 ─▶ hanu :8090 (Rust)           events/…   parquet, per project per day
                                                       └─ hanudb :8080 (Rust)       rec/…      rrweb chunks, gzip
                                         admin app, SDK, ingest, stats, replay      hanudb/…   HanuDB's log + snapshots
```

## Why it is cheap

* **No database server to pay for.** HanuDB runs on the same free e2-micro and keeps its truth in the bucket.
* **Events are Parquet files**, compressed with zstd, one file per project per day after compaction. A million
  events is about 60 MB of bucket storage ($0.001/month).
* **The bucket's only real cost is object writes** (class-A operations, $5 per million). Events are buffered for
  up to 60 s and written once; recording chunks are grouped into 512 KB objects. A busy site makes a few hundred
  writes a day: cents.
* **Queries never touch the bucket.** The VM's disk mirrors the files it needs and DataFusion scans them locally;
  a new VM pulls what it needs from the bucket on demand.
* **The SDK is small** (8 KB gzipped; the recording bundle is loaded only when recording is on) and the VM's free
  monthly egress covers millions of loads. Put the domain behind Cloudflare's free plan and the edge serves it.

## Quick start (your laptop)

```sh
# 1. HanuDB (the database) — one line, or build it from source
curl -fsSL https://raw.githubusercontent.com/madhudream/hanudb/main/install.sh | sh
# 2. build the SDK, the admin app and the server
scripts/build.sh            # needs Rust (rustup.rs) and Node 20+
# 3. run both locally (HanuDB with an in-memory bucket, hanu with a local directory as its bucket)
scripts/dev.sh              # -> http://127.0.0.1:8090
# 4. open http://127.0.0.1:8090/setup, create the admin + organization + project, copy the snippet
# 5. try the SDK demo against it
(cd sdk && npm run demo)    # -> http://127.0.0.1:5174/?token=ha_pk_…
# 6. everything in one check
scripts/smoke.sh
```

## Deploy on Google Cloud (free tier)

```sh
cp deploy/env.example deploy/.env      # project id, domain, email — deploy/.env is gitignored
deploy/gcp/up.sh                       # bucket, service account, secrets, VM, HTTPS; prints the IP
# create the DNS A record for the domain -> that IP, then open https://<domain>/setup
deploy/gcp/logs.sh                     # tail the logs through IAP
deploy/gcp/up.sh --upgrade             # roll out a new build
```

What `up.sh` creates: a bucket in the VM's region (with a lifecycle rule that expires recording objects after
90 days as a backstop), a service account that can only write that bucket and read two secrets, the secrets
(HanuDB's token, the visitor-hash salt), a static IP, firewall rules (80/443 public, ssh only through IAP), and
one e2-micro with no other access. The startup script installs Caddy (automatic HTTPS), fetches HanuDB from its
public release bucket and `hanu` from your bucket (both checksum-verified), and runs them under systemd with
memory limits suited to 1 GB. The full guide, including the Cloudflare Tunnel option (no public IP at all) and
what each piece costs, is in [docs/DEPLOY.md](docs/DEPLOY.md).

## Add it to a site

```html
<script async src="https://analytics.example.com/hanu.js" data-token="ha_pk_…"></script>
```

That is the whole install. Pageviews (including single-page-app navigations), clicks, outbound links, downloads,
form submits, rage clicks, JavaScript errors, Web Vitals and session recording are captured automatically;
`hanu.capture("signup", {plan: "pro"})` and `hanu.identify("user-42", {email: "…"})` add your own events and
people. Every project has an allow-list of domains; requests from anywhere else are refused. The SDK reference is
in [docs/SDK.md](docs/SDK.md), the npm/ESM build in `sdk/dist/hanu.esm.js`.

## Hosted beta

A hosted instance runs at [analytics.carebun.com](https://analytics.carebun.com): request an account on the home
page, free while in beta. The home page (`site/`) ships inside the binary, so every self-hosted instance has one too.

## Multi-tenant

One instance serves any number of organizations and projects. New organizations are created by the admin, by
invitation link, or — if you switch sign-up to *open* on the System page — by anyone who registers. Each
organization's members see only their projects. This is how one HanuAnalytics can serve all of your products,
or be offered to the public.

## Documentation

| | |
|---|---|
| [docs/CONTRACT.md](docs/CONTRACT.md) | the architecture and the API every part is built against |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Google Cloud deployment, costs, operations, upgrades, backups |
| [docs/SDK.md](docs/SDK.md) | the JavaScript SDK |
| [docs/ADMIN.md](docs/ADMIN.md) | the admin app (development, pages, adding panels) |
| [docs/PRIVACY.md](docs/PRIVACY.md) | what is collected, masking, cookieless mode, retention |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | hosted use: requesting access, approving requests, from invite to first event |

## Repository

```
src/        the Rust server (axum + DataFusion + the HanuDB client)
sdk/        the browser SDK (TypeScript, esbuild)            -> sdk/dist/hanu.js, hanu-rec.js, hanu.esm.js
admin/      the admin app (React, Vite, Tailwind, rrweb-player) -> admin/dist (embedded in the binary)
deploy/     Google Cloud scripts; deploy/.env (gitignored) holds your project details
scripts/    dev.sh, build.sh, smoke.sh, seed.py
brand/      the logo: Hanuman lifting the mountain
docs/       the documents above
```

GeoIP uses the free [DB-IP City Lite](https://db-ip.com) database (CC BY 4.0); the attribution is shown on the
System page. License: MIT.
