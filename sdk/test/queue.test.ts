import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventQueue, makeTransport } from "../src/queue";
import type { HanuEvent } from "../src/types";
import { captureNetwork, clearStorage, flushMicrotasks, patchBlob } from "./helpers";

const ev = (n: number): HanuEvent => ({ event: "e" + n, ts: n, distinct_id: "d", session_id: "s", props: {} });

describe("queue", () => {
  beforeEach(() => {
    clearStorage();
    patchBlob();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("batches: flushes at 20 events immediately and the rest after 3 s", async () => {
    vi.useFakeTimers();
    const sent = captureNetwork({ beacon: false });
    const q = new EventQueue({ apiHost: "https://a.test", token: "ha_pk_x" });
    for (let i = 0; i < 23; i++) q.push(ev(i));
    await flushMicrotasksFake();
    expect(sent.length).toBe(1);
    expect(sent[0]!.body.events.length).toBe(20);
    expect(sent[0]!.body.token).toBe("ha_pk_x");
    expect(sent[0]!.url).toBe("https://a.test/api/v1/e");
    expect(typeof sent[0]!.body.sent_at).toBe("number");
    vi.advanceTimersByTime(3000);
    await flushMicrotasksFake();
    expect(sent.length).toBe(2);
    expect(sent[1]!.body.events.map((e) => e.event)).toEqual(["e20", "e21", "e22"]);
  });

  it("sends with text/plain, no credentials", async () => {
    captureNetwork({ beacon: false });
    const q = new EventQueue({ apiHost: "https://a.test", token: "t" });
    q.push(ev(1));
    await q.flush(false);
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.credentials).toBe("omit");
    expect(init.method).toBe("POST");
  });

  it("uses sendBeacon for a beacon flush and falls back to fetch keepalive without it", async () => {
    const sent = captureNetwork({ beacon: true });
    const q = new EventQueue({ apiHost: "https://a.test", token: "t" });
    q.push(ev(1));
    await q.flush(true);
    expect(sent[0]!.beacon).toBe(true);
    expect(sent[0]!.body.events[0]!.event).toBe("e1");

    const sent2 = captureNetwork({ beacon: false });
    const q2 = new EventQueue({ apiHost: "https://a.test", token: "t" });
    q2.push(ev(2));
    await q2.flush(true);
    expect(sent2[0]!.beacon).toBe(false);
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.at(-1)![1];
    expect(init.keepalive).toBe(true);
  });

  it("retries once on a server error and gives up after", async () => {
    const sent = captureNetwork({ beacon: false, failTimes: 1 });
    const t = makeTransport();
    expect(await t.send("https://a.test/api/v1/e", "{}", false)).toBe(true);
    expect(sent.length).toBe(1);
    const sent2 = captureNetwork({ beacon: false, failTimes: 5 });
    expect(await t.send("https://a.test/api/v1/e", "{}", false)).toBe(false);
    expect(sent2.length).toBe(0);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });
});

async function flushMicrotasksFake(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
void flushMicrotasks;
