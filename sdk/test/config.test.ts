import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, K_CFG, loadConfig } from "../src/config";
import { clearStorage } from "./helpers";

describe("config", () => {
  beforeEach(() => clearStorage());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches once and serves from the sessionStorage cache for ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, project_id: "p_9", recording: { enabled: true, sample_rate: 0.5 } }), { status: 200 }));
    const a = await loadConfig("https://a.test", "ha_pk_1", f as unknown as typeof fetch);
    expect(a.project_id).toBe("p_9");
    expect(a.recording.enabled).toBe(true);
    expect(a.recording.sample_rate).toBe(0.5);
    expect(a.recording.mask_all_inputs).toBe(true); // default filled in
    expect(a.autocapture.clicks).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toBe("https://a.test/api/v1/config?token=ha_pk_1");
    expect(sessionStorage.getItem(K_CFG)).toContain("p_9");

    const b = await loadConfig("https://a.test", "ha_pk_1", f as unknown as typeof fetch);
    expect(b.project_id).toBe("p_9");
    expect(f).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-19T10:11:00Z"));
    await loadConfig("https://a.test", "ha_pk_1", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a different token does not reuse the cache", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, project_id: "p_1" }), { status: 200 }));
    await loadConfig("https://a.test", "t1", f as unknown as typeof fetch);
    await loadConfig("https://a.test", "t2", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to defaults on a failed request", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 401 }));
    expect(await loadConfig("https://a.test", "t", f as unknown as typeof fetch)).toEqual(DEFAULT_CONFIG);
    const g = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await loadConfig("https://a.test", "t", g as unknown as typeof fetch)).toEqual(DEFAULT_CONFIG);
  });
});
