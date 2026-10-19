import type { Props } from "./types";

export const LIB = "hanu-js";
export const LIB_VERSION = "0.1.0";

export const win: Window & typeof globalThis = typeof window !== "undefined" ? window : (undefined as unknown as Window & typeof globalThis);
export const doc: Document = typeof document !== "undefined" ? document : (undefined as unknown as Document);
export const nav: Navigator = typeof navigator !== "undefined" ? navigator : ({} as Navigator);

let debug = false;
export function setDebug(on: boolean): void {
  debug = on;
}
export function log(...args: unknown[]): void {
  if (debug) {
    try {
      console.log("[hanu]", ...args);
    } catch {
      /* ignore */
    }
  }
}

/** Run `fn`; never let an exception reach the host page. */
export function safe<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch (e) {
    log("error", e);
    return fallback;
  }
}

export const now = (): number => Date.now();

export function uid(prefix: string): string {
  let s = "";
  try {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16);
  } catch {
    s = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }
  return prefix + now().toString(36) + s.slice(0, 16);
}

// ---------- storage ----------

function store(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const s = win[kind];
    const k = "__hanu_t";
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export const ls = {
  get(k: string): string | null {
    const s = store("localStorage");
    return s ? s.getItem(k) : null;
  },
  set(k: string, v: string): boolean {
    const s = store("localStorage");
    if (!s) return false;
    s.setItem(k, v);
    return true;
  },
  del(k: string): void {
    const s = store("localStorage");
    if (s) s.removeItem(k);
  },
};

export const ss = {
  get(k: string): string | null {
    const s = store("sessionStorage");
    return s ? s.getItem(k) : null;
  },
  set(k: string, v: string): boolean {
    const s = store("sessionStorage");
    if (!s) return false;
    s.setItem(k, v);
    return true;
  },
  del(k: string): void {
    const s = store("sessionStorage");
    if (s) s.removeItem(k);
  },
};

export const cookie = {
  get(name: string): string | null {
    try {
      const m = doc.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m && m[1] ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  },
  set(name: string, value: string, days: number): void {
    try {
      const exp = new Date(now() + days * 864e5).toUTCString();
      const secure = win.location.protocol === "https:" ? "; Secure" : "";
      doc.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax${secure}`;
    } catch {
      /* ignore */
    }
  },
  del(name: string): void {
    try {
      doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    } catch {
      /* ignore */
    }
  },
};

// ---------- environment ----------

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|phantom|selenium|puppeteer|playwright|pingdom|gtmetrix|facebookexternalhit|embedly|quora link preview|bitlybot|preview|python-requests|curl\/|wget\/|java\/|go-http-client|prerender/i;

export function isBot(): boolean {
  try {
    if ((nav as Navigator & { webdriver?: boolean }).webdriver) return true;
    const ua = nav.userAgent || "";
    if (!ua) return true;
    return BOT_RE.test(ua);
  } catch {
    return false;
  }
}

export function dntEnabled(): boolean {
  try {
    const n = nav as Navigator & { doNotTrack?: string; msDoNotTrack?: string };
    const w = win as Window & { doNotTrack?: string };
    const v = n.doNotTrack || w.doNotTrack || n.msDoNotTrack;
    return v === "1" || v === "yes";
  } catch {
    return false;
  }
}

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

export function urlHost(url: string): string {
  try {
    return new URL(url, win.location.href).hostname;
  } catch {
    return "";
  }
}

export function currentUrl(): string {
  try {
    return win.location.href;
  } catch {
    return "";
  }
}

// ---------- element helpers ----------

const SENSITIVE_RE = /(\b[\w.+-]+@[\w-]+\.[\w.-]+\b)|(\b(?:\d[ -]?){13,19}\b)|(\b\d{3}-\d{2}-\d{4}\b)/g;

/** Hide emails, card-like numbers and SSN-like numbers inside captured text. */
export function maskText(text: string, max = 120): string {
  let t = (text || "").replace(/\s+/g, " ").trim().replace(SENSITIVE_RE, "***");
  if (t.length > max) t = t.slice(0, max);
  return t;
}

const SENSITIVE_INPUT = /password|passwd|secret|token|card|cvv|cvc|ssn|iban|account/i;

export function isSensitiveElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const i = el as HTMLInputElement;
    const type = (i.type || "").toLowerCase();
    if (type === "password" || type === "hidden" || type === "email" || type === "tel" || type === "number") return true;
    if (SENSITIVE_INPUT.test(i.name || "") || SENSITIVE_INPUT.test(i.id || "") || SENSITIVE_INPUT.test(i.autocomplete || "")) return true;
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.closest("[data-hanu-mask], .hanu-mask, [data-hanu-no-capture], .hanu-no-capture")) return true;
  return false;
}

export function elementText(el: Element): string {
  if (isSensitiveElement(el)) return "";
  const tag = el.tagName;
  let text = "";
  if (tag === "INPUT") {
    const i = el as HTMLInputElement;
    const type = (i.type || "").toLowerCase();
    text = type === "submit" || type === "button" || type === "reset" ? i.value : "";
  } else if (tag === "IMG") {
    text = (el as HTMLImageElement).alt || "";
  } else {
    text = el.textContent || "";
  }
  if (!text) text = el.getAttribute("aria-label") || el.getAttribute("title") || "";
  return maskText(text);
}

function cssEscape(s: string): string {
  try {
    return CSS.escape(s);
  } catch {
    return s.replace(/[^\w-]/g, "\\$&");
  }
}

/** A short, stable-ish selector: #id wins, else tag.class:nth-of-type chain, at most 5 levels. */
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 5) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "html") break;
    if (cur.id) {
      parts.unshift("#" + cssEscape(cur.id));
      break;
    }
    let part = tag;
    const cls = Array.from(cur.classList)
      .filter((c) => !/^(hover|active|focus|is-|js-)/.test(c))
      .slice(0, 2);
    if (cls.length) part += "." + cls.map(cssEscape).join(".");
    const parent: Element | null = cur.parentElement;
    if (parent && tag !== "body") {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
    depth++;
  }
  return parts.join(" > ").slice(0, 300);
}

export function cleanProps(p: Props | undefined): Props {
  const out: Props = {};
  if (!p || typeof p !== "object") return out;
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (v === undefined || typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}
