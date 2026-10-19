import type { Client } from "./client";
import type { Props } from "./types";
import { currentUrl, doc, elementText, isSensitiveElement, log, now, selectorFor, urlHost, win } from "./utils";

const DOWNLOAD_RE = /\.(pdf|zip|rar|7z|gz|tar|dmg|exe|msi|apk|csv|xlsx?|docx?|pptx?|mp3|mp4|mov|avi|wav|epub|txt|json|ipa|pkg|deb|rpm)(\?|#|$)/i;
const CLICKABLE = "a,button,input[type=submit],input[type=button],input[type=reset],[role=button],label,summary,[data-hanu-capture]";

export interface Teardown {
  (): void;
}

// ---------- pageviews, page leave, engaged time, scroll depth ----------

export function startPageviews(c: Client, trackScroll: boolean): Teardown {
  let url = currentUrl();
  let viewStart = now();
  let visibleSince: number | null = doc.visibilityState === "hidden" ? null : now();
  let engaged = 0;
  let maxScroll = 0;
  let leaveSent = false;

  const scrollDepth = (): number => {
    try {
      const h = doc.documentElement;
      const total = Math.max(h.scrollHeight, doc.body?.scrollHeight || 0);
      if (!total) return 0;
      const seen = (win.scrollY || h.scrollTop || 0) + win.innerHeight;
      return Math.max(0, Math.min(100, Math.round((seen / total) * 100)));
    } catch {
      return 0;
    }
  };
  const onScroll = (): void => {
    const d = scrollDepth();
    if (d > maxScroll) maxScroll = d;
  };
  const settle = (): void => {
    if (visibleSince !== null) {
      engaged += now() - visibleSince;
      visibleSince = null;
    }
  };
  const resume = (): void => {
    if (visibleSince === null && doc.visibilityState !== "hidden") visibleSince = now();
  };

  const pageleave = (beacon: boolean): void => {
    if (leaveSent) return;
    leaveSent = true;
    settle();
    onScroll();
    c.capture(
      "$pageleave",
      { $current_url: url, $duration_ms: Math.max(0, Math.round(engaged)), $scroll_depth: maxScroll, $time_on_page_ms: now() - viewStart },
      { beacon },
    );
  };

  const pageview = (prev?: string): void => {
    url = currentUrl();
    viewStart = now();
    engaged = 0;
    maxScroll = 0;
    leaveSent = false;
    visibleSince = doc.visibilityState === "hidden" ? null : now();
    const props: Props = { $current_url: url, $referrer: prev ?? doc.referrer ?? "" };
    if (prev) props.$prev_url = prev;
    c.capture("$pageview", props);
    setTimeout(onScroll, 0);
  };

  // SPA navigation: history + popstate + hashchange
  const h = win.history;
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  const navigated = (): void => {
    const next = currentUrl();
    if (next === url) return;
    const prev = url;
    pageleave(false);
    pageview(prev);
  };
  const patched = (orig: typeof h.pushState) =>
    function (this: History, ...args: Parameters<typeof h.pushState>) {
      const r = orig.apply(this, args);
      setTimeout(navigated, 0);
      return r;
    };
  h.pushState = patched(origPush);
  h.replaceState = patched(origReplace);
  win.addEventListener("popstate", navigated);
  win.addEventListener("hashchange", navigated);

  const onVis = (): void => {
    if (doc.visibilityState === "hidden") {
      settle();
      pageleave(true);
      leaveSent = false; // a tab that comes back keeps the same pageview; allow one more leave later
      engaged = 0;
      viewStart = now();
    } else resume();
  };
  const onHide = (): void => pageleave(true);
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("pagehide", onHide);
  if (trackScroll) win.addEventListener("scroll", onScroll, { passive: true });

  pageview();

  return () => {
    h.pushState = origPush;
    h.replaceState = origReplace;
    win.removeEventListener("popstate", navigated);
    win.removeEventListener("hashchange", navigated);
    doc.removeEventListener("visibilitychange", onVis);
    win.removeEventListener("pagehide", onHide);
    win.removeEventListener("scroll", onScroll);
  };
}

// ---------- clicks: autocapture, outbound, download, rage ----------

export function elementProps(el: Element): Props {
  const p: Props = {
    $el_tag: el.tagName.toLowerCase(),
    $el_text: elementText(el),
    $el_selector: selectorFor(el),
  };
  if (el.id) p.$el_id = el.id;
  const cls = Array.from(el.classList).slice(0, 10).join(" ");
  if (cls) p.$el_classes = cls;
  const name = el.getAttribute("name") || el.getAttribute("data-hanu-name") || el.getAttribute("aria-label");
  if (name) p.$el_name = name;
  const href = (el as HTMLAnchorElement).href || el.getAttribute("href");
  if (href && !isSensitiveElement(el)) p.$el_href = String(href).slice(0, 500);
  return p;
}

export function startClicks(c: Client): Teardown {
  const recent: Array<{ t: number; x: number; y: number }> = [];
  let rageFired = 0;

  const onClick = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    if (!target || target.nodeType !== 1) return;
    // rage click: three clicks within one second, within 30px
    const t = now();
    recent.push({ t, x: e.clientX, y: e.clientY });
    while (recent.length && t - recent[0]!.t > 1000) recent.shift();
    const near = recent.filter((r) => Math.abs(r.x - e.clientX) < 30 && Math.abs(r.y - e.clientY) < 30);
    if (near.length >= 3 && t - rageFired > 1000) {
      rageFired = t;
      recent.length = 0;
      c.capture("$rageclick", { $el_selector: selectorFor(target), $el_tag: target.tagName.toLowerCase(), $el_text: elementText(target) });
    }

    const el = target.closest(CLICKABLE);
    if (!el || el.closest("[data-hanu-no-capture], .hanu-no-capture")) return;
    const props = elementProps(el);
    const a = el.tagName === "A" ? (el as HTMLAnchorElement) : null;
    const href = a?.href;
    let leaving = false;
    if (href && /^https?:/i.test(href)) {
      const host = urlHost(href);
      if (host && host !== win.location.hostname) {
        leaving = !a.target || a.target === "_self";
        c.capture("$outbound", { $href: href.slice(0, 500), $el_text: props.$el_text, $el_selector: props.$el_selector }, { beacon: leaving });
      }
      if (DOWNLOAD_RE.test(href) || a.hasAttribute("download")) {
        c.capture("$download", { $href: href.slice(0, 500), $el_text: props.$el_text }, { beacon: true });
      }
    }
    c.capture("$autocapture", props, { beacon: leaving });
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}

// ---------- forms ----------

export function startForms(c: Client): Teardown {
  const onSubmit = (e: Event): void => {
    const f = e.target as HTMLFormElement | null;
    if (!f || f.tagName !== "FORM" || f.closest("[data-hanu-no-capture], .hanu-no-capture")) return;
    const props: Props = { $el_selector: selectorFor(f) };
    if (f.id) props.$form_id = f.id;
    const name = f.getAttribute("name");
    if (name) props.$form_name = name;
    const action = f.getAttribute("action");
    if (action) props.$form_action = action.slice(0, 500);
    props.$form_method = (f.method || "get").toLowerCase();
    log("form submit", props);
    c.capture("$form_submit", props, { beacon: true });
  };
  doc.addEventListener("submit", onSubmit, true);
  return () => doc.removeEventListener("submit", onSubmit, true);
}
