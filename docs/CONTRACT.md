# HanuAnalytics — the contract between SDK, server and admin

Everything in this file is binding for the three parts of the product. The Rust server (`src/`), the browser
SDK (`sdk/`) and the admin app (`admin/`) are built against it in parallel; if a part needs something this
file does not say, add it here first.

## 1. Shape of the product

```
 browser (any site)                       one free e2-micro VM (same recipe as HanuDB)                     GCS bucket
 ┌───────────────────────┐    HTTPS       ┌──────────────────────────────────────────────┐              ┌───────────────┐
 │ <script src=hanu.js>  │ ────────────▶  │ caddy :443  ──▶ hanu :8090 (Rust, axum)      │  parquet     │ events/…      │
 │ pageviews, clicks,    │  POST /api/v1/e│   ├─ ingest: token + Origin check, geo, UA    │ ───────────▶ │ rec/…         │
 │ errors, vitals,       │  POST /api/v1/r│   ├─ buffer ─▶ parquet (disk cache + bucket)  │  gzip chunks │ geo/…         │
 │ rrweb recording       │                │   ├─ DataFusion SQL over the parquet (stats) │              └───────────────┘
 └───────────────────────┘                │   ├─ admin API + embedded admin SPA + SDK    │                     ▲
                                          │   └─ HanuDB client ─▶ hanudb :8080 (metadata, │   WAL segments      │
 admin (you) ──── HTTPS ─────────────────▶│        sessions index, persons)  ─────────────┼─────────────────────┘
                                          └──────────────────────────────────────────────┘
```

* **Events** are columnar: Parquet files in the bucket under `events/p=<project>/d=YYYY-MM-DD/<file>.parquet`,
  mirrored on the VM disk (the disk is a cache; the bucket is the truth, exactly like HanuDB).
* **Recordings** (rrweb) are gzip JSON chunks: `rec/p=<project>/s=<session>/<seq:06>.json.gz`.
* **Metadata** (users, orgs, members, invites, projects, settings) and the **session / person index** live in
  HanuDB collections. HanuDB runs on the same VM (`http://127.0.0.1:8080`, bearer token).
* One Rust binary, `hanu`, serves everything: the SDK file, the ingest API, the admin API and the admin app.

## 2. Public endpoints (used by the SDK; CORS from the project's allowed domains only)

All responses are JSON. The project **public key** (`ha_pk_` + 32 chars) is the token; it may be embedded in
pages. The server allows a request only when its `Origin` (fallback: `Referer`) host matches one of the
project's `domains` (`example.com` matches `example.com` and `www.example.com`; `*.example.com` matches any
subdomain; `localhost` and `127.0.0.1` with any port are allowed when listed). Failing that → `403 {"error":"origin not allowed"}`.
Requests without any Origin/Referer (curl, server side) are allowed only if the project has `allow_no_origin: true`.

### `GET /hanu.js` · `GET /hanu-rec.js`
The SDK core (small) and the lazily loaded recording bundle (rrweb). `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`, ETag, gzip/br.

The token may also be given as the query parameter `t` (or `token`) on any public endpoint. Preflight
`OPTIONS` requests are answered for any origin (`Access-Control-Allow-Headers: content-type, content-encoding`);
the real request is where the domain list is enforced. Known bots and headless browsers are accepted and dropped.

### `GET /api/v1/config?token=ha_pk_…`
```json
{ "ok": true, "project_id": "p_…",
  "recording":   { "enabled": true, "sample_rate": 1.0, "mask_all_inputs": true, "mask_text_selector": "", "block_selector": "", "min_duration_ms": 0 },
  "autocapture": { "pageviews": true, "clicks": true, "forms": true, "errors": true, "vitals": true, "scroll": true },
  "session_timeout_ms": 1800000, "cookieless": false, "respect_dnt": false, "server_time": 1760000000000 }
```

### `POST /api/v1/e` — events
`Content-Type: text/plain` or `application/json` (the SDK sends `text/plain` so beacons need no preflight);
optional `Content-Encoding: gzip`. Max 1 MB. Body:
```json
{ "token": "ha_pk_…", "sent_at": 1760000000000, "lib": "hanu-js", "lib_version": "0.1.0",
  "events": [ {
    "event": "$pageview", "ts": 1760000000000,
    "distinct_id": "u_42",            // identified id, else the anon id
    "anon_id": "a_…",                 // device id from localStorage; absent in cookieless mode
    "session_id": "s_…",              // 30 min inactivity window, kept in sessionStorage
    "props": { "$current_url": "https://x.com/a?utm_source=g", "$title": "A", "$referrer": "https://google.com/",
               "$screen_width": 1440, "$screen_height": 900, "$viewport_width": 1200, "$viewport_height": 800,
               "$language": "en-IN", "$timezone": "Asia/Kolkata", "$is_new_visitor": true, "$session_start": true,
               "plan": "pro" },
    "set": { "email": "a@b.c" }, "set_once": { "first_plan": "free" }
  } ] }
```
Response `200 {"ok":true,"accepted":3}`. Errors: `400` bad body, `401 {"error":"invalid token"}`, `403` origin, `413` too large.

**Standard events** (the SDK emits these names; the admin shows them with friendly labels):

| event | when | notable props |
|---|---|---|
| `$pageview` | load + SPA navigation | `$current_url`, `$title`, `$referrer`, `$prev_url` |
| `$pageleave` | hide/unload/navigation | `$duration_ms` (engaged time), `$scroll_depth` (0–100), `$current_url` |
| `$autocapture` | click on a/button/input[type=submit]/[role=button]/label | `$el_tag`, `$el_text` (≤120 chars, masked for inputs), `$el_id`, `$el_classes`, `$el_href`, `$el_selector`, `$el_name` |
| `$outbound` | click on a link to another host | `$href`, `$el_text` |
| `$download` | click on a link to pdf/zip/dmg/… | `$href` |
| `$form_submit` | form submit | `$form_id`, `$form_name`, `$form_action` |
| `$rageclick` | ≥3 clicks within 1 s on one spot | `$el_selector` |
| `$exception` | window.onerror / unhandledrejection | `$message`, `$source`, `$line`, `$col`, `$stack` (≤4 KB) |
| `$web_vitals` | once per page | `$lcp`, `$cls`, `$inp`, `$fcp`, `$ttfb` (ms, cls unitless) |
| `$identify` | `hanu.identify()` | `$anon_distinct_id` |
| `$recording_start` | recording began | `$session_id` |
| anything else | `hanu.capture(name, props)` | user props |

### `POST /api/v1/r` — recording chunk
Same content-type/encoding rules; max 4 MB. The SDK gzips with `CompressionStream` when available.
```json
{ "token": "ha_pk_…", "session_id": "s_…", "distinct_id": "u_42", "seq": 0, "ts": 1760000000000,
  "url": "https://x.com/a", "events": [ /* rrweb events, chunk 0 begins with a full snapshot */ ] }
```
Response `200 {"ok":true}`. `seq` starts at 0 per session and increases by 1 per chunk.

### Public, unauthenticated

| method · path | body → response |
|---|---|
| `GET /` | the home page (`site/index.html`) for visitors, the admin app for a valid session cookie; `GET /home` always the home page; `GET /site/<file>` its assets |
| `POST /api/public/request` | `{name,email,website?,message?}` → `{ok:true,id}` (rate-limited per IP; honeypot field `company_url` must be empty) |

## 3. Admin API (`/api/admin/…`, cookie session)

Cookie `hanu_s` (HttpOnly, SameSite=Lax, JWT HS256, 30 days). Errors are `{"error":"…"}` with 400/401/403/404/409/500.
Ids: users `u_…`, orgs `o_…`, projects `p_…`, invites `i_…`. Timestamps are ISO-8601 UTC strings unless named `*_ms`.

```ts
type Role = "owner" | "admin" | "member";
interface User    { id: string; email: string; name: string; created_at: string }
interface Org     { id: string; name: string; created_at: string; role: Role }
interface RecordingConfig { enabled: boolean; sample_rate: number; mask_all_inputs: boolean; mask_text_selector: string; block_selector: string; min_duration_ms: number }
interface AutocaptureConfig { pageviews: boolean; clicks: boolean; forms: boolean; errors: boolean; vitals: boolean; scroll: boolean }
interface Project { id: string; org_id: string; name: string; public_key: string; domains: string[]; allow_no_origin: boolean;
                    timezone: string; recording: RecordingConfig; autocapture: AutocaptureConfig; cookieless: boolean;
                    retention_days: number; recording_retention_days: number; created_at: string }
```

| method · path | body → response |
|---|---|
| `GET /setup` | → `{needs_setup: boolean, signup_open: boolean, version}` (`needs_setup` is true until the first user exists) |
| `POST /register` | `{email,password,name,org_name?}` → `{user, org}` + cookie; only when the instance's sign-up mode is `open` (403 otherwise) |
| `POST /setup` | `{email,password,name,org_name,project_name,domains:string[]}` → `{user,org,project}` + cookie (409 once set up) |
| `POST /login` | `{email,password}` → `{user}` + cookie |
| `POST /logout` | → `{ok:true}` |
| `GET /me` | → `{user, orgs: Org[], projects: Project[], is_instance_admin: boolean}` (the first account created at setup is the instance admin) |
| `PATCH /me` | `{name?, password?, current_password?}` → `{user}` |
| `POST /orgs` | `{name}` → `Org` |
| `PATCH /orgs/:org` | `{name}` → `Org` |
| `GET /orgs/:org/members` | → `{members:[{user_id,email,name,role,joined_at}], invites:[{id,email,role,created_at,expires_at,url}]}` |
| `POST /orgs/:org/invites` | `{email, role}` → `{invite}` (the `url` is shown to the admin to share; no email is sent) |
| `DELETE /orgs/:org/invites/:id` | → `{ok}` |
| `PATCH /orgs/:org/members/:user_id` | `{role}` → `{ok}` |
| `DELETE /orgs/:org/members/:user_id` | → `{ok}` |
| `GET /invites/:token` | → `{org_name, email, invited_by}` (no auth) |
| `POST /invites/:token/accept` | `{name,password}` → `{user}` + cookie (an existing user with that email just joins) |
| `POST /orgs/:org/projects` | `{name, domains, timezone?}` → `Project` |
| `GET /projects/:id` | → `Project` |
| `PATCH /projects/:id` | any subset of Project's editable fields → `Project` |
| `POST /projects/:id/rotate-key` | → `Project` |
| `DELETE /projects/:id` | → `{ok}` (owner/admin) |
| `GET /oauth/google/start?next=/&invite=` | redirects to Google (when configured); the callback `GET /oauth/google/callback` sets the cookie and redirects to `next`, or to `/login?error=…` |
| `GET /users` | → `{totals:{users,orgs,projects}, rows:[{id,email,name,created_at,sign_in:"google"\|"password",is_instance_admin,orgs:[{org_id,org_name,role,projects}]}]}` (instance admin) |
| `GET /requests?status=new\|approved\|rejected\|all` | → `{rows: Request[]}` (instance admin); `Request = {id,name,email,website,message,created_at,status,invite_url?,org_id?,decided_at?}` |
| `POST /requests/:id/approve` | `{org_name?}` → `{request}` (creates an org + owner invite; the admin sends the link) |
| `POST /requests/:id/reject` | → `{request}` |
| `GET /system` | → `{version, node, uptime_s, hanudb:{ok,url,status?}, store:{kind,url,ok,uploads_ok,uploads_failed}, buffer:{pending_events,last_flush_at,events_written,index_pending,recording_pending_bytes}, geo:{loaded,build,attribution}, files:{events,event_days,disk_used_bytes}, live:{events_30m}, memory:{used_mb,total_mb}, signup_mode, public_url}` |
| `PATCH /system` | `{signup_mode: "invite" \| "open"}` → `{ok}` (instance admin only) |
| `POST /system/compact` | → `{merged_files, ms}` |

### Stats (all `GET /projects/:id/stats/…`)

Common query parameters: `period=today|yesterday|7d|30d|90d|12mo|month|all|custom` (default `7d`), with `custom`:
`from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, in the project's timezone); `tz` overrides the project timezone;
`filters` = URL-encoded JSON `[{"key":"path","op":"is|is_not|contains","value":"/pricing"}]` where key is any
breakdown dimension below or `event`; `compare=1` adds the previous period. Bots are always excluded.

| path | response |
|---|---|
| `overview?interval=auto\|hour\|day\|week\|month` | `{ interval, period:{from,to,tz}, totals: T, prev: T \| null, series: [{t:"2026-10-19T00:00:00+05:30", visitors, pageviews, sessions}] }` where `T = {visitors, pageviews, sessions, events, bounce_rate (0-100), avg_duration_s, views_per_session}` |
| `breakdown?by=<dim>&limit=10&offset=0` | `{ by, rows:[{key, label?, visitors, pageviews, sessions, bounce_rate, avg_duration_s, pct}], total_visitors }` |
| `events?limit=50` | `{ rows:[{event, count, visitors, sessions}] }` |
| `events/:event/keys` | `{ keys: string[] }` (property keys seen on that event) |
| `events/:event/props?key=plan&limit=20` | `{ rows:[{key, count, visitors}] }` |
| `funnel?steps=$pageview,signup,purchase&window_days=7` | `{ steps:[{event, count, pct (of first), drop_pct}] }` |
| `retention` | `{ cohorts:[{cohort:"2026-W40", start:"2026-09-28", size, weeks:[100, 42, 30, …]}] }` (8 weeks) |
| `errors?limit=50` | `{ rows:[{message, count, visitors, last_seen, sample_url}] }` |
| `vitals` | `{ lcp:{p75, good, needs_improvement, poor, n}, cls:…, inp:…, fcp:…, ttfb:… }` (counts are sample counts) |

Rows of event-level dimensions (`path`, `country`, `browser`, …) carry `visitors`, `pageviews`, `sessions`, `pct`;
rows of session-attributed dimensions (`source`, `medium`, `campaign`, `term`, `content`, `referrer`,
`referrer_domain`, `entry_path`, `exit_path`) also carry `bounce_rate` and `avg_duration_s`. Counts are integers.
Funnels and retention follow the device (`visitor`), so a visitor who identifies mid-way still converts.

Breakdown dimensions `by`: `path`, `hostname`, `entry_path`, `exit_path`, `referrer`, `referrer_domain`,
`source`, `medium`, `campaign`, `term`, `content`, `country` (key = ISO-2, `label` = name), `region`, `city`,
`browser`, `browser_version`, `os`, `os_version`, `device` (`desktop|mobile|tablet`), `screen`, `language`, `event`.

### Live, sessions, persons, SQL

| method · path | response |
|---|---|
| `GET /projects/:id/live` | `{ online (distinct visitors, last 5 min), series:[{t, visitors}] (per minute, 30 min), pages:[{path, visitors}], events:[{ts, event, path, country, city, browser, device, distinct_id, session_id}] (newest 50) }` |
| `GET /projects/:id/sessions?period…&has_recording=1&distinct_id=&country=&limit=50&offset=0` | `{ rows: Session[], total }` |
| `GET /projects/:id/sessions/:sid` | `{ session: Session, events:[{ts, event, path, url, props}] }` |
| `GET /projects/:id/sessions/:sid/recording` | the rrweb event array for the whole session (JSON, gzip transport); 404 if none |
| `GET /projects/:id/persons?q=&limit=50&offset=0` | `{ rows: Person[], total }` |
| `GET /projects/:id/persons/:did` | `{ person: Person, sessions: Session[] }` |
| `POST /projects/:id/sql` | `{sql, limit?}` → `{ columns:[{name,type}], rows: any[][], took_ms, truncated }` — read-only SQL over the table `events` (this project only), DataFusion dialect |

```ts
interface Session { id: string; session_id: string; distinct_id: string; start: string; end: string; duration_s: number;
                    pageviews: number; events: number; clicks: number; errors: number; entry_path: string; exit_path: string;
                    country: string; region: string; city: string; browser: string; os: string; device: string;
                    referrer_domain: string; source: string; has_recording: boolean; rec_chunks: number; rec_bytes: number; rec_duration_s: number }
interface Person  { distinct_id: string; props: Record<string, unknown>; first_seen: string; last_seen: string; sessions: number; is_identified: boolean }
```

### The `events` table (what SQL and the stats see)

| column | type | notes |
|---|---|---|
| ts | TIMESTAMP(ms, UTC) | event time (client clock corrected by `sent_at` vs server time) |
| event | VARCHAR | |
| distinct_id, anon_id, session_id | VARCHAR | |
| visitor | VARCHAR | the id stats count as a "visitor": `anon_id`, or the daily rotating hash in cookieless mode |
| url, host, path, title, referrer, referrer_domain | VARCHAR | |
| source, medium, campaign, term, content | VARCHAR | utm_*; `source` falls back to a classified referrer (Google, Twitter/X, Direct, …) |
| country, region, city | VARCHAR | from DB-IP City Lite (country is ISO-2) |
| browser, browser_version, os, os_version, device | VARCHAR | device ∈ desktop, mobile, tablet, bot |
| screen_w, screen_h, viewport_w, viewport_h | INT32 | |
| language, timezone | VARCHAR | |
| is_new_visitor, is_session_start | BOOLEAN | |
| duration_ms, scroll_depth | INT32 | from `$pageleave` |
| props | VARCHAR (JSON) | the remaining custom props; `json_get_str(props, 'plan')` is registered as a UDF for SQL |
| lib_version | VARCHAR | |

## 4. SDK behaviour (what `hanu.js` must do)

```html
<script async src="https://analytics.example.com/hanu.js" data-token="ha_pk_…"></script>
<script>window.hanuq = window.hanuq || []; hanuq.push(["capture", "signup", {plan: "pro"}]);</script>
```
* `data-api-host` (default: the script's origin), `data-cookieless="true"`, `data-record="false"`, `data-autocapture="false"`.
* Public API on `window.hanu`: `init(token, opts)`, `capture(event, props?)`, `pageview()`, `identify(id, set?, setOnce?)`,
  `alias(id)`, `reset()`, `setPersonProps(set, setOnce?)`, `optOut()`, `optIn()`, `hasOptedOut()`,
  `startRecording()`, `stopRecording()`, `getDistinctId()`, `getSessionId()`, `flush()`, `on("event", cb)`.
* Fetches `/api/v1/config` once (cached in sessionStorage for 10 min); recording starts only when enabled and the
  session is sampled in (decision kept per session in sessionStorage).
* ids: `anon_id` in localStorage `hanu_did` (fallback cookie), `session_id` in sessionStorage `hanu_sid` + last
  activity ts; rotate after `session_timeout_ms` idle; `distinct_id` = identified id (localStorage `hanu_uid`) or anon.
* Batching: queue; flush every 3 s, or at 20 events, on `visibilitychange`/`pagehide` using `navigator.sendBeacon`
  (fallback `fetch keepalive`). Retries once on network error. `$pageleave` is sent with the beacon.
* SPA: patch `history.pushState/replaceState` + `popstate` → `$pageleave` for the old url, `$pageview` for the new.
* Recording: lazy-load `/hanu-rec.js` (rrweb `record`), `maskAllInputs` from config, `sampling: {mousemove: 50, scroll: 150, input: "last"}`,
  `checkoutEveryNms: 300000`, chunks flushed every 5 s or 50 events or 256 KB; `seq` is per session; a new tab or
  a session rotation starts a new recording (seq 0 with a fresh full snapshot).
* Bots and headless browsers (`navigator.webdriver`, UA matches bot/crawler/spider/headless) send nothing.
* Everything degrades silently: never throw into the host page; total core size target ≤ 10 KB gzipped.
* Bundles: `sdk/dist/hanu.js` (IIFE), `sdk/dist/hanu-rec.js` (IIFE exposing `window.__hanuRecord = rrweb.record`),
  `sdk/dist/hanu.esm.js` (ESM `init` etc. for npm users).

## 5. Admin app routes

`/setup`, `/login`, `/invite/:token`, `/` → first project, `/p/:id` (dashboard), `/p/:id/live`, `/p/:id/events`,
`/p/:id/funnels`, `/p/:id/retention`, `/p/:id/errors`, `/p/:id/sessions`, `/p/:id/sessions/:sid` (replay),
`/p/:id/persons`, `/p/:id/persons/:did`, `/p/:id/sql`, `/p/:id/settings` (general · domains · snippet & keys ·
recording · retention · danger zone), `/org/:org/team`, `/org/:org/new-project`, `/system`, `/register`
(open sign-up), `/account` (name, password).
The server serves `admin/dist/index.html` for every non-`/api` path (SPA fallback); assets under `/assets/`.

## 6. Where things live in the bucket / on disk

```
events/p=<project>/d=YYYY-MM-DD/<HHMMSS>-<node>-<n>.parquet   zstd, sorted by ts; compacted hourly, then daily
rec/p=<project>/s=<session>/000000.json.gz …                    one object per flushed chunk group
geo/dbip-city-lite-YYYY-MM.mmdb                                 cached copy of the monthly DB-IP City Lite file
```
HanuDB collections: `users`, `orgs`, `members` (`_id = org:user`), `invites`, `projects`, `settings`
(`_id = jwt_secret`), `sessions` (`_id = project:session`), `persons` (`_id = project:distinct_id`).
