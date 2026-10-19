import type { Client } from "./client";
import type { Props } from "./types";
import { doc, win } from "./utils";

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface InteractionEntry extends PerformanceEntry {
  interactionId?: number;
  duration: number;
}

/** Core Web Vitals without a library: LCP, CLS (session windows), INP (p98 of interactions), FCP, TTFB. */
export function startVitals(c: Client): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  const v: Props = {};
  const observers: PerformanceObserver[] = [];
  let sent = false;

  const observe = (type: string, cb: (entries: PerformanceEntry[]) => void, buffered = true): void => {
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      const po = new PerformanceObserver((list) => cb(list.getEntries()));
      po.observe({ type, buffered } as PerformanceObserverInit);
      observers.push(po);
    } catch {
      /* ignore */
    }
  };

  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) v.$lcp = Math.round(last.startTime);
  });
  observe("paint", (entries) => {
    for (const e of entries) if (e.name === "first-contentful-paint") v.$fcp = Math.round(e.startTime);
  });

  // CLS: largest session window (gap 1 s, max 5 s)
  let clsValue = 0;
  let sessionValue = 0;
  let sessionEntries: LayoutShift[] = [];
  observe("layout-shift", (entries) => {
    for (const e of entries as LayoutShift[]) {
      if (e.hadRecentInput) continue;
      const first = sessionEntries[0];
      const last = sessionEntries[sessionEntries.length - 1];
      if (sessionValue && first && last && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) {
        sessionValue += e.value;
        sessionEntries.push(e);
      } else {
        sessionValue = e.value;
        sessionEntries = [e];
      }
      if (sessionValue > clsValue) {
        clsValue = sessionValue;
        v.$cls = Math.round(clsValue * 1000) / 1000;
      }
    }
  });

  // INP: the 98th percentile of the longest interaction per interactionId
  const longest = new Map<number, number>();
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as InteractionEntry[]) {
        if (!e.interactionId) continue;
        const cur = longest.get(e.interactionId) || 0;
        if (e.duration > cur) longest.set(e.interactionId, e.duration);
      }
    });
    po.observe({ type: "event", durationThreshold: 40, buffered: true } as PerformanceObserverInit);
    observers.push(po);
  } catch {
    /* ignore */
  }

  const ttfb = (): void => {
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav && nav.responseStart > 0) v.$ttfb = Math.round(nav.responseStart);
    } catch {
      /* ignore */
    }
  };

  const send = (): void => {
    if (sent) return;
    ttfb();
    if (longest.size) {
      const sorted = Array.from(longest.values()).sort((a, b) => b - a);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length / 50));
      v.$inp = Math.round(sorted[idx] || 0);
    }
    if (!Object.keys(v).length) return;
    sent = true;
    c.capture("$web_vitals", { ...v, $vitals_url: win.location.href }, { beacon: true });
  };
  const onVis = (): void => {
    if (doc.visibilityState === "hidden") send();
  };
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("pagehide", send);
  return () => {
    for (const o of observers) o.disconnect();
    doc.removeEventListener("visibilitychange", onVis);
    win.removeEventListener("pagehide", send);
  };
}
