import { startClicks, startForms, startPageviews } from "./autocapture";
import { Client } from "./client";
import { loadConfig } from "./config";
import { startErrors } from "./errors";
import { configureIds, getDistinctId, hasOptedOut, peekSessionId, resetIds, setIdentifiedId, setOptOut, touchSession } from "./ids";
import { EventQueue } from "./queue";
import { Recorder } from "./recording";
import type { AutocaptureConfig, HanuEvent, InitOptions, Listener, Props, RemoteConfig } from "./types";
import { dntEnabled, doc, isBot, log, safe, setDebug, win } from "./utils";
import { startVitals } from "./vitals";

export type { AutocaptureConfig, HanuEvent, InitOptions, Props, RecordingConfig, RemoteConfig } from "./types";

let client: Client | null = null;
let recorder: Recorder | null = null;
let teardowns: Array<() => void> = [];
let pendingListeners: Listener[] = [];
let ready: Promise<void> | null = null;
let currentOpts: InitOptions = {};

function scriptOrigin(): string {
  try {
    const s = (doc.currentScript as HTMLScriptElement | null) || Array.from(doc.querySelectorAll<HTMLScriptElement>("script[data-token]"))[0] || null;
    if (s?.src) return new URL(s.src, win.location.href).origin;
  } catch {
    /* ignore */
  }
  return win.location.origin;
}

function autocaptureFlags(remote: AutocaptureConfig, opt: InitOptions["autocapture"]): AutocaptureConfig {
  if (opt === false) return { pageviews: false, clicks: false, forms: false, errors: false, vitals: false, scroll: false };
  if (opt && typeof opt === "object") return { ...remote, ...opt };
  return remote;
}

/**
 * Start the SDK. Safe to call more than once (later calls are ignored). Everything after this is async and
 * failure-tolerant: events captured before the config arrives are queued and sent normally.
 */
export function init(token: string, opts: InitOptions = {}): void {
  safe(() => {
    if (client) return;
    if (!token) {
      log("init: missing token");
      return;
    }
    currentOpts = opts;
    setDebug(!!opts.debug);
    if (isBot()) {
      log("bot detected; disabled");
      return;
    }
    const apiHost = (opts.apiHost || (opts as { api_host?: string }).api_host || scriptOrigin()).replace(/\/+$/, "");
    configureIds({ cookieless: !!opts.cookieless, sessionTimeoutMs: opts.sessionTimeoutMs || 30 * 60 * 1000 });
    const queue = new EventQueue({ apiHost, token });
    const c = new Client(apiHost, token, queue);
    c.beforeSend = opts.beforeSend;
    client = c;
    for (const l of pendingListeners) c.on(l);
    pendingListeners = [];
    if (hasOptedOut() || (opts.respectDnt && dntEnabled())) {
      c.enabled = false;
      log("opted out");
      return;
    }
    ready = loadConfig(apiHost, token).then((cfg) => safe(() => start(c, cfg)));
  });
}

function start(c: Client, cfg: RemoteConfig): void {
  c.config = cfg;
  if (cfg.respect_dnt && dntEnabled()) {
    c.enabled = false;
    log("DNT honoured; disabled");
    return;
  }
  configureIds({ cookieless: !!currentOpts.cookieless || !!cfg.cookieless, sessionTimeoutMs: cfg.session_timeout_ms || currentOpts.sessionTimeoutMs || 30 * 60 * 1000 });
  const ac = autocaptureFlags(cfg.autocapture, currentOpts.autocapture);
  if (ac.pageviews) teardowns.push(startPageviews(c, ac.scroll));
  if (ac.clicks) teardowns.push(startClicks(c));
  if (ac.forms) teardowns.push(startForms(c));
  if (ac.errors) teardowns.push(startErrors(c));
  if (ac.vitals) teardowns.push(startVitals(c));
  recorder = new Recorder(c);
  if (currentOpts.record !== false) void recorder.maybeStart(false);
}

export function capture(event: string, props?: Props): void {
  safe(() => {
    client?.capture(event, props);
  });
}

export function pageview(props?: Props): void {
  safe(() => {
    client?.capture("$pageview", { $referrer: doc.referrer, ...props });
  });
}

export function identify(id: string, set?: Props, setOnce?: Props): void {
  safe(() => {
    if (!client || !id) return;
    const prev = getDistinctId();
    setIdentifiedId(String(id));
    const extra: { set?: Props; set_once?: Props } = {};
    if (set) extra.set = set;
    if (setOnce) extra.set_once = setOnce;
    client.capture("$identify", { $anon_distinct_id: prev }, extra);
  });
}

export function alias(id: string): void {
  safe(() => {
    client?.capture("$alias", { $alias: String(id), $distinct_id: getDistinctId() });
  });
}

export function setPersonProps(set: Props, setOnce?: Props): void {
  safe(() => {
    client?.capture("$set", {}, { set, set_once: setOnce });
  });
}

export function reset(): void {
  safe(() => {
    void client?.queue.flush(false);
    resetIds();
  });
}

export function optOut(): void {
  safe(() => {
    setOptOut(true);
    if (client) client.enabled = false;
    recorder?.stopRecording();
  });
}

export function optIn(): void {
  safe(() => {
    setOptOut(false);
    if (client) client.enabled = true;
  });
}

export function hasOptedOut_(): boolean {
  return safe(() => hasOptedOut(), false) ?? false;
}
export { hasOptedOut_ as hasOptedOut };

export function startRecording(): void {
  safe(() => {
    if (!client) return;
    const go = (): void => {
      if (!recorder) recorder = new Recorder(client as Client);
      void recorder.maybeStart(true);
    };
    if (ready) void ready.then(go);
    else go();
  });
}

export function stopRecording(): void {
  safe(() => recorder?.stopRecording());
}

export function isRecording(): boolean {
  return safe(() => !!recorder?.active, false) ?? false;
}

export function getDistinctId_(): string | undefined {
  return safe(() => (client ? getDistinctId() : undefined));
}
export { getDistinctId_ as getDistinctId };

export function getSessionId(): string | undefined {
  return safe(() => (client ? peekSessionId() || touchSession().id : undefined));
}

export function flush(): Promise<void> {
  return safe(() => client?.queue.flush(false)) || Promise.resolve();
}

/** `on("event", cb)`: called with every event as it is captured (after `beforeSend`). Returns an unsubscribe function. */
export function on(name: "event", cb: Listener): () => void {
  if (name !== "event") return () => {};
  if (client) return client.on(cb);
  pendingListeners.push(cb);
  return () => {
    pendingListeners = pendingListeners.filter((l) => l !== cb);
  };
}

/** Tear everything down (tests). */
export function _destroy(): void {
  for (const t of teardowns) safe(t);
  teardowns = [];
  recorder?.stopRecording();
  recorder = null;
  client = null;
  ready = null;
  pendingListeners = [];
}

/** Whether `init` has run and the SDK is active. */
export function isEnabled(): boolean {
  return !!client?.enabled;
}

export const hanu = {
  init,
  capture,
  pageview,
  identify,
  alias,
  setPersonProps,
  reset,
  optOut,
  optIn,
  hasOptedOut: hasOptedOut_,
  startRecording,
  stopRecording,
  isRecording,
  getDistinctId: getDistinctId_,
  getSessionId,
  flush,
  on,
  isEnabled,
  _destroy,
};
export type Hanu = typeof hanu;
export default hanu;
