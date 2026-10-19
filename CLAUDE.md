# CLAUDE.md

HanuAnalytics: open-source product analytics + session replay on one free VM with a bucket as its home. Read
`README.md` first, then `docs/CONTRACT.md` (the API every part is built against). Keep this file short; details
live in `docs/`.

## Layout

| path | what | build / check |
|---|---|---|
| `src/` | Rust server: axum, DataFusion over Parquet, HanuDB client, embedded admin + SDK + home page | `cargo build`, `cargo test` |
| `sdk/` | browser SDK (TypeScript, esbuild) → `sdk/dist/hanu.js`, `hanu-rec.js`, `hanu.esm.js` | `npm run build`, `npm test` |
| `admin/` | React 19 + Vite + Tailwind v4 admin app → `admin/dist` (embedded) | `npm run check`, `npm run build`; `VITE_MOCK=1 npm run dev` works without a server |
| `site/` | the product home page (static HTML, embedded) | edit `site/index.html` |
| `deploy/` | Google Cloud scripts (`gcp/up.sh`, `--upgrade`, `set-google.sh`, `logs.sh`); `deploy/.env` is gitignored and holds the account details | |
| `scripts/` | `dev.sh` (HanuDB + server locally), `build.sh`, `smoke.sh` (end-to-end check), `seed.py` | |
| `docs/` | CONTRACT, DEPLOY, SDK, ADMIN, PRIVACY, ONBOARDING | |

## Rules

- **No cloud details in the repo**: project ids, IPs, domains of real deployments, tokens and secrets stay in
  `deploy/.env` and Secret Manager. Docs use `my-project` / `analytics.example.com`.
- The three parts (server, SDK, admin) are built against `docs/CONTRACT.md`; change the contract first when an
  API changes, then the parts.
- `admin/dist` and `sdk/dist` must exist for `cargo build` (rust-embed); run the npm builds first or
  `scripts/build.sh`. The release binary embeds whatever is in those folders at compile time: rebuild the
  front-ends before `deploy/build-linux.sh`.
- Never store raw IPs; visitors are counted by `anon_id` or a daily salted hash. Keep bots out of stats.
- Charts and tiles in the admin follow the dataviz rules (validated palette, one axis, thin marks, hover
  tooltips, dark mode selected not flipped).
- Counts in JSON are integers; nullable numbers (`p75`, event-level rows' `bounce_rate`) are `null`, and the
  admin renders "—" for them.

## Local run and checks

```sh
scripts/dev.sh                 # HanuDB (mem://) + server on :8090 (HANU_PORT=8095 if 8090 is taken)
scripts/seed.py <ha_pk_key> http://127.0.0.1:8090 40   # demo traffic
scripts/smoke.sh http://127.0.0.1:8090                  # every endpoint, exit 1 on failure
```

## Deploy

`deploy/gcp/up.sh` (first time) and `deploy/gcp/up.sh --upgrade` (new build) with `deploy/.env` filled from
`deploy/env.example`. `deploy/build-linux.sh` cross-compiles with `cargo zigbuild` (glibc 2.31). The VM runs
HanuDB, hanu and Caddy under systemd; `deploy/gcp/logs.sh` tails them through IAP.
