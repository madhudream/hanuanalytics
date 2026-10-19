import type { Api, Dimension, Interval, SessionsQuery, StatsQuery } from "./types";
import { ApiError } from "./types";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function statsParams(q: StatsQuery, extra: Record<string, string | number | boolean | undefined> = {}): string {
  const p = new URLSearchParams();
  p.set("period", q.period);
  if (q.period === "custom") {
    if (q.from) p.set("from", q.from);
    if (q.to) p.set("to", q.to);
  }
  if (q.tz) p.set("tz", q.tz);
  if (q.filters && q.filters.length) p.set("filters", JSON.stringify(q.filters));
  if (q.compare) p.set("compare", "1");
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === "" || v === false) continue;
    p.set(k, String(v === true ? 1 : v));
  }
  return p.toString();
}

const get = <T>(path: string) => call<T>("GET", path);

export const realApi: Api = {
  setupStatus: () => get("/setup"),
  setup: (body) => call("POST", "/setup", body),
  register: (body) => call("POST", "/register", body),
  updateMe: (body) => call("PATCH", "/me", body),
  login: (email, password) => call("POST", "/login", { email, password }),
  logout: () => call("POST", "/logout").then(() => undefined),
  me: () => get("/me"),

  createOrg: (name) => call("POST", "/orgs", { name }),
  renameOrg: (org, name) => call("PATCH", `/orgs/${org}`, { name }),
  members: (org) => get(`/orgs/${org}/members`),
  invite: (org, email, role) => call("POST", `/orgs/${org}/invites`, { email, role }),
  revokeInvite: (org, id) => call("DELETE", `/orgs/${org}/invites/${id}`).then(() => undefined),
  setRole: (org, userId, role) => call("PATCH", `/orgs/${org}/members/${userId}`, { role }).then(() => undefined),
  removeMember: (org, userId) => call("DELETE", `/orgs/${org}/members/${userId}`).then(() => undefined),
  inviteInfo: (token) => get(`/invites/${token}`),
  acceptInvite: (token, name, password) => call("POST", `/invites/${token}/accept`, { name, password }),

  createProject: (org, body) => call("POST", `/orgs/${org}/projects`, body),
  project: (id) => get(`/projects/${id}`),
  updateProject: (id, patch) => call("PATCH", `/projects/${id}`, patch),
  rotateKey: (id) => call("POST", `/projects/${id}/rotate-key`),
  deleteProject: (id) => call("DELETE", `/projects/${id}`).then(() => undefined),

  system: () => get("/system"),
  compact: () => call("POST", "/system/compact"),
  setSignupMode: (signup_mode) => call("PATCH", "/system", { signup_mode }).then(() => undefined),

  overview: (id, q, interval: Interval = "auto") => get(`/projects/${id}/stats/overview?${statsParams(q, { interval })}`),
  breakdown: (id, q, by: Dimension, limit = 10, offset = 0) => get(`/projects/${id}/stats/breakdown?${statsParams(q, { by, limit, offset })}`),
  events: (id, q, limit = 50) => get(`/projects/${id}/stats/events?${statsParams(q, { limit })}`),
  eventKeys: (id, q, event) => get(`/projects/${id}/stats/events/${encodeURIComponent(event)}/keys?${statsParams(q)}`),
  eventProps: (id, q, event, key, limit = 20) => get(`/projects/${id}/stats/events/${encodeURIComponent(event)}/props?${statsParams(q, { key, limit })}`),
  funnel: (id, q, steps, windowDays) => get(`/projects/${id}/stats/funnel?${statsParams(q, { steps: steps.join(","), window_days: windowDays })}`),
  retention: (id, q) => get(`/projects/${id}/stats/retention?${statsParams(q)}`),
  errors: (id, q, limit = 50) => get(`/projects/${id}/stats/errors?${statsParams(q, { limit })}`),
  vitals: (id, q) => get(`/projects/${id}/stats/vitals?${statsParams(q)}`),
  live: (id) => get(`/projects/${id}/live`),
  sessions: (id, q: SessionsQuery) =>
    get(`/projects/${id}/sessions?${statsParams(q, { has_recording: q.has_recording, distinct_id: q.distinct_id, country: q.country, limit: q.limit ?? 50, offset: q.offset ?? 0 })}`),
  session: (id, sid) => get(`/projects/${id}/sessions/${encodeURIComponent(sid)}`),
  recording: (id, sid) => get(`/projects/${id}/sessions/${encodeURIComponent(sid)}/recording`),
  persons: (id, q, limit = 50, offset = 0) => get(`/projects/${id}/persons?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`),
  person: (id, did) => get(`/projects/${id}/persons/${encodeURIComponent(did)}`),
  sql: (id, sql, limit) => call("POST", `/projects/${id}/sql`, { sql, limit }),
};
