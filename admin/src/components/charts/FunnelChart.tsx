import type { FunnelStep } from "../../api";
import { compact, eventLabel, full } from "../../lib/format";

/** Columns from one baseline, single hue, value on the cap, drop-off between steps. */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  const H = 220;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[480px] gap-3" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const h = Math.max(4, (s.count / max) * H);
          return (
            <div key={s.event + i} className="group flex flex-col">
              <div className="relative flex items-end justify-center" style={{ height: H + 24 }}>
                <div className="num mb-1 text-[13px] font-semibold text-t1" style={{ position: "absolute", bottom: h + 4 }}>{compact(s.count)}</div>
                <div className="w-full max-w-[72px] rounded-t-[4px] transition-opacity group-hover:opacity-85" style={{ height: h, background: "var(--series-1)" }} title={`${eventLabel(s.event)}: ${full(s.count)}`} />
              </div>
              <div className="mt-2 border-t hairline pt-2 text-center">
                <div className="truncate-1 text-[12.5px] font-medium text-t1" title={s.event}>{i + 1}. {eventLabel(s.event)}</div>
                <div className="num text-[12px] text-t2">{s.pct.toFixed(1)}% of first</div>
                {i > 0 && <div className="num text-[11.5px] text-t3">↓ {s.drop_pct.toFixed(1)}% drop</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
