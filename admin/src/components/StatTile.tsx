import { I } from "./icons";
import { Skeleton } from "./ui";

export function StatTile({ label, value, delta, invert, hint, loading, onClick, active }: { label: string; value: string; delta?: number | null; invert?: boolean; hint?: string; loading?: boolean; onClick?: () => void; active?: boolean }) {
  const good = delta !== null && delta !== undefined ? (invert ? delta < 0 : delta > 0) : null;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={`flex flex-col gap-1 rounded-xl px-4 py-3 text-left transition ${onClick ? "hover:bg-s2" : ""} ${active ? "bg-s2 ring-1 ring-accent/40" : ""}`} aria-pressed={onClick ? active : undefined}>
      <div className="text-[12px] font-medium text-t2">{label}</div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="flex items-baseline gap-2">
          <div className="num text-[24px] font-semibold leading-tight tracking-[-0.02em] text-t1" title={hint}>{value}</div>
          {delta !== undefined && delta !== null && (
            <span className={`num inline-flex items-center gap-0.5 text-[12px] font-medium ${good ? "text-good" : "text-critical"}`} title="vs previous period">
              {delta >= 0 ? <I.arrowUp width={12} height={12} strokeWidth={2.5} /> : <I.arrowDown width={12} height={12} strokeWidth={2.5} />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
      )}
    </Comp>
  );
}
