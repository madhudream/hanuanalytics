import { getAnonId, getDistinctId, isNewVisitor, touchSession } from "./ids";
import { EventQueue } from "./queue";
import type { HanuEvent, Listener, Props, RemoteConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";
import { cleanProps, currentUrl, doc, log, nav, now, win } from "./utils";

/** Shared state for every module: where to send, the config, and `capture` itself. */
export class Client {
  config: RemoteConfig = DEFAULT_CONFIG;
  enabled = true;
  private listeners: Listener[] = [];
  beforeSend: ((e: HanuEvent) => boolean | void) | undefined;

  constructor(
    public readonly apiHost: string,
    public readonly token: string,
    public readonly queue: EventQueue,
  ) {}

  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** Properties every event carries. */
  baseProps(): Props {
    const p: Props = {};
    try {
      p.$current_url = currentUrl();
      p.$title = doc.title;
      const s = win.screen;
      if (s) {
        p.$screen_width = s.width;
        p.$screen_height = s.height;
      }
      p.$viewport_width = win.innerWidth;
      p.$viewport_height = win.innerHeight;
      p.$language = nav.language;
      try {
        p.$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        /* ignore */
      }
      if (isNewVisitor()) p.$is_new_visitor = true;
    } catch {
      /* ignore */
    }
    return p;
  }

  /** Build and queue an event. `beacon` flushes immediately through a beacon (used on page leave). */
  capture(event: string, props?: Props, extra?: { set?: Props; set_once?: Props; beacon?: boolean; ts?: number }): HanuEvent | null {
    if (!this.enabled || !event) return null;
    const session = touchSession();
    const ev: HanuEvent = {
      event,
      ts: extra?.ts ?? now(),
      distinct_id: getDistinctId(),
      session_id: session.id,
      props: { ...this.baseProps(), ...cleanProps(props) },
    };
    const anon = getAnonId();
    if (anon) ev.anon_id = anon;
    if (session.isNew) ev.props.$session_start = true;
    if (extra?.set) ev.set = cleanProps(extra.set);
    if (extra?.set_once) ev.set_once = cleanProps(extra.set_once);
    if (this.beforeSend) {
      try {
        if (this.beforeSend(ev) === false) return null;
      } catch {
        /* ignore */
      }
    }
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        /* ignore */
      }
    }
    log("capture", ev.event, ev.props);
    this.queue.push(ev);
    if (extra?.beacon) void this.queue.flush(true);
    return ev;
  }
}
