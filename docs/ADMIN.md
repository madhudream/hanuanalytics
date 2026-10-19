# HanuAnalytics admin app

The dashboard in `admin/` is a Vite + React 19 + TypeScript (strict) + Tailwind CSS v4 single-page app. The Rust
server embeds `admin/dist` and serves it for every non-`/api` path, so the only build artifact is that folder.

## Run

```sh
cd admin
npm install
npm run dev              # http://localhost:5173, proxies /api, /hanu.js, /hanu-rec.js to http://127.0.0.1:8090
VITE_MOCK=1 npm run dev  # the same UI on generated data, no server needed (or append ?mock=1 to any URL)
npm run check            # tsc --noEmit
npm run build            # admin/dist (what the server embeds)
```

`HANU_BACKEND=http://host:port npm run dev` points the proxy somewhere else. `?theme=light|dark` on any URL forces
a theme for the session (used for screenshots); the theme toggle in the sidebar persists to `localStorage.hanu_theme`.

## Where things are

| path | what |
|---|---|
| `src/api/types.ts` | the TypeScript mirror of `docs/CONTRACT.md` §3 and the `Api` interface both clients implement |
| `src/api/client.ts` | the real fetch client (`/api/admin/...`, cookie auth, `ApiError` on non-2xx) |
| `src/api/mock.ts` | deterministic generated data (seeded PRNG, 30+ days of traffic, sessions with a real rrweb recording) |
| `src/api/index.ts` | picks mock or real (`VITE_MOCK=1` or `?mock=1`) |
| `src/state/` | `auth` (me / setup status), `stats` (period + filters live in the URL), `query` (data hook that keeps the previous frame while refetching), `toast` |
| `src/components/` | `Layout` (sidebar, org/project switchers, theme), `BreakdownPanel` (tabbed top-N lists with details modal + table + CSV), `charts/` (TrendChart, Sparkline/Columns, FunnelChart), `StatTile`, `PeriodPicker`, `FilterChips`, `ui` primitives |
| `src/pages/` | one file per route |
| `src/index.css` | design tokens (light + dark, validated chart palette), component classes |

## Page map

| route | page |
|---|---|
| `/setup` | first-run wizard: account → org + project + domains → snippet with "waiting for first event" poll |
| `/login`, `/invite/:token` | sign in, accept invite |
| `/` | redirects to the first project |
| `/p/:id` | dashboard: period picker, compare, filter chips, KPI tiles, trend chart, Pages / Sources / Locations / Devices / Events / Web vitals panels |
| `/p/:id/live` | visitors now, per-minute columns, top pages, event feed (5 s refresh) |
| `/p/:id/events` | event list → property breakdown by any key |
| `/p/:id/funnels` | ordered steps + window → stepped columns with conversion |
| `/p/:id/retention` | weekly cohort heatmap |
| `/p/:id/errors` | grouped exceptions |
| `/p/:id/sessions`, `/p/:id/sessions/:sid` | session list, replay (rrweb-player) with click-to-seek timeline |
| `/p/:id/persons`, `/p/:id/persons/:did` | people and their sessions |
| `/p/:id/sql` | read-only SQL over `events`, CSV export |
| `/p/:id/settings?tab=` | general · domains · snippet · recording · retention · danger |
| `/org/:org/team`, `/org/:org/new-project`, `/org/new`, `/system` | team & invites, new project, new org, system status |

Clicking any row in a dashboard panel adds a filter (`filters` URL param, contract format); chips remove them.

## Adding a panel

1. Add the dimension to `Dimension` in `src/api/types.ts` if it is new (and to the contract first).
2. Drop a `<BreakdownPanel projectId={id} title="…" tabs={[{ value: "dim", label: "…" }]} />` into `Dashboard.tsx`.
   Rows, the details modal, table view, CSV and filter-on-click come for free.
3. For a new chart, follow the dataviz rules already used here: one hue per series (`--series-1…5`, validated in
   both themes), 2 px lines, ≤ 24 px bars with a square baseline, hairline grid, a hover tooltip, and a legend only
   when there are two or more series. Text never wears a series color.


## Added routes

* `/register` — open sign-up (shown only when the System page's sign-up switch is *open*; otherwise explains that the instance is invite-only).
* `/account` — change your name and password (linked from the sidebar footer).
* System page — the sign-up switch (instance admin only) and GeoIP / HanuDB / bucket / buffer status.
