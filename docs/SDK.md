# The HanuAnalytics browser SDK (`hanu.js`)

One small script (≈8 KB gzipped) gives a site pageviews, sessions, visitors, referrers and UTM attribution,
click/form autocapture, JavaScript errors, Core Web Vitals and (when the project enables it) rrweb session
replay. It is the only thing you add to a site; everything else happens in the HanuAnalytics server.

## Install

### Script tag (recommended)

```html
<script async src="https://analytics.example.com/hanu.js" data-token="ha_pk_…"></script>
```

That is a complete installation: the SDK initialises itself from the tag. `analytics.example.com` is your
HanuAnalytics server; the token is the project's **public key** from *Settings → Snippet & keys*. The key is
not a secret: the server accepts it only from the domains listed in the project.

Attributes on the tag:

| attribute | default | meaning |
|---|---|---|
| `data-token` | — | the project's public key (required) |
| `data-api-host` | the script's origin | where to send data, e.g. `https://analytics.example.com` |
| `data-cookieless="true"` | off | store nothing on the device (no localStorage id, no cookie); see *Privacy* |
| `data-record="false"` | on | never load the session-recording bundle on this site, whatever the project says |
| `data-autocapture="false"` | on | turn off every automatic event; you call `hanu.capture` yourself |
| `data-respect-dnt="true"` | off | send nothing when the browser's Do-Not-Track is on |
| `data-debug="true"` | off | log what the SDK does to the console |

Calls made before the script has loaded are queued in `window.hanuq` and run in order once it is ready:

```html
<script>
  window.hanuq = window.hanuq || [];
  hanuq.push(["identify", "u_42", { plan: "pro" }]);
  hanuq.push(["capture", "signup", { plan: "pro" }]);
</script>
```

### npm / ESM

```sh
npm install @hanuanalytics/sdk
```

```ts
import hanu from "@hanuanalytics/sdk";
// or: import { init, capture, identify } from "@hanuanalytics/sdk";

hanu.init("ha_pk_…", { apiHost: "https://analytics.example.com" });
hanu.capture("signup", { plan: "pro" });
```

The ESM build has no side effects on import; nothing happens until `init`. The recording bundle is still fetched
from `<apiHost>/hanu-rec.js` on demand, so the server must be reachable from the page.

## `init(token, options)`

| option | type | default | meaning |
|---|---|---|---|
| `apiHost` | string | script origin | server URL, no trailing slash needed |
| `cookieless` | boolean | `false` | no device id is stored; the server counts visitors with a daily rotating hash |
| `record` | boolean | `true` | allow session recording (the project config decides whether it is on and the sample rate) |
| `autocapture` | boolean \| `{pageviews, clicks, forms, errors, vitals, scroll}` | project config | `false` turns everything off; an object overrides individual switches |
| `respectDnt` | boolean | `false` | honour Do-Not-Track locally (the project can also enforce it server side) |
| `sessionTimeoutMs` | number | 30 min | inactivity window; the project config wins when it sends one |
| `debug` | boolean | `false` | console logging |
| `beforeSend` | `(event) => boolean \| void` | — | inspect or drop every event (return `false` to drop); you may mutate `event.props` |

`init` is idempotent; the second call is ignored. It never throws.

## API

Everything lives on `window.hanu` (script tag) or the module's default export. Every call is wrapped: a bug in
the SDK or a blocked storage API can never break the host page.

| call | what it does |
|---|---|
| `capture(event, props?)` | send a custom event; props is a flat-ish JSON object (nested values are stored as JSON) |
| `pageview(props?)` | send a `$pageview` by hand (needed only with autocapture off) |
| `identify(id, set?, setOnce?)` | tie the visitor to your user id; `set` / `setOnce` update the person's properties (`setOnce` never overwrites) |
| `alias(id)` | link another id to the current one (sends `$alias`) |
| `setPersonProps(set, setOnce?)` | update person properties without an identify |
| `reset()` | log out: forget the identified id, start a new session (the device id stays so returning visitors are still returning) |
| `optOut()` / `optIn()` / `hasOptedOut()` | stop or resume all tracking for this device; remembered in `localStorage` (`hanu_optout`) |
| `startRecording()` / `stopRecording()` / `isRecording()` | control replay by hand (`startRecording` ignores sampling, but needs `record` not to be `false`) |
| `getDistinctId()` / `getSessionId()` | the ids the next event will carry |
| `flush()` | send whatever is queued now; returns a promise |
| `on("event", cb)` | observe every event as it is captured (after `beforeSend`); returns an unsubscribe function |
| `isEnabled()` | `true` once `init` ran and tracking is on (not a bot, not opted out) |

Mark elements with `data-hanu-no-capture` (or class `hanu-no-capture`) to exclude them from click autocapture;
`data-hanu-mask` / class `hanu-mask` masks their text in both autocapture and replay; class `hanu-block` hides an
element entirely from the replay. `data-hanu-name="checkout"` gives a button a stable name for the dashboard.

## What is sent

Each request is a JSON batch to `POST <apiHost>/api/v1/e` as `text/plain` (so no CORS preflight), at most 20
events, every 3 seconds, or immediately through `navigator.sendBeacon` when the page is hidden or unloaded.
Every event carries `distinct_id`, `anon_id` (device id, absent in cookieless mode), `session_id`, a timestamp,
and these base properties: `$current_url`, `$title`, `$screen_width/height`, `$viewport_width/height`,
`$language`, `$timezone`, plus `$is_new_visitor` during a device's first session and `$session_start` on the
first event of each session. The server adds geo (from the IP, which it does not store), browser/OS/device from
the user agent, and UTM / referrer classification from the URL.

| event | when | properties |
|---|---|---|
| `$pageview` | page load and every SPA navigation (`pushState`, `replaceState`, `popstate`, `hashchange`) | `$referrer` (document.referrer, or the previous in-app URL), `$prev_url` |
| `$pageleave` | tab hidden, page unloaded, or SPA navigation away | `$duration_ms` (time the page was visible), `$time_on_page_ms` (wall clock), `$scroll_depth` (0–100) |
| `$autocapture` | click on `a`, `button`, submit/button inputs, `[role=button]`, `label`, `summary`, `[data-hanu-capture]` | `$el_tag`, `$el_text` (≤120 chars; emails, card numbers and SSNs masked; nothing from inputs/textareas), `$el_id`, `$el_classes`, `$el_name`, `$el_href`, `$el_selector` |
| `$outbound` | click on a link to another host | `$href`, `$el_text`, `$el_selector` |
| `$download` | click on a link to pdf/zip/dmg/csv/xlsx/docx/mp4/… or with a `download` attribute | `$href`, `$el_text` |
| `$form_submit` | a form is submitted | `$form_id`, `$form_name`, `$form_action`, `$form_method`, `$el_selector` (never field values) |
| `$rageclick` | ≥3 clicks within 1 s inside a 30 px box | `$el_selector`, `$el_tag`, `$el_text` |
| `$exception` | `window.onerror`, `unhandledrejection` (max 10 per page) | `$message`, `$source`, `$line`, `$col`, `$stack` (≤4 KB), `$type` |
| `$web_vitals` | once per page, when the page is hidden/unloaded | `$lcp`, `$cls`, `$inp`, `$fcp`, `$ttfb` (ms, CLS unitless), `$vitals_url` |
| `$identify` | `identify()` | `$anon_distinct_id` plus `set` / `set_once` |
| `$alias`, `$set` | `alias()`, `setPersonProps()` | |
| `$recording_start` | a replay recording started for this session | `$session_id` |

## Sessions and visitors

* **Device id** `anon_id`: random, in `localStorage` (`hanu_did`), cookie `hanu_did` as a fallback. Never derived from anything personal.
* **Session id**: `sessionStorage` (`hanu_sid`, `hanu_sid_ts`); a new one after 30 minutes without an event. A new
  tab is a new session, like most analytics tools.
* **Distinct id**: the id you pass to `identify()` (`localStorage` `hanu_uid`), otherwise the device id.
* The project config is cached in `sessionStorage` (`hanu_cfg`) for ten minutes.

## Session replay

When the project has recording on, the SDK decides once per session (with the project's sample rate) whether to
record; the decision is kept in `sessionStorage` (`hanu_rec`) so reloads stay consistent. Only then does it load
`<apiHost>/hanu-rec.js` (rrweb, ≈22 KB gzipped). Recording options: all inputs masked by default (password,
email, phone, number fields always), text masked for `.hanu-mask` / the project's *mask text selector*, elements
hidden for `.hanu-block` / the project's *block selector*, mouse moves sampled at 50 ms, scrolls at 150 ms, a
fresh full snapshot every 5 minutes. Chunks go to `POST /api/v1/r` every 5 s / 50 events / 256 KB, gzipped with
`CompressionStream` when the browser has it; on unload a last uncompressed chunk is sent with `sendBeacon`. A
session rotation starts a new recording (sequence 0 with a full snapshot).

## Privacy

* No IP address is stored by the server; it is used once to derive country / region / city and then discarded.
* Nothing is captured from form fields, `textarea` or `select` elements; link text and button text are masked for
  emails, card-like numbers and SSN-like numbers.
* **Cookieless mode** (`data-cookieless="true"` or the project's setting): the SDK stores nothing at all on the
  device; the session id lives in memory only, and the server counts visitors through a salted hash that rotates
  daily, so no cross-day tracking exists. Identify still works for the current page load.
* **Opt-out**: `hanu.optOut()` stores a flag; a cookie banner can call it. `respectDnt` honours the browser setting.
* Bots, headless browsers and automation (`navigator.webdriver`) send nothing.

## Build and test

```sh
cd sdk
npm install
npm run build       # prints the gzipped sizes; core must stay ≤ 10 KB
npm test
npm run demo        # http://127.0.0.1:5174/?token=ha_pk_…  (server on http://127.0.0.1:8090)
```
