import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import hanu from "../src/index";
import type { HanuEvent } from "../src/types";
import { captureNetwork, clearStorage, patchBlob } from "./helpers";

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("public api", () => {
  beforeEach(() => {
    clearStorage();
    patchBlob();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    hanu._destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("init loads config, sends the first pageview, and never throws", async () => {
    const sent = captureNetwork({ beacon: false });
    const seen: HanuEvent[] = [];
    hanu.on("event", (e) => seen.push(e));
    hanu.init("ha_pk_abc", { apiHost: "https://a.test/" });
    await settle();
    expect(seen[0]!.event).toBe("$pageview");
    hanu.capture("signup", { plan: "pro" });
    hanu.identify("u_7", { email: "x@y.z" });
    await hanu.flush();
    const all = sent.flatMap((s) => s.body.events);
    const signup = all.find((e) => e.event === "signup")!;
    expect(signup.props.plan).toBe("pro");
    expect(signup.props.$current_url).toBe("https://example.com/home");
    expect(signup.props.$language).toBeTruthy();
    const ident = all.find((e) => e.event === "$identify")!;
    expect(ident.distinct_id).toBe("u_7");
    expect(ident.set).toEqual({ email: "x@y.z" });
    expect(ident.props.$anon_distinct_id).toMatch(/^a_/);
    expect(hanu.getDistinctId()).toBe("u_7");
    expect(hanu.getSessionId()).toMatch(/^s_/);
    // bad input never throws
    expect(() => hanu.capture("" as string)).not.toThrow();
    expect(() => hanu.identify(undefined as unknown as string)).not.toThrow();
  });

  it("opt out stops everything and is remembered", async () => {
    const sent = captureNetwork({ beacon: false });
    hanu.init("t", { apiHost: "https://a.test" });
    await settle();
    hanu.optOut();
    hanu.capture("x");
    await hanu.flush();
    expect(sent.flatMap((s) => s.body.events).some((e) => e.event === "x")).toBe(false);
    expect(hanu.hasOptedOut()).toBe(true);
    expect(localStorage.getItem("hanu_optout")).toBe("1");
    hanu.optIn();
    hanu.capture("y");
    await hanu.flush();
    expect(sent.flatMap((s) => s.body.events).some((e) => e.event === "y")).toBe(true);
  });

  it("does nothing for bots", async () => {
    const sent = captureNetwork({ beacon: false });
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    hanu.init("t", { apiHost: "https://a.test" });
    await settle();
    hanu.capture("x");
    await hanu.flush();
    expect(sent.length).toBe(0);
    expect(hanu.isEnabled()).toBe(false);
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  });

  it("beforeSend can drop events", async () => {
    const sent = captureNetwork({ beacon: false });
    hanu.init("t", { apiHost: "https://a.test", beforeSend: (e) => e.event !== "secret" });
    await settle();
    hanu.capture("secret");
    hanu.capture("public");
    await hanu.flush();
    const names = sent.flatMap((s) => s.body.events).map((e) => e.event);
    expect(names).toContain("public");
    expect(names).not.toContain("secret");
  });
});
