// A deterministic, in-memory implementation of the Api for development and screenshots (VITE_MOCK=1 / ?mock=1).
import type {
  Api, Breakdown, BreakdownRow, Cohort, Dimension, ErrorRow, EventRow, FunnelStep, Interval, Invite, Live, LiveEvent,
  Me, Member, Org, Overview, Person, Project, ProjectPatch, Role, SeriesPoint, Session, SessionDetail, SessionEvent,
  AccessRequest, Accounts, SessionsQuery, SignupMode, SqlResult, StatsQuery, SystemInfo, Totals, User, Vitals,
} from "./types";
import { ApiError } from "./types";
import { hashStr, pick, pickW, rng } from "../lib/seed";
import { autoInterval, periodRange } from "../lib/period";
import { countryName } from "../lib/countries";
import { isoDate } from "../lib/format";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date();

// ---------- static catalog ----------
const PATHS: readonly (readonly [string, number])[] = [
  ["/", 40], ["/pricing", 14], ["/blog", 10], ["/blog/why-we-built-hanuanalytics", 9], ["/docs", 8], ["/docs/sdk", 6],
  ["/signup", 5], ["/login", 4], ["/about", 3], ["/blog/cost-saving-analytics", 3], ["/changelog", 2], ["/careers", 1],
];
const REFERRERS: readonly (readonly [string, number])[] = [
  ["Direct", 38], ["google.com", 26], ["news.ycombinator.com", 8], ["x.com", 7], ["github.com", 6], ["linkedin.com", 4],
  ["reddit.com", 3], ["bing.com", 2], ["duckduckgo.com", 2], ["producthunt.com", 2], ["dev.to", 1], ["medium.com", 1],
];
const SOURCES: readonly (readonly [string, number])[] = [
  ["Direct", 38], ["Google", 28], ["Hacker News", 8], ["X", 7], ["GitHub", 6], ["LinkedIn", 4], ["Reddit", 3], ["newsletter", 3], ["Bing", 2], ["Product Hunt", 1],
];
const MEDIUMS: readonly (readonly [string, number])[] = [["(none)", 60], ["organic", 20], ["social", 10], ["email", 6], ["cpc", 4]];
const CAMPAIGNS: readonly (readonly [string, number])[] = [["(none)", 70], ["launch-oct", 14], ["weekly-digest", 9], ["hn-post", 7]];
const COUNTRIES: readonly (readonly [string, number])[] = [
  ["IN", 34], ["US", 22], ["GB", 8], ["DE", 6], ["CA", 4], ["AU", 3], ["SG", 3], ["FR", 3], ["BR", 3], ["AE", 2], ["NL", 2], ["JP", 2], ["ID", 2], ["ES", 1], ["IT", 1], ["PK", 1], ["BD", 1], ["NG", 1], ["KR", 1],
];
const CITIES: Record<string, readonly (readonly [string, string, number])[]> = {
  IN: [["Bengaluru", "Karnataka", 30], ["Hyderabad", "Telangana", 20], ["Mumbai", "Maharashtra", 18], ["Delhi", "Delhi", 15], ["Chennai", "Tamil Nadu", 9], ["Pune", "Maharashtra", 8]],
  US: [["San Francisco", "California", 25], ["New York", "New York", 22], ["Seattle", "Washington", 12], ["Austin", "Texas", 10], ["Chicago", "Illinois", 8], ["Boston", "Massachusetts", 6]],
  GB: [["London", "England", 60], ["Manchester", "England", 15], ["Edinburgh", "Scotland", 10]],
  DE: [["Berlin", "Berlin", 50], ["Munich", "Bavaria", 25], ["Hamburg", "Hamburg", 15]],
  CA: [["Toronto", "Ontario", 50], ["Vancouver", "British Columbia", 30]],
  AU: [["Sydney", "New South Wales", 55], ["Melbourne", "Victoria", 35]],
  SG: [["Singapore", "Singapore", 100]],
  FR: [["Paris", "Île-de-France", 70], ["Lyon", "Auvergne-Rhône-Alpes", 20]],
  BR: [["São Paulo", "São Paulo", 60], ["Rio de Janeiro", "Rio de Janeiro", 25]],
};
const BROWSERS: readonly (readonly [string, number])[] = [["Chrome", 62], ["Safari", 20], ["Firefox", 8], ["Edge", 7], ["Samsung Internet", 2], ["Opera", 1]];
const OSES: readonly (readonly [string, number])[] = [["Windows", 34], ["Android", 26], ["macOS", 20], ["iOS", 15], ["Linux", 4], ["ChromeOS", 1]];
const DEVICES: readonly (readonly [string, number])[] = [["desktop", 58], ["mobile", 38], ["tablet", 4]];
const SCREENS: readonly (readonly [string, number])[] = [["1920x1080", 30], ["390x844", 20], ["1440x900", 14], ["1536x864", 10], ["412x915", 9], ["1366x768", 8], ["2560x1440", 5], ["768x1024", 4]];
const LANGS: readonly (readonly [string, number])[] = [["en-US", 40], ["en-IN", 26], ["en-GB", 10], ["de-DE", 6], ["hi-IN", 5], ["fr-FR", 4], ["pt-BR", 3], ["ja-JP", 2], ["es-ES", 2], ["id-ID", 2]];
const EVENTS: readonly (readonly [string, number])[] = [
  ["$pageview", 100], ["$pageleave", 92], ["$autocapture", 60], ["$web_vitals", 40], ["signup", 6], ["pricing_viewed", 12],
  ["$outbound", 7], ["demo_requested", 2], ["$form_submit", 4], ["$exception", 3], ["$rageclick", 1], ["purchase", 1.2], ["$identify", 5],
];
const ERRORS: readonly (readonly [string, string])[] = [
  ["TypeError: Cannot read properties of undefined (reading 'map')", "/pricing"],
  ["ReferenceError: gtag is not defined", "/"],
  ["ChunkLoadError: Loading chunk 42 failed", "/docs/sdk"],
  ["TypeError: Failed to fetch", "/signup"],
  ["SyntaxError: Unexpected token < in JSON at position 0", "/blog"],
  ["Error: Network request timed out", "/login"],
];

// ---------- account state ----------
// mock-only switches for screenshots: ?fresh=1 shows the setup wizard, ?signup=open opens registration
const mockParams = new URLSearchParams(location.search);
let setupDone = !mockParams.has("fresh");
let signupMode: SignupMode = mockParams.get("signup") === "open" ? "open" : "invite";
const requests: AccessRequest[] = [
  { id: "r_5", name: "Kavya Nair", email: "kavya@shopkart.in", website: "https://shopkart.in", message: "We run a D2C store with ~200k monthly visitors and want to drop GA. Session replay is the main draw.", created_at: new Date(Date.now() - 2 * 3600000).toISOString(), status: "new" },
  { id: "r_4", name: "Tom Becker", email: "tom@becker.dev", website: "becker.dev", message: "Personal blog, low traffic. Curious about the cookieless mode.", created_at: new Date(Date.now() - 9 * 3600000).toISOString(), status: "new" },
  { id: "r_3", name: "Ananya Rao", email: "ananya@fintrail.app", website: "https://app.fintrail.app", message: "Fintech dashboard; need input masking guarantees before we can record anything. Happy to share our DPA requirements — they are long, so here is the short version: no raw IPs, inputs masked client-side, EU data residency optional.", created_at: new Date(Date.now() - 30 * 3600000).toISOString(), status: "approved", invite_url: "https://analytics.example.com/invite/inv_9k2m1a", org_id: "o_7", decided_at: new Date(Date.now() - 26 * 3600000).toISOString() },
  { id: "r_2", name: "spam bot", email: "win@prizes.example", website: "http://prizes.example", message: "CLICK HERE TO WIN", created_at: new Date(Date.now() - 3 * 86400000).toISOString(), status: "rejected", decided_at: new Date(Date.now() - 3 * 86400000 + 600000).toISOString() },
  { id: "r_1", name: "Priya Menon", email: "priya@example.com", website: "https://bigindianhub.com", message: "Founder here — this is for our main site.", created_at: new Date(Date.now() - 6 * 86400000).toISOString(), status: "approved", invite_url: "https://analytics.example.com/invite/inv_3f8c2d", org_id: "o_1", decided_at: new Date(Date.now() - 6 * 86400000 + 3600000).toISOString() },
];
const users: User[] = [{ id: "u_1", email: "admin@example.com", name: "Madhu", created_at: "2026-09-01T10:00:00Z" }];
let orgs: Org[] = [{ id: "o_1", name: "Big Indian Hub", created_at: "2026-09-01T10:00:00Z", role: "owner" }];
const members: Record<string, Member[]> = {
  o_1: [
    { user_id: "u_1", email: "admin@example.com", name: "Madhu", role: "owner", joined_at: "2026-09-01T10:00:00Z" },
    { user_id: "u_2", email: "priya@example.com", name: "Priya", role: "admin", joined_at: "2026-09-12T08:30:00Z" },
    { user_id: "u_3", email: "arjun@example.com", name: "Arjun", role: "member", joined_at: "2026-10-02T15:12:00Z" },
  ],
};
const invites: Record<string, Invite[]> = {
  o_1: [{ id: "i_1", email: "sam@example.com", role: "member", created_at: "2026-10-15T09:00:00Z", expires_at: "2026-10-22T09:00:00Z", url: "https://analytics.example.com/invite/inv_7f3a9c" }],
};
const defaultRecording = () => ({ enabled: true, sample_rate: 1, mask_all_inputs: true, mask_text_selector: "", block_selector: "", min_duration_ms: 0 });
const defaultAutocapture = () => ({ pageviews: true, clicks: true, forms: true, errors: true, vitals: true, scroll: true });
let projects: Project[] = [
  {
    id: "p_bih", org_id: "o_1", name: "bigindianhub.com", public_key: "ha_pk_7Qm2xk9ZpL4vT8wR1nB6cH3jF5sD0aG2", domains: ["bigindianhub.com", "*.bigindianhub.com", "localhost"],
    allow_no_origin: false, apps: [], timezone: "Asia/Kolkata", recording: defaultRecording(), autocapture: defaultAutocapture(), cookieless: false,
    retention_days: 365, recording_retention_days: 30, created_at: "2026-09-01T10:05:00Z",
  },
  {
    id: "p_docs", org_id: "o_1", name: "docs.hanu.dev", public_key: "ha_pk_Ab3dE6fG9hJ2kL5mN8pQ1rS4tU7vW0xY", domains: ["docs.hanu.dev"], allow_no_origin: false, apps: [],
    timezone: "UTC", recording: { ...defaultRecording(), enabled: false }, autocapture: defaultAutocapture(), cookieless: true,
    retention_days: 180, recording_retention_days: 14, created_at: "2026-09-20T12:00:00Z",
  },
];

// ---------- traffic model ----------
function projectScale(id: string): number {
  return id === "p_bih" ? 1 : 0.22;
}

/** visitors on a given local day; weekly seasonality + slow growth + a launch spike */
function dayVisitors(id: string, d: Date): number {
  const r = rng(hashStr(id + isoDate(d)));
  const dow = d.getDay();
  const weekday = dow === 0 || dow === 6 ? 0.62 : 1;
  const age = (now().getTime() - d.getTime()) / 86400000;
  const growth = Math.max(0.35, 1 - age / 220);
  const spike = age > 10.5 && age < 11.5 ? 3.4 : age > 11.5 && age < 13.5 ? 1.6 : 1;
  return Math.round(1850 * weekday * growth * spike * (0.85 + r() * 0.3) * projectScale(id));
}

function hourShape(h: number): number {
  // India/US mixed audience: a daytime bump and an evening bump
  const a = Math.exp(-((h - 11) ** 2) / 18);
  const b = Math.exp(-((h - 20) ** 2) / 14);
  return 0.25 + a + 0.8 * b;
}

function filterFactor(q: StatsQuery): number {
  if (!q.filters || !q.filters.length) return 1;
  let f = 1;
  for (const fl of q.filters) {
    const r = rng(hashStr(fl.key + fl.op + fl.value));
    f *= fl.op === "is_not" ? 0.7 + r() * 0.2 : 0.08 + r() * 0.3;
  }
  return f;
}

function totalsFor(id: string, start: Date, end: Date, factor: number): Totals {
  let visitors = 0;
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) visitors += dayVisitors(id, d);
  const r = rng(hashStr(id + isoDate(start) + isoDate(end)));
  visitors = Math.round(visitors * factor);
  const sessions = Math.round(visitors * (1.18 + r() * 0.1));
  const pageviews = Math.round(sessions * (2.6 + r() * 0.5));
  return {
    visitors, pageviews, sessions, events: Math.round(pageviews * 3.1),
    bounce_rate: 41 + r() * 8, avg_duration_s: 96 + r() * 40, views_per_session: sessions ? pageviews / sessions : 0,
  };
}

function seriesFor(id: string, start: Date, end: Date, interval: Exclude<Interval, "auto">, factor: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const isToday = (d: Date) => isoDate(d) === isoDate(now());
  const nowH = now().getHours();
  if (interval === "hour") {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
      const dv = dayVisitors(id, d);
      const shape = Array.from({ length: 24 }, (_, h) => hourShape(h));
      const sum = shape.reduce((a, b) => a + b, 0);
      for (let h = 0; h < 24; h++) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
        if (isToday(d) && h > nowH) break;
        const r = rng(hashStr(id + t.toISOString()));
        const visitors = Math.round((dv * shape[h]! * factor) / sum * (0.85 + r() * 0.3));
        out.push({ t: t.toISOString(), visitors, pageviews: Math.round(visitors * 2.7), sessions: Math.round(visitors * 1.2) });
      }
    }
    return out;
  }
  const stepDays = interval === "day" ? 1 : interval === "week" ? 7 : 0;
  for (let d = new Date(start); d < end; ) {
    const next = stepDays ? new Date(d.getTime() + stepDays * 86400000) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const stop = next < end ? next : end;
    let v = 0;
    for (let x = new Date(d); x < stop; x = new Date(x.getTime() + 86400000)) v += dayVisitors(id, x);
    const r = rng(hashStr(id + d.toISOString() + interval));
    const visitors = Math.round(v * factor * (isToday(d) && interval === "day" ? (nowH + 1) / 24 : 1));
    out.push({ t: d.toISOString(), visitors, pageviews: Math.round(visitors * (2.6 + r() * 0.5)), sessions: Math.round(visitors * 1.2) });
    d = next;
  }
  return out;
}

function rowsFrom(id: string, items: readonly (readonly [string, number])[], total: number, labelFn?: (k: string) => string): BreakdownRow[] {
  const sum = items.reduce((s, [, w]) => s + w, 0);
  const r = rng(hashStr(id + items.map((i) => i[0]).join("|")));
  return items
    .map(([key, w]) => {
      const visitors = Math.max(1, Math.round((total * w) / sum * (0.9 + r() * 0.2)));
      const sessions = Math.round(visitors * 1.18);
      return {
        key, label: labelFn ? labelFn(key) : undefined, visitors, pageviews: Math.round(sessions * (1.8 + r() * 1.5)), sessions,
        bounce_rate: 30 + r() * 35, avg_duration_s: 40 + r() * 160, pct: 0,
      };
    })
    .sort((a, b) => b.visitors - a.visitors)
    .map((row) => ({ ...row, pct: total ? (row.visitors / total) * 100 : 0 }));
}

function cityRows(id: string, total: number, which: "city" | "region"): BreakdownRow[] {
  const items: [string, number][] = [];
  for (const [cc, w] of COUNTRIES) {
    const cities = CITIES[cc];
    if (!cities) continue;
    const csum = cities.reduce((s, c) => s + c[2], 0);
    for (const [city, region, cw] of cities) items.push([which === "city" ? `${city}, ${cc}` : `${region}, ${cc}`, (w * cw) / csum]);
  }
  return rowsFrom(id, items, total);
}

function breakdownRows(id: string, by: Dimension, total: number): BreakdownRow[] {
  switch (by) {
    case "path": return rowsFrom(id, PATHS, total * 1.7);
    case "entry_path": return rowsFrom(id, PATHS, total);
    case "exit_path": return rowsFrom(id, [...PATHS].reverse().slice(0, 9), total);
    case "hostname": return rowsFrom(id, id === "p_bih" ? [["bigindianhub.com", 88], ["www.bigindianhub.com", 9], ["app.bigindianhub.com", 3]] : [["docs.hanu.dev", 100]], total);
    case "referrer": return rowsFrom(id, REFERRERS.filter((x) => x[0] !== "Direct").map(([k, w]) => [k === "google.com" ? "google.com/" : `${k}/`, w] as const), total * 0.62);
    case "referrer_domain": return rowsFrom(id, REFERRERS, total);
    case "source": return rowsFrom(id, SOURCES, total);
    case "medium": return rowsFrom(id, MEDIUMS, total);
    case "campaign": return rowsFrom(id, CAMPAIGNS, total);
    case "term": return rowsFrom(id, [["(none)", 90], ["analytics", 5], ["posthog alternative", 3], ["google analytics replacement", 2]], total);
    case "content": return rowsFrom(id, [["(none)", 85], ["hero-cta", 8], ["footer-link", 4], ["sidebar", 3]], total);
    case "country": return rowsFrom(id, COUNTRIES, total, countryName);
    case "region": return cityRows(id, total, "region");
    case "city": return cityRows(id, total, "city");
    case "browser": return rowsFrom(id, BROWSERS, total);
    case "browser_version": return rowsFrom(id, [["Chrome 141", 40], ["Chrome 140", 18], ["Safari 26", 14], ["Safari 18.6", 6], ["Firefox 144", 7], ["Edge 141", 6], ["Samsung Internet 28", 2]], total);
    case "os": return rowsFrom(id, OSES, total);
    case "os_version": return rowsFrom(id, [["Windows 11", 26], ["Android 15", 18], ["macOS 26", 14], ["iOS 26", 11], ["Windows 10", 8], ["Android 14", 8], ["macOS 15", 6], ["Linux", 4]], total);
    case "device": return rowsFrom(id, DEVICES, total);
    case "screen": return rowsFrom(id, SCREENS, total);
    case "language": return rowsFrom(id, LANGS, total);
    case "event": return rowsFrom(id, EVENTS, total * 2.5);
  }
}

// ---------- sessions & persons ----------
const PERSON_NAMES = ["ananya", "rohan", "meera", "vikram", "sara", "kabir", "nikhil", "isha", "dev", "tara", "zoya", "aarav"];

function makeSession(id: string, i: number, start: Date, end: Date): Session {
  const r = rng(hashStr(`${id}:s:${i}`));
  const cc = pickW(r, COUNTRIES);
  const city = CITIES[cc] ? pickW(r, CITIES[cc]!.map((c) => [c, c[2]] as const)) : (["Unknown", "", 1] as const);
  const device = pickW(r, DEVICES);
  const os = device === "desktop" ? pickW(r, [["Windows", 50], ["macOS", 40], ["Linux", 10]] as const) : device === "tablet" ? "iPadOS" : pickW(r, [["Android", 60], ["iOS", 40]] as const);
  const browser = os === "iOS" || os === "iPadOS" ? "Safari" : os === "macOS" ? pickW(r, [["Safari", 50], ["Chrome", 45], ["Firefox", 5]] as const) : pickW(r, BROWSERS);
  const t0 = new Date(start.getTime() + r() * (end.getTime() - start.getTime()));
  const duration = Math.round(8 + Math.pow(r(), 2) * 900);
  const pageviews = 1 + Math.floor(Math.pow(r(), 1.6) * 8);
  const identified = r() < 0.3;
  const did = identified ? `${pick(r, PERSON_NAMES)}@example.com` : `anon_${hashStr(`${id}${i}`).toString(36).slice(0, 10)}`;
  const hasRec = projects.find((p) => p.id === id)?.recording.enabled !== false && r() < 0.55 && duration > 10;
  const paths = Array.from({ length: pageviews }, () => pickW(r, PATHS));
  return {
    id: `${id}:sess_${hashStr(`${id}${i}`).toString(36)}`, session_id: `sess_${hashStr(`${id}${i}`).toString(36)}`, distinct_id: did,
    start: t0.toISOString(), end: new Date(t0.getTime() + duration * 1000).toISOString(), duration_s: duration,
    pageviews, events: pageviews * 2 + Math.floor(r() * 10), clicks: Math.floor(r() * pageviews * 3), errors: r() < 0.08 ? 1 + Math.floor(r() * 2) : 0,
    entry_path: paths[0]!, exit_path: paths[paths.length - 1]!, country: cc, region: city[1], city: city[0], browser, os, device,
    referrer_domain: pickW(r, REFERRERS), source: pickW(r, SOURCES), has_recording: hasRec,
    rec_chunks: hasRec ? 1 + Math.floor(duration / 5) : 0, rec_bytes: hasRec ? 20000 + Math.floor(duration * 1800) : 0, rec_duration_s: hasRec ? duration : 0,
  };
}

function allSessions(id: string, q: SessionsQuery): Session[] {
  const [start, end] = periodRange(q.period, q.from, q.to);
  const endClamped = end > now() ? now() : end;
  const days = Math.max(1, (endClamped.getTime() - start.getTime()) / 86400000);
  const n = Math.min(400, Math.round(days * 24 * projectScale(id)));
  const list = Array.from({ length: n }, (_, i) => makeSession(id, i + Math.floor(start.getTime() / 86400000), start, endClamped));
  return list
    .filter((s) => (q.has_recording ? s.has_recording : true))
    .filter((s) => (q.distinct_id ? s.distinct_id === q.distinct_id : true))
    .filter((s) => (q.country ? s.country === q.country : true))
    .filter((s) => filterMatches(s, q))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

function filterMatches(s: Session, q: StatsQuery): boolean {
  for (const f of q.filters ?? []) {
    const v = (s as unknown as Record<string, unknown>)[f.key === "path" ? "entry_path" : f.key];
    if (typeof v !== "string") continue;
    const hit = f.op === "contains" ? v.includes(f.value) : v === f.value;
    if (f.op === "is_not" ? hit : !hit) return false;
  }
  return true;
}

function sessionEvents(s: Session): SessionEvent[] {
  const r = rng(hashStr(s.id + "ev"));
  const out: SessionEvent[] = [];
  const t0 = new Date(s.start).getTime();
  let t = t0;
  let path = s.entry_path;
  for (let i = 0; i < s.pageviews; i++) {
    if (i > 0) path = i === s.pageviews - 1 ? s.exit_path : pickW(r, PATHS);
    out.push({ ts: new Date(t).toISOString(), event: "$pageview", path, url: `https://bigindianhub.com${path}`, props: { $title: path === "/" ? "Home" : path.slice(1) } });
    const clicks = Math.floor(r() * 3);
    for (let c = 0; c < clicks; c++) {
      t += 1000 + r() * 8000;
      out.push({ ts: new Date(t).toISOString(), event: "$autocapture", path, url: `https://bigindianhub.com${path}`, props: { $el_tag: pick(r, ["a", "button"]), $el_text: pick(r, ["Get started", "Pricing", "Docs", "Sign up", "Read more"]) } });
    }
    if (r() < 0.12) {
      t += 500;
      out.push({ ts: new Date(t).toISOString(), event: "$exception", path, url: `https://bigindianhub.com${path}`, props: { $message: pick(r, ERRORS)[0] } });
    }
    t += 3000 + r() * ((s.duration_s * 1000) / s.pageviews);
    out.push({ ts: new Date(t).toISOString(), event: "$pageleave", path, url: `https://bigindianhub.com${path}`, props: { $duration_ms: Math.round(t - t0), $scroll_depth: Math.round(r() * 100) } });
  }
  return out;
}

/** A small but real rrweb recording: Meta + FullSnapshot of a tiny page + mouse moves, clicks and scrolls. */
function makeRecording(s: Session): unknown[] {
  const r = rng(hashStr(s.id + "rec"));
  const t0 = new Date(s.start).getTime();
  const W = s.device === "mobile" ? 390 : 1280;
  const H = s.device === "mobile" ? 844 : 800;
  let nid = 1;
  const el = (tagName: string, attributes: Record<string, string>, childNodes: unknown[] = []) => ({ type: 2, tagName, attributes, childNodes, id: nid++ });
  const text = (textContent: string) => ({ type: 3, textContent, id: nid++ });
  const docId = nid++;
  const doctype = { type: 1, name: "html", publicId: "", systemId: "", id: nid++ };
  const css = `body{margin:0;font-family:Inter,system-ui,sans-serif;background:#fbf9f6;color:#1b1917}header{display:flex;gap:24px;align-items:center;padding:16px 32px;border-bottom:1px solid #e9e4dc}header b{color:#e85d04}main{padding:48px 32px;max-width:720px}h1{font-size:40px;margin:0 0 12px}p{font-size:18px;line-height:1.6;color:#52514e}.btn{display:inline-block;margin-top:24px;padding:12px 20px;border-radius:10px;background:#e85d04;color:#fff;font-weight:600}.card{margin-top:40px;padding:24px;border:1px solid #e9e4dc;border-radius:16px;background:#fff}input{padding:10px;border:1px solid #d5cfc5;border-radius:8px;width:60%}`;
  const html = el("html", { lang: "en" }, [
    el("head", {}, [el("meta", { charset: "utf-8" }), el("title", {}, [text("Big Indian Hub")]), el("style", {}, [text(css)])]),
    el("body", {}, [
      el("header", {}, [el("b", {}, [text("Big Indian Hub")]), el("a", { href: "/pricing" }, [text("Pricing")]), el("a", { href: "/docs" }, [text("Docs")]), el("a", { href: "/blog" }, [text("Blog")])]),
      el("main", {}, [
        el("h1", {}, [text("Analytics that runs for free.")]),
        el("p", {}, [text("Pageviews, events, session replay and web vitals on one tiny VM, with your data in your own bucket.")]),
        el("a", { class: "btn", href: "/signup" }, [text("Get started")]),
        el("div", { class: "card" }, [el("h3", {}, [text("Join the newsletter")]), el("input", { type: "email", placeholder: "you@example.com", value: "" })]),
        ...Array.from({ length: 6 }, (_, i) => el("p", {}, [text(`Section ${i + 1}: Keep scrolling — every event you see in the dashboard came from a page like this one.`)])),
      ]),
    ]),
  ]);
  const doc = { type: 0, childNodes: [doctype, html], id: docId };
  const events: unknown[] = [
    { type: 4, data: { href: `https://bigindianhub.com${s.entry_path}`, width: W, height: H }, timestamp: t0 },
    { type: 2, data: { node: doc, initialOffset: { top: 0, left: 0 } }, timestamp: t0 + 5 },
  ];
  const total = Math.min(s.duration_s, 120) * 1000;
  let t = t0 + 300;
  let x = W * 0.3, y = H * 0.4;
  while (t < t0 + total) {
    const positions = [];
    for (let i = 0; i < 6; i++) {
      x = Math.max(8, Math.min(W - 8, x + (r() - 0.5) * 160));
      y = Math.max(8, Math.min(H - 8, y + (r() - 0.5) * 120));
      positions.push({ x: Math.round(x), y: Math.round(y), id: 0, timeOffset: -Math.round((5 - i) * 60) });
    }
    events.push({ type: 3, data: { source: 1, positions }, timestamp: t });
    if (r() < 0.25) events.push({ type: 3, data: { source: 2, type: 2, id: 12, x: Math.round(x), y: Math.round(y) }, timestamp: t + 100 });
    if (r() < 0.3) events.push({ type: 3, data: { source: 3, id: docId, x: 0, y: Math.round(r() * 600) }, timestamp: t + 200 });
    t += 400 + r() * 1500;
  }
  return events;
}

function personsFor(id: string): Person[] {
  const seen = new Map<string, Person>();
  for (const s of allSessions(id, { period: "90d" })) {
    const p = seen.get(s.distinct_id);
    const identified = s.distinct_id.includes("@");
    if (!p) {
      seen.set(s.distinct_id, {
        distinct_id: s.distinct_id, is_identified: identified, first_seen: s.start, last_seen: s.end, sessions: 1,
        props: identified ? { email: s.distinct_id, name: s.distinct_id.split("@")[0]!.replace(/^\w/, (c) => c.toUpperCase()), plan: pick(rng(hashStr(s.distinct_id)), ["free", "pro", "team"]), $initial_referrer: s.referrer_domain } : { $initial_referrer: s.referrer_domain, $browser: s.browser, $os: s.os },
      });
    } else {
      p.sessions += 1;
      if (s.start < p.first_seen) p.first_seen = s.start;
      if (s.end > p.last_seen) p.last_seen = s.end;
    }
  }
  return [...seen.values()].sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
}

// ---------- the Api ----------
const delay = () => sleep(120 + Math.random() * 180);

export const mockApi: Api = {
  async setupStatus() { await delay(); return { needs_setup: !setupDone, signup_open: signupMode === "open", google: true, version: "0.1.0 (mock)" }; },
  async register(body) {
    await delay();
    if (signupMode !== "open") throw new ApiError(403, "sign-up is by invitation on this instance");
    const user: User = { id: `u_${Date.now()}`, email: body.email, name: body.name, created_at: new Date().toISOString() };
    const org: Org = { id: `o_${Date.now()}`, name: body.org_name, created_at: new Date().toISOString(), role: "owner" };
    users[0] = user;
    orgs = [org];
    projects = [];
    return { user, org };
  },
  async updateMe(body) {
    await delay();
    if (body.password && body.current_password !== "password123" && body.current_password !== "secret") throw new ApiError(400, "current password is wrong");
    if (body.name) users[0] = { ...users[0]!, name: body.name };
    return { user: users[0]! };
  },
  async setup(body) {
    await delay();
    if (setupDone) throw new ApiError(409, "already set up");
    setupDone = true;
    const user = { id: "u_1", email: body.email, name: body.name, created_at: new Date().toISOString() };
    users[0] = user;
    orgs = [{ id: "o_1", name: body.org_name, created_at: new Date().toISOString(), role: "owner" }];
    const project = { ...projects[0]!, name: body.project_name, domains: body.domains, org_id: "o_1" };
    projects = [project];
    return { user, org: orgs[0]!, project };
  },
  async login(email, password) {
    await delay();
    if (!password || password.length < 4) throw new ApiError(401, "invalid email or password");
    return { user: { ...users[0]!, email } };
  },
  async logout() { await delay(); },
  async me(): Promise<Me> { await delay(); return { user: users[0]!, orgs, projects, is_instance_admin: true }; },

  async createOrg(name) { await delay(); const o: Org = { id: `o_${orgs.length + 1}`, name, created_at: new Date().toISOString(), role: "owner" }; orgs.push(o); members[o.id] = [{ ...members.o_1![0]! }]; invites[o.id] = []; return o; },
  async renameOrg(org, name) { await delay(); const o = orgs.find((x) => x.id === org); if (!o) throw new ApiError(404, "org not found"); o.name = name; return o; },
  async members(org) { await delay(); return { members: members[org] ?? [], invites: invites[org] ?? [] }; },
  async invite(org, email, role) {
    await delay();
    const inv: Invite = { id: `i_${Date.now()}`, email, role, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), url: `${location.origin}/invite/inv_${hashStr(email).toString(36)}` };
    (invites[org] ??= []).push(inv);
    return { invite: inv };
  },
  async revokeInvite(org, id) { await delay(); invites[org] = (invites[org] ?? []).filter((i) => i.id !== id); },
  async setRole(org, userId, role: Role) { await delay(); const m = (members[org] ?? []).find((x) => x.user_id === userId); if (m) m.role = role; },
  async removeMember(org, userId) { await delay(); members[org] = (members[org] ?? []).filter((m) => m.user_id !== userId); },
  async inviteInfo() { await delay(); return { org_name: "Big Indian Hub", email: "sam@example.com", invited_by: "Madhu" }; },
  async acceptInvite(_token, name) { await delay(); return { user: { id: "u_9", email: "sam@example.com", name, created_at: new Date().toISOString() } }; },

  async createProject(org, body) {
    await delay();
    const p: Project = { id: `p_${hashStr(body.name).toString(36).slice(0, 6)}`, org_id: org, name: body.name, public_key: `ha_pk_${hashStr(body.name + "k").toString(36).padEnd(32, "x").slice(0, 32)}`, domains: body.domains, allow_no_origin: false, apps: [], timezone: body.timezone ?? "UTC", recording: defaultRecording(), autocapture: defaultAutocapture(), cookieless: false, retention_days: 365, recording_retention_days: 30, created_at: new Date().toISOString() };
    projects.push(p);
    return p;
  },
  async project(id) { await delay(); const p = projects.find((x) => x.id === id); if (!p) throw new ApiError(404, "project not found"); return p; },
  async updateProject(id, patch: ProjectPatch) { await delay(); const p = projects.find((x) => x.id === id); if (!p) throw new ApiError(404, "project not found"); Object.assign(p, patch); return { ...p }; },
  async rotateKey(id) { await delay(); const p = projects.find((x) => x.id === id); if (!p) throw new ApiError(404, "project not found"); p.public_key = `ha_pk_${hashStr(p.public_key).toString(36).padEnd(32, "z").slice(0, 32)}`; return { ...p }; },
  async deleteProject(id) { await delay(); projects = projects.filter((p) => p.id !== id); },

  async system(): Promise<SystemInfo> {
    await delay();
    return {
      version: "0.1.0 (mock)", uptime_s: 86400 * 3 + 4321, hanudb: { ok: true, url: "http://127.0.0.1:8080", status: { txn: 184233, segments: 2410, index_lag: 0, rss_mb: 142 } },
      store: { kind: "gs://example-hanuanalytics", ok: true }, buffer: { pending_events: 37, last_flush_at: new Date(Date.now() - 23000).toISOString() },
      geo: { loaded: true, build: "2026-10" }, files: { events: 1284, recordings: 3920 }, live: { events_30m: 412 },
      signup_mode: signupMode, public_url: location.origin, requests_new: requests.filter((r) => r.status === "new").length,
    };
  },
  async compact() { await sleep(900); return { merged_files: 48, ms: 870 }; },
  async setSignupMode(mode) { await delay(); signupMode = mode; },
  async accounts(): Promise<Accounts> {
    await delay();
    const h = (n: number) => new Date(Date.now() - n * 3600000).toISOString();
    const rows: Accounts["rows"] = [
      { id: "u_8", email: "kavya@shopkart.in", name: "Kavya Nair", created_at: h(1), sign_in: "google", is_instance_admin: false, orgs: [{ org_id: "o_9", org_name: "ShopKart", role: "owner", projects: 1 }] },
      { id: "u_7", email: "tom@becker.dev", name: "Tom Becker", created_at: h(7), sign_in: "password", is_instance_admin: false, orgs: [{ org_id: "o_8", org_name: "becker.dev", role: "owner", projects: 1 }] },
      { id: "u_6", email: "ananya@fintrail.app", name: "Ananya Rao", created_at: h(26), sign_in: "google", is_instance_admin: false, orgs: [{ org_id: "o_7", org_name: "Fintrail", role: "owner", projects: 2 }] },
      { id: "u_5", email: "dev@fintrail.app", name: "Dev Shah", created_at: h(25), sign_in: "password", is_instance_admin: false, orgs: [{ org_id: "o_7", org_name: "Fintrail", role: "member", projects: 2 }] },
      { id: "u_4", email: "sam@example.com", name: "Sam Lee", created_at: h(70), sign_in: "google", is_instance_admin: false, orgs: [{ org_id: "o_1", org_name: "Big Indian Hub", role: "member", projects: 2 }] },
      { id: "u_3", email: "arjun@example.com", name: "Arjun", created_at: h(17 * 24), sign_in: "password", is_instance_admin: false, orgs: [{ org_id: "o_1", org_name: "Big Indian Hub", role: "member", projects: 2 }] },
      { id: "u_2", email: "priya@example.com", name: "Priya", created_at: h(37 * 24), sign_in: "google", is_instance_admin: false, orgs: [{ org_id: "o_1", org_name: "Big Indian Hub", role: "admin", projects: 2 }, { org_id: "o_7", org_name: "Fintrail", role: "admin", projects: 2 }] },
      { id: "u_1", email: users[0]!.email, name: users[0]!.name, created_at: users[0]!.created_at, sign_in: "password", is_instance_admin: true, orgs: [{ org_id: "o_1", org_name: "Big Indian Hub", role: "owner", projects: 2 }] },
    ];
    return { totals: { users: rows.length, orgs: 4, projects: 6 }, rows };
  },
  async requests(status) { await delay(); return { rows: requests.filter((r) => status === "all" || r.status === status) }; },
  async approveRequest(id, orgName) {
    await delay();
    const r = requests.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "request not found");
    const org: Org = { id: `o_${Date.now()}`, name: orgName?.trim() || r.name, created_at: new Date().toISOString(), role: "owner" };
    r.status = "approved";
    r.org_id = org.id;
    r.invite_url = `${location.origin}/invite/inv_${hashStr(r.email).toString(36)}`;
    r.decided_at = new Date().toISOString();
    return { request: { ...r } };
  },
  async rejectRequest(id) {
    await delay();
    const r = requests.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "request not found");
    r.status = "rejected";
    r.decided_at = new Date().toISOString();
    return { request: { ...r } };
  },

  async overview(id, q, interval: Interval = "auto"): Promise<Overview> {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const iv = interval === "auto" ? autoInterval(q.period, q.from, q.to) : interval;
    const f = filterFactor(q);
    const totals = totalsFor(id, start, end, f);
    const len = end.getTime() - start.getTime();
    const prev = q.compare ? totalsFor(id, new Date(start.getTime() - len), start, f) : undefined;
    return { interval: iv, totals, prev, series: seriesFor(id, start, end, iv, f) };
  },
  async breakdown(id, q, by, limit = 10, offset = 0): Promise<Breakdown> {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const totals = totalsFor(id, start, end, filterFactor(q));
    const rows = breakdownRows(id, by, totals.visitors);
    return { by, rows: rows.slice(offset, offset + limit), total_visitors: totals.visitors };
  },
  async events(id, q, limit = 50) {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const totals = totalsFor(id, start, end, filterFactor(q));
    const rows: EventRow[] = rowsFrom(id, EVENTS, totals.visitors * 2.5).map((r) => ({ event: r.key, count: r.pageviews, visitors: Math.min(r.visitors, totals.visitors), sessions: r.sessions }));
    return { rows: rows.slice(0, limit) };
  },
  async eventKeys(_id, _q, event) {
    await delay();
    const common = ["$current_url", "$title", "$referrer", "$browser", "$os", "$device"];
    const per: Record<string, string[]> = { signup: ["plan", "method", "referral"], purchase: ["plan", "amount", "currency"], pricing_viewed: ["plan", "billing"], $autocapture: ["$el_tag", "$el_text", "$el_href"], $exception: ["$message", "$source"], demo_requested: ["company_size", "role"] };
    return { keys: [...(per[event] ?? []), ...common] };
  },
  async eventProps(id, q, event, key, limit = 20) {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const totals = totalsFor(id, start, end, filterFactor(q));
    const table: Record<string, readonly (readonly [string, number])[]> = {
      plan: [["free", 60], ["pro", 30], ["team", 10]], method: [["email", 55], ["google", 35], ["github", 10]], billing: [["monthly", 65], ["yearly", 35]],
      amount: [["29", 50], ["99", 30], ["290", 15], ["990", 5]], currency: [["USD", 70], ["INR", 25], ["EUR", 5]], $el_tag: [["a", 60], ["button", 35], ["input", 5]],
      $el_text: [["Get started", 30], ["Pricing", 20], ["Sign up", 18], ["Docs", 12], ["Read more", 10], ["Login", 10]], company_size: [["1-10", 40], ["11-50", 30], ["51-200", 20], ["200+", 10]],
      $message: ERRORS.map(([m], i) => [m, 10 - i] as const), $device: DEVICES, $browser: BROWSERS, $os: OSES, $current_url: PATHS.map(([p, w]) => [`https://bigindianhub.com${p}`, w] as const), $title: PATHS.map(([p, w]) => [p === "/" ? "Home" : p.slice(1), w] as const), $referrer: REFERRERS,
    };
    const rows = rowsFrom(id + event, table[key] ?? [["(none)", 1]], totals.visitors * 0.4).map((r): PropRowLike => ({ key: r.key, count: r.pageviews, visitors: r.visitors }));
    return { rows: rows.slice(0, limit) };
  },
  async funnel(id, q, steps, windowDays) {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const totals = totalsFor(id, start, end, filterFactor(q));
    const r = rng(hashStr(id + steps.join(">") + windowDays));
    let count = steps[0] === "$pageview" ? totals.visitors : Math.round(totals.visitors * (0.05 + r() * 0.3));
    const first = count;
    const out: FunnelStep[] = [];
    let prev = count;
    steps.forEach((event, i) => {
      if (i > 0) count = Math.round(count * (0.2 + r() * 0.5));
      out.push({ event, count, pct: first ? (count / first) * 100 : 0, drop_pct: i === 0 ? 0 : prev ? ((prev - count) / prev) * 100 : 0 });
      prev = count;
    });
    return { steps: out };
  },
  async retention(id) {
    await delay();
    const cohorts: Cohort[] = [];
    const n = now();
    const monday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const start = new Date(monday.getTime() - i * 7 * 86400000);
      const r = rng(hashStr(id + start.toISOString()));
      const size = Math.round(dayVisitors(id, start) * 5.2);
      const weeks = [100];
      let v = 100;
      for (let w = 1; w <= i; w++) {
        v = v * (w === 1 ? 0.35 + r() * 0.15 : 0.72 + r() * 0.2);
        weeks.push(Math.round(v * 10) / 10);
      }
      const week = Math.ceil(((start.getTime() - new Date(start.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7);
      cohorts.push({ cohort: `${start.getFullYear()}-W${String(week).padStart(2, "0")}`, start: isoDate(start), size, weeks });
    }
    return { cohorts };
  },
  async errors(id, q, limit = 50) {
    await delay();
    const [start, end] = periodRange(q.period, q.from, q.to);
    const totals = totalsFor(id, start, end, filterFactor(q));
    const r = rng(hashStr(id + "errors"));
    const rows: ErrorRow[] = ERRORS.map(([message, sample], i) => {
      const count = Math.max(1, Math.round((totals.visitors * 0.012) / (i + 1) * (0.7 + r() * 0.6)));
      return { message, count, visitors: Math.max(1, Math.round(count * 0.7)), last_seen: new Date(Date.now() - r() * 3 * 3600000 * (i + 1)).toISOString(), sample_url: `https://bigindianhub.com${sample}` };
    });
    return { rows: rows.slice(0, limit) };
  },
  async vitals(id): Promise<Vitals> {
    await delay();
    const r = rng(hashStr(id + "vitals"));
    const mk = (p75: number, good: number, ni: number): Vitals["lcp"] => ({ p75, good, needs_improvement: ni, poor: Math.max(0, 100 - good - ni), n: Math.round(800 + r() * 2000) });
    return { lcp: mk(2150, 74, 18), cls: mk(0.06, 88, 8), inp: mk(180, 81, 13), fcp: mk(1420, 83, 12), ttfb: mk(610, 70, 22) };
  },
  async live(id): Promise<Live> {
    await sleep(80);
    const n = now();
    const r = rng(hashStr(id + Math.floor(n.getTime() / 5000)));
    const base = dayVisitors(id, n) / 24 / 12;
    const series = Array.from({ length: 30 }, (_, i) => {
      const t = new Date(n.getTime() - (29 - i) * 60000);
      t.setSeconds(0, 0);
      const rr = rng(hashStr(id + t.toISOString()));
      return { t: t.toISOString(), visitors: Math.round(base * hourShape(t.getHours()) * (0.6 + rr() * 0.8)) };
    });
    const online = Math.max(1, Math.round(series.slice(-5).reduce((s, p) => s + p.visitors, 0) * 0.9));
    const pages = rowsFrom(id, PATHS, online).slice(0, 8).map((p) => ({ path: p.key, visitors: p.visitors }));
    let tcur = n.getTime();
    const events: LiveEvent[] = Array.from({ length: 50 }, (_, i) => {
      tcur -= 2000 + r() * 25000;
      const cc = pickW(r, COUNTRIES);
      const city = CITIES[cc] ? pickW(r, CITIES[cc]!.map((c) => [c[0], c[2]] as const)) : "";
      return { ts: new Date(tcur).toISOString(), event: pickW(r, EVENTS), path: pickW(r, PATHS), country: cc, city, browser: pickW(r, BROWSERS), device: pickW(r, DEVICES), distinct_id: r() < 0.3 ? `${pick(r, PERSON_NAMES)}@example.com` : `anon_${hashStr(String(i + n.getMinutes())).toString(36).slice(0, 8)}`, session_id: `sess_${hashStr(String(i)).toString(36)}` };
    });
    return { online, series, pages, events };
  },
  async sessions(id, q) {
    await delay();
    const all = allSessions(id, q);
    const offset = q.offset ?? 0;
    return { rows: all.slice(offset, offset + (q.limit ?? 50)), total: all.length };
  },
  async session(id, sid): Promise<SessionDetail> {
    await delay();
    const all = allSessions(id, { period: "90d" });
    const s = sid === "demo" ? all.find((x) => x.has_recording) : all.find((x) => x.session_id === sid || x.id === sid);
    if (!s) throw new ApiError(404, "session not found");
    return { session: s, events: sessionEvents(s) };
  },
  async recording(id, sid) {
    await sleep(300);
    const all = allSessions(id, { period: "90d" });
    const s = sid === "demo" ? all.find((x) => x.has_recording) : all.find((x) => x.session_id === sid || x.id === sid);
    if (!s || !s.has_recording) throw new ApiError(404, "no recording");
    return makeRecording(s);
  },
  async persons(id, q, limit = 50, offset = 0) {
    await delay();
    const all = personsFor(id).filter((p) => !q || p.distinct_id.toLowerCase().includes(q.toLowerCase()) || JSON.stringify(p.props).toLowerCase().includes(q.toLowerCase()));
    return { rows: all.slice(offset, offset + limit), total: all.length };
  },
  async person(id, did) {
    await delay();
    const person = personsFor(id).find((p) => p.distinct_id === did);
    if (!person) throw new ApiError(404, "person not found");
    return { person, sessions: allSessions(id, { period: "90d", distinct_id: did }) };
  },
  async sql(id, sql, limit = 100): Promise<SqlResult> {
    await sleep(400);
    if (/drop|delete|insert|update/i.test(sql)) throw new ApiError(400, "read-only: only SELECT is allowed");
    const sessions = allSessions(id, { period: "30d" }).slice(0, limit);
    if (/count\(\*\)/i.test(sql) && /group by/i.test(sql)) {
      const rows = rowsFrom(id, PATHS, 5000).map((r) => [r.key, r.pageviews, r.visitors]);
      return { columns: [{ name: "path", type: "Utf8" }, { name: "count", type: "Int64" }, { name: "visitors", type: "Int64" }], rows: rows.slice(0, limit), took_ms: 41, truncated: false };
    }
    const columns = ["ts", "event", "distinct_id", "session_id", "path", "country", "city", "browser", "device", "props"].map((name) => ({ name, type: name === "ts" ? "Timestamp(ms)" : "Utf8" }));
    const rows = sessions.map((s) => [s.start, "$pageview", s.distinct_id, s.session_id, s.entry_path, s.country, s.city, s.browser, s.device, JSON.stringify({ plan: pick(rng(hashStr(s.id)), ["free", "pro", "team"]) })]);
    return { columns, rows, took_ms: 128, truncated: rows.length >= limit };
  },
};

type PropRowLike = { key: string; count: number; visitors: number };
