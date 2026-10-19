export function compact(n: number, digits = 1): string {
  if (!isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs < 1000) return Number.isInteger(n) ? String(n) : n.toFixed(digits);
  if (abs < 1_000_000) return trim((n / 1000).toFixed(digits)) + "K";
  if (abs < 1_000_000_000) return trim((n / 1_000_000).toFixed(digits)) + "M";
  return trim((n / 1_000_000_000).toFixed(digits)) + "B";
}
function trim(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function full(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

export function bytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function delta(cur: number, prev: number | undefined): number | null {
  if (prev === undefined || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const d = (now - new Date(iso).getTime()) / 1000;
  if (d < 5) return "just now";
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Friendly labels for the SDK's $-events. */
export function eventLabel(name: string): string {
  const map: Record<string, string> = {
    $pageview: "Pageview",
    $pageleave: "Page leave",
    $autocapture: "Click",
    $outbound: "Outbound link",
    $download: "Download",
    $form_submit: "Form submit",
    $rageclick: "Rage click",
    $exception: "Error",
    $web_vitals: "Web vitals",
    $identify: "Identify",
    $recording_start: "Recording started",
  };
  return map[name] ?? name;
}
