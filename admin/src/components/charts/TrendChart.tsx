import { useEffect, useRef, useState } from "react";
import type { SeriesPoint } from "../../api";
import { compact, full } from "../../lib/format";

type Metric = "visitors" | "pageviews" | "sessions";

interface Props {
  series: SeriesPoint[];
  prev?: SeriesPoint[];
  metric: Metric;
  interval: "hour" | "day" | "week" | "month";
  height?: number;
  label?: string;
}

function fmtTick(iso: string, interval: Props["interval"]): string {
  const d = new Date(iso);
  if (interval === "hour") return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(d);
  if (interval === "month") return new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(d);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}
function fmtFull(iso: string, interval: Props["interval"]): string {
  const d = new Date(iso);
  if (interval === "hour") return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric" }).format(d);
  if (interval === "month") return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
  if (interval === "week") return `Week of ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d)}`;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

/** Single-series line + 10 % area wash, previous-period series in the de-emphasis gray, crosshair tooltip. */
export function TrendChart({ series, prev, metric, interval, height = 260, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(800);
  const padL = 40, padR = 12, padT = 12, padB = 26;
  const n = series.length;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setW(Math.max(200, el.clientWidth));
    const ro = new ResizeObserver((es) => es[0] && setW(Math.max(200, es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = series.map((p) => p[metric]);
  const prevValues = prev?.map((p) => p[metric]) ?? [];
  const max = niceMax(Math.max(1, ...values, ...prevValues));
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = n ? `${path} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z` : "";
  const prevPath = prevValues.slice(0, n).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !n) return;
    const px = e.clientX - rect.left - padL;
    const i = Math.round((px / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hp = hover !== null ? series[hover] : undefined;
  const hpPrev = hover !== null ? prev?.[hover] : undefined;
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover) - 80, 0), w - 170) : 0;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={label ?? `${metric} over time`} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)" className="num">{compact(t)}</text>
          </g>
        ))}
        {series.map((p, i) => i % tickEvery === 0 && (
          <text key={p.t} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--text-3)">{fmtTick(p.t, interval)}</text>
        ))}
        {prevPath && <path d={prevPath} fill="none" stroke="var(--compare)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {area && <path d={area} fill="var(--series-1)" opacity={0.1} />}
        {path && <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {n > 0 && <circle cx={x(n - 1)} cy={y(values[n - 1]!)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />}
        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--text-3)" strokeWidth={1} />
            {hpPrev && <circle cx={x(hover)} cy={y(hpPrev[metric])} r={4} fill="var(--compare)" stroke="var(--surface-1)" strokeWidth={2} />}
            <circle cx={x(hover)} cy={y(hp[metric])} r={5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="card pointer-events-none absolute top-2 z-10 min-w-[160px] px-3 py-2 text-[12.5px]" style={{ left: tipLeft }}>
          <div className="mb-1 text-t3">{fmtFull(hp.t, interval)}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-t2"><i className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--series-1)" }} />{metric}</span>
            <strong className="num text-t1">{full(hp[metric])}</strong>
          </div>
          {hpPrev && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-t2"><i className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--compare)" }} />previous</span>
              <strong className="num text-t1">{full(hpPrev[metric])}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
