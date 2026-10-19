// The IIFE entry: installs `window.hanu`, drains `window.hanuq`, and auto-inits from the script tag.
import { hanu, type Hanu } from "./index";
import { doc, safe, win } from "./utils";

type QueuedCall = [keyof Hanu, ...unknown[]];

declare global {
  interface Window {
    hanu?: Hanu;
    hanuq?: QueuedCall[] | { push: (call: QueuedCall) => void };
  }
}

function run(call: QueuedCall): void {
  safe(() => {
    const [name, ...args] = call;
    const fn = hanu[name] as unknown;
    if (typeof fn === "function") (fn as (...a: unknown[]) => unknown)(...args);
  });
}

safe(() => {
  win.hanu = hanu;
  // the script tag: <script async src="…/hanu.js" data-token="ha_pk_…" data-api-host="…">
  const s = (doc.currentScript as HTMLScriptElement | null) || doc.querySelector<HTMLScriptElement>("script[data-token][src*='hanu']");
  const token = s?.getAttribute("data-token");
  if (token) {
    const flag = (k: string): boolean | undefined => {
      const v = s!.getAttribute(k);
      return v === null ? undefined : v !== "false" && v !== "0" && v !== "off";
    };
    hanu.init(token, {
      apiHost: s!.getAttribute("data-api-host") || undefined,
      cookieless: flag("data-cookieless") === true,
      record: flag("data-record"),
      autocapture: flag("data-autocapture") === false ? false : undefined,
      debug: flag("data-debug") === true,
      respectDnt: flag("data-respect-dnt") === true,
    });
  }
  // calls queued before the script loaded, then a live queue
  const q = win.hanuq;
  if (Array.isArray(q)) for (const call of q) run(call);
  win.hanuq = { push: run };
});
