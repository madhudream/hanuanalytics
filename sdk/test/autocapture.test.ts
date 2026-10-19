import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startClicks, startForms, startPageviews } from "../src/autocapture";
import { Client } from "../src/client";
import { configureIds, resetSessionListeners } from "../src/ids";
import { EventQueue } from "../src/queue";
import type { HanuEvent } from "../src/types";
import { clearStorage } from "./helpers";

function makeClient(): { c: Client; events: HanuEvent[] } {
  const events: HanuEvent[] = [];
  const transport = { send: async () => true };
  const q = new EventQueue({ apiHost: "https://a.test", token: "t" }, transport);
  const c = new Client("https://a.test", "t", q);
  c.on((e) => events.push(e));
  return { c, events };
}

describe("autocapture", () => {
  let teardown: Array<() => void> = [];
  beforeEach(() => {
    clearStorage();
    resetSessionListeners();
    configureIds({ cookieless: false, sessionTimeoutMs: 1800000 });
    document.body.innerHTML = "";
    history.replaceState(null, "", "/home");
  });
  afterEach(() => {
    for (const t of teardown) t();
    teardown = [];
    vi.useRealTimers();
  });

  it("click on a button captures $autocapture with element props", () => {
    const { c, events } = makeClient();
    teardown.push(startClicks(c));
    document.body.innerHTML = `<main><button id="buy" class="btn primary" name="buy-btn">Buy  now <span>today</span></button></main>`;
    document.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    const e = events.find((x) => x.event === "$autocapture")!;
    expect(e).toBeTruthy();
    expect(e.props.$el_tag).toBe("button");
    expect(e.props.$el_text).toBe("Buy now today");
    expect(e.props.$el_id).toBe("buy");
    expect(e.props.$el_classes).toBe("btn primary");
    expect(e.props.$el_name).toBe("buy-btn");
    expect(e.props.$el_selector).toBe("#buy");
    expect(e.props.$current_url).toBe("https://example.com/home");
    expect(e.session_id).toMatch(/^s_/);
    expect(e.anon_id).toMatch(/^a_/);
  });

  it("masks emails in captured text and ignores data-hanu-no-capture", () => {
    const { c, events } = makeClient();
    teardown.push(startClicks(c));
    document.body.innerHTML = `<a href="/x" id="mail">Contact bob@example.com</a><button data-hanu-no-capture id="secret">S</button>`;
    document.getElementById("mail")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("secret")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const caps = events.filter((x) => x.event === "$autocapture");
    expect(caps.length).toBe(1);
    expect(caps[0]!.props.$el_text).toBe("Contact ***");
    expect(caps[0]!.props.$el_href).toBe("https://example.com/x");
  });

  it("outbound and download links get their own events", () => {
    const { c, events } = makeClient();
    teardown.push(startClicks(c));
    document.body.innerHTML = `<a id="out" href="https://other.org/p">Other</a><a id="dl" href="/files/report.pdf">PDF</a>`;
    document.getElementById("out")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("dl")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const names = events.map((e) => e.event);
    expect(names).toContain("$outbound");
    expect(names).toContain("$download");
    expect(events.find((e) => e.event === "$outbound")!.props.$href).toBe("https://other.org/p");
    expect(events.find((e) => e.event === "$download")!.props.$href).toBe("https://example.com/files/report.pdf");
  });

  it("three fast clicks in one spot produce a $rageclick", () => {
    const { c, events } = makeClient();
    teardown.push(startClicks(c));
    document.body.innerHTML = `<div id="dead">nothing</div>`;
    const el = document.getElementById("dead")!;
    for (let i = 0; i < 3; i++) el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(events.filter((e) => e.event === "$rageclick").length).toBe(1);
  });

  it("form submit captures $form_submit", () => {
    const { c, events } = makeClient();
    teardown.push(startForms(c));
    document.body.innerHTML = `<form id="signup" name="signup" action="/go" method="post"><input name="email"><button>Go</button></form>`;
    const f = document.getElementById("signup") as HTMLFormElement;
    f.addEventListener("submit", (e) => e.preventDefault());
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const e = events.find((x) => x.event === "$form_submit")!;
    expect(e.props.$form_id).toBe("signup");
    expect(e.props.$form_name).toBe("signup");
    expect(e.props.$form_action).toBe("/go");
    expect(e.props.$form_method).toBe("post");
  });

  it("SPA navigation sends $pageleave for the old url then $pageview for the new", async () => {
    vi.useFakeTimers();
    const { c, events } = makeClient();
    teardown.push(startPageviews(c, true));
    expect(events[0]!.event).toBe("$pageview");
    expect(events[0]!.props.$current_url).toBe("https://example.com/home");
    expect(events[0]!.props.$session_start).toBe(true);
    vi.advanceTimersByTime(1500);
    history.pushState({}, "", "/pricing");
    vi.advanceTimersByTime(10);
    const names = events.map((e) => e.event);
    expect(names).toEqual(["$pageview", "$pageleave", "$pageview"]);
    expect(events[1]!.props.$current_url).toBe("https://example.com/home");
    expect(events[1]!.props.$duration_ms).toBeGreaterThanOrEqual(1500);
    expect(typeof events[1]!.props.$scroll_depth).toBe("number");
    expect(events[2]!.props.$current_url).toBe("https://example.com/pricing");
    expect(events[2]!.props.$prev_url).toBe("https://example.com/home");
    expect(events[2]!.props.$referrer).toBe("https://example.com/home");
    expect(events[2]!.props.$session_start).toBeUndefined();
    // a replaceState to the same url does nothing
    history.replaceState({}, "", "/pricing");
    vi.advanceTimersByTime(10);
    expect(events.length).toBe(3);
    // popstate back
    history.pushState({}, "", "/home");
    vi.advanceTimersByTime(10);
    expect(events.length).toBe(5);
  });

  it("hiding the page sends a beaconed $pageleave", () => {
    const { c, events } = makeClient();
    teardown.push(startPageviews(c, false));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(events.map((e) => e.event)).toEqual(["$pageview", "$pageleave"]);
  });
});
