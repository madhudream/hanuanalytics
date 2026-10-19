import type { RemoteConfig } from "./types";
import { log, now, ss } from "./utils";

export const K_CFG = "hanu_cfg";
const TTL = 10 * 60 * 1000;

export const DEFAULT_CONFIG: RemoteConfig = {
  ok: true,
  project_id: "",
  recording: { enabled: false, sample_rate: 1, mask_all_inputs: true, mask_text_selector: "", block_selector: "", min_duration_ms: 0 },
  autocapture: { pageviews: true, clicks: true, forms: true, errors: true, vitals: true, scroll: true },
  session_timeout_ms: 30 * 60 * 1000,
  cookieless: false,
  respect_dnt: false,
  server_time: 0,
};

function cached(token: string): RemoteConfig | null {
  try {
    const raw = ss.get(K_CFG);
    if (!raw) return null;
    const v = JSON.parse(raw) as { t: number; k: string; c: RemoteConfig };
    if (v.k !== token || now() - v.t > TTL) return null;
    return v.c;
  } catch {
    return null;
  }
}

/** Load the project's config from the server, cached for ten minutes per tab. Never rejects. */
export async function loadConfig(apiHost: string, token: string, fetchImpl: typeof fetch = fetch): Promise<RemoteConfig> {
  const c = cached(token);
  if (c) return c;
  try {
    const res = await fetchImpl(`${apiHost}/api/v1/config?token=${encodeURIComponent(token)}`, { method: "GET", credentials: "omit" });
    if (!res.ok) {
      log("config failed", res.status);
      return DEFAULT_CONFIG;
    }
    const json = (await res.json()) as Partial<RemoteConfig>;
    const cfg: RemoteConfig = {
      ...DEFAULT_CONFIG,
      ...json,
      recording: { ...DEFAULT_CONFIG.recording, ...(json.recording || {}) },
      autocapture: { ...DEFAULT_CONFIG.autocapture, ...(json.autocapture || {}) },
    };
    ss.set(K_CFG, JSON.stringify({ t: now(), k: token, c: cfg }));
    return cfg;
  } catch (e) {
    log("config error", e);
    return DEFAULT_CONFIG;
  }
}
