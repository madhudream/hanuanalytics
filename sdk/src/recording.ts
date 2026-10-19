import type { Client } from "./client";
import { getDistinctId, onSessionRotate, peekSessionId, touchSession } from "./ids";
import { makeTransport } from "./queue";
import { doc, log, now, safeJson, ss, win } from "./utils";

export const K_REC = "hanu_rec";
export const K_RSEQ = "hanu_rseq";

const FLUSH_MS = 5000;
const FLUSH_EVENTS = 50;
const FLUSH_BYTES = 256 * 1024;
const BEACON_LIMIT = 60 * 1024;

type RrwebEvent = { type: number; data: unknown; timestamp: number };
type RecordFn = (opts: Record<string, unknown>) => (() => void) | undefined;

declare global {
  interface Window {
    __hanuRecord?: RecordFn;
  }
}

let loader: Promise<RecordFn | null> | null = null;

/** Load `/hanu-rec.js` (rrweb's record) once. */
export function loadRecorder(apiHost: string): Promise<RecordFn | null> {
  if (win.__hanuRecord) return Promise.resolve(win.__hanuRecord);
  if (loader) return loader;
  loader = new Promise((resolve) => {
    try {
      const s = doc.createElement("script");
      s.async = true;
      s.src = `${apiHost}/hanu-rec.js`;
      s.onload = () => resolve(win.__hanuRecord || null);
      s.onerror = () => {
        loader = null;
        resolve(null);
      };
      (doc.head || doc.documentElement).appendChild(s);
    } catch {
      resolve(null);
    }
  });
  return loader;
}

/** Decide once per session whether this session is recorded; the decision sticks in sessionStorage. */
export function sampledIn(sessionId: string, rate: number): boolean {
  const raw = ss.get(K_REC);
  if (raw) {
    const [sid, flag] = raw.split(":");
    if (sid === sessionId) return flag === "1";
  }
  const yes = rate >= 1 || Math.random() < rate;
  ss.set(K_REC, `${sessionId}:${yes ? "1" : "0"}`);
  return yes;
}

function nextSeq(sessionId: string): number {
  const raw = ss.get(K_RSEQ);
  let seq = 0;
  if (raw) {
    const [sid, n] = raw.split(":");
    if (sid === sessionId) seq = Number(n) || 0;
  }
  ss.set(K_RSEQ, `${sessionId}:${seq + 1}`);
  return seq;
}

async function gzip(text: string): Promise<Blob | null> {
  try {
    if (typeof CompressionStream === "undefined") return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

export class Recorder {
  private stop: (() => void) | null = null;
  private buf: RrwebEvent[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessionId = "";
  private forced = false;
  private transport = makeTransport();
  private started = false;
  private announced = new Set<string>();

  constructor(private readonly c: Client) {
    onSessionRotate(() => {
      if (this.started) {
        // a new session means a new recording: flush, restart with a fresh snapshot (seq 0)
        void this.flush(false);
        this.restart();
      }
    });
    const onHide = (): void => {
      if (doc.visibilityState === "hidden") void this.flush(true);
    };
    doc.addEventListener("visibilitychange", onHide);
    win.addEventListener("pagehide", () => void this.flush(true));
  }

  /** Start if the project config allows it and the session is sampled in. `force` ignores sampling. */
  async maybeStart(force = false): Promise<boolean> {
    if (this.started) return true;
    const rc = this.c.config.recording;
    if (!force && !rc.enabled) return false;
    const sid = touchSession().id;
    if (!force && !sampledIn(sid, rc.sample_rate)) {
      log("recording: sampled out");
      return false;
    }
    this.forced = force;
    const record = await loadRecorder(this.c.apiHost);
    if (!record) return false;
    if (this.started) return true;
    this.begin(record, sid);
    return true;
  }

  private begin(record: RecordFn, sid: string): void {
    const rc = this.c.config.recording;
    this.sessionId = sid;
    const opts: Record<string, unknown> = {
      emit: (e: RrwebEvent) => this.onEvent(e),
      maskAllInputs: rc.mask_all_inputs !== false,
      maskInputOptions: { password: true, email: true, tel: true, number: true, text: rc.mask_all_inputs !== false },
      checkoutEveryNms: 300000,
      sampling: { mousemove: 50, scroll: 150, input: "last" },
      inlineStylesheet: true,
      collectFonts: false,
      recordCanvas: false,
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true, headMetaRobots: true },
      blockClass: "hanu-block",
      maskTextClass: "hanu-mask",
    };
    if (rc.mask_text_selector) opts.maskTextSelector = rc.mask_text_selector;
    if (rc.block_selector) opts.blockSelector = rc.block_selector;
    try {
      this.stop = record(opts) || null;
      this.started = true;
      if (!this.announced.has(sid)) {
        this.announced.add(sid);
        this.c.capture("$recording_start", { $session_id: sid });
      }
      log("recording started", sid);
    } catch (e) {
      log("recording failed", e);
    }
  }

  private restart(): void {
    const stop = this.stop;
    this.stop = null;
    this.started = false;
    try {
      stop?.();
    } catch {
      /* ignore */
    }
    this.buf = [];
    this.bytes = 0;
    void this.maybeStart(this.forced);
  }

  stopRecording(): void {
    const stop = this.stop;
    this.stop = null;
    this.started = false;
    try {
      stop?.();
    } catch {
      /* ignore */
    }
    void this.flush(false);
  }

  get active(): boolean {
    return this.started;
  }

  private onEvent(e: RrwebEvent): void {
    this.buf.push(e);
    this.bytes += safeJson(e).length;
    if (this.buf.length >= FLUSH_EVENTS || this.bytes >= FLUSH_BYTES) {
      void this.flush(false);
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(false), FLUSH_MS);
  }

  async flush(beacon: boolean): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buf.length) return;
    const events = this.buf;
    this.buf = [];
    this.bytes = 0;
    const sid = this.sessionId || peekSessionId() || "";
    const body = safeJson({
      token: this.c.token,
      session_id: sid,
      distinct_id: getDistinctId(),
      seq: nextSeq(sid),
      ts: now(),
      url: win.location.href,
      events,
    });
    await this.send(body, beacon);
  }

  private async send(json: string, beacon: boolean): Promise<void> {
    const url = `${this.c.apiHost}/api/v1/r`;
    // during unload a beacon (uncompressed, ≤ 60 KB) is the only reliable path
    if (beacon && json.length < BEACON_LIMIT) {
      await this.transport.send(url, json, true);
      return;
    }
    const gz = await gzip(json);
    if (!gz || typeof fetch !== "function") {
      await this.transport.send(url, json, beacon);
      return;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "text/plain", "content-encoding": "gzip" },
        body: gz,
        keepalive: beacon || gz.size < BEACON_LIMIT,
        credentials: "omit",
        mode: "cors",
      });
      if (!res.ok && res.status >= 500) await this.transport.send(url, json, beacon);
    } catch {
      await this.transport.send(url, json, beacon);
    }
  }
}
