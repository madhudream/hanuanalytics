import { vi } from "vitest";
import type { HanuEvent } from "../src/types";

export interface Sent {
  url: string;
  body: { token: string; events: HanuEvent[] } & Record<string, unknown>;
  beacon: boolean;
}

/** Replace fetch and sendBeacon with recorders; returns the captured batches. */
export function captureNetwork(opts: { beacon?: boolean; status?: number; configJson?: unknown; failTimes?: number } = {}): Sent[] {
  const sent: Sent[] = [];
  let fails = opts.failTimes ?? 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/v1/config")) {
      return new Response(JSON.stringify(opts.configJson ?? { ok: true, project_id: "p_1", recording: { enabled: false } }), { status: 200 });
    }
    if (fails > 0) {
      fails--;
      return new Response("boom", { status: 503 });
    }
    const body = JSON.parse(String(init?.body || "{}"));
    sent.push({ url: String(url), body, beacon: false });
    return new Response(JSON.stringify({ ok: true }), { status: opts.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  if (opts.beacon === false) {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
  } else {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn((url: string, data: Blob) => {
        // Blob.text() is async; keep the raw text synchronously by reading the parts we built
        void data;
        sent.push({ url, body: lastBeaconBody as Sent["body"], beacon: true });
        return true;
      }),
    });
  }
  return sent;
}

export let lastBeaconBody: unknown = null;
const RealBlob = globalThis.Blob;
export function patchBlob(): void {
  // record the text of the last Blob built so beacon payloads can be asserted synchronously
  class SpyBlob extends RealBlob {
    constructor(parts?: BlobPart[], o?: BlobPropertyBag) {
      super(parts, o);
      try {
        lastBeaconBody = JSON.parse(String(parts?.[0]));
      } catch {
        lastBeaconBody = null;
      }
    }
  }
  vi.stubGlobal("Blob", SpyBlob);
}

export function clearStorage(): void {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie.split(";").forEach((c) => {
    const n = c.split("=")[0]?.trim();
    if (n) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

export const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
