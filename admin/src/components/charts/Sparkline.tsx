/** 12–60 point sparkline in the de-emphasis gray with the last point in the accent. */
export function Sparkline({ values, width = 96, height = 28, accentLast = true }: { values: number[]; width?: number; height?: number; accentLast?: boolean }) {
  const n = values.length;
  if (!n) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(1, ...values);
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke="var(--compare)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {accentLast && <circle cx={x(n - 1)} cy={y(values[n - 1]!)} r={3} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={1.5} />}
    </svg>
  );
}

/** Column sparkline for per-minute live traffic: thin bars from a single baseline, tooltip on hover. */
export function Columns({ points, height = 64 }: { points: { t: string; v: number }[]; height?: number }) {
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.v));
  return (
    <div className="flex h-full items-end gap-[2px]" style={{ height }} role="img" aria-label="visitors per minute">
      {points.map((p, i) => {
        const h = Math.max(2, (p.v / max) * (height - 4));
        const last = i === n - 1;
        return (
          <div key={p.t} className="group relative flex-1" style={{ height }}>
            <div className="absolute bottom-0 w-full rounded-t-[3px] transition-opacity group-hover:opacity-80" style={{ height: h, background: last ? "var(--accent)" : "var(--seq-300)" }} />
            <div className="card pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap px-2 py-1 text-[11.5px] group-hover:block">
              <strong className="num">{p.v}</strong> <span className="text-t3">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(p.t))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
