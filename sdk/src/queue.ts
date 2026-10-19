import type { HanuEvent } from "./types";
import { LIB, LIB_VERSION, log, nav, now, safeJson } from "./utils";

export interface QueueOptions {
  apiHost: string;
  token: string;
  flushIntervalMs?: number;
  maxBatch?: number;
  fetchImpl?: typeof fetch;
}

export interface Transport {
  /** Send a JSON body to `path`. `beacon` asks for a fire-and-forget delivery that survives unload. */
  send(path: string, body: string, beacon: boolean): Promise<boolean>;
}

const FLUSH_MS = 3000;
const MAX_BATCH = 20;
const BEACON_LIMIT = 60 * 1024;

export function makeTransport(fetchImpl?: typeof fetch): Transport {
  return {
    async send(url: string, body: string, beacon: boolean): Promise<boolean> {
      if (beacon && body.length < BEACON_LIMIT) {
        try {
          if (typeof nav.sendBeacon === "function" && nav.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return true;
        } catch {
          /* fall through */
        }
      }
      const f = fetchImpl || (typeof fetch === "function" ? fetch : undefined);
      if (!f) return false;
      const attempt = async (): Promise<boolean> => {
        const res = await f(url, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body,
          keepalive: beacon || body.length < BEACON_LIMIT,
          credentials: "omit",
          mode: "cors",
        });
        if (res.ok) return true;
        if (res.status >= 400 && res.status < 500) {
          log("rejected", res.status);
          return true; // do not retry client errors
        }
        throw new Error("status " + res.status);
      };
      try {
        return await attempt();
      } catch (e) {
        log("send failed, retrying once", e);
        try {
          return await attempt();
        } catch {
          return false;
        }
      }
    },
  };
}

export class EventQueue {
  private q: HanuEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushMs: number;
  private readonly maxBatch: number;
  private readonly transport: Transport;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly opts: QueueOptions,
    transport?: Transport,
  ) {
    this.flushMs = opts.flushIntervalMs ?? FLUSH_MS;
    this.maxBatch = opts.maxBatch ?? MAX_BATCH;
    this.transport = transport || makeTransport(opts.fetchImpl);
  }

  get size(): number {
    return this.q.length;
  }

  push(ev: HanuEvent): void {
    this.q.push(ev);
    if (this.q.length >= this.maxBatch) {
      void this.flush(false);
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(false), this.flushMs);
  }

  private body(events: HanuEvent[]): string {
    return safeJson({ token: this.opts.token, sent_at: now(), lib: LIB, lib_version: LIB_VERSION, events });
  }

  /** Send everything queued. With `beacon` the batch goes through sendBeacon / keepalive so it survives unload. */
  flush(beacon: boolean): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.q.length) return Promise.resolve();
    const url = `${this.opts.apiHost}/api/v1/e`;
    const batches: HanuEvent[][] = [];
    while (this.q.length) batches.push(this.q.splice(0, this.maxBatch));
    const p = (async () => {
      for (const b of batches) {
        const ok = await this.transport.send(url, this.body(b), beacon);
        if (!ok) log("dropped", b.length, "events");
      }
    })();
    this.inflight = p;
    return p;
  }
}
