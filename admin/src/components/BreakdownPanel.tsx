import { useState, type ReactNode } from "react";
import { api, type Breakdown, type BreakdownRow, type Dimension } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { compact, duration, full } from "../lib/format";
import { flag } from "../lib/countries";
import { Button, ErrorBox, Modal, Skeleton, Tabs, Empty } from "./ui";
import { I } from "./icons";

export interface Tab { value: Dimension; label: string }

function keyLabel(by: Dimension, row: BreakdownRow): ReactNode {
  if (by === "country") return <span className="flex items-center gap-2"><span className="text-[15px] leading-none">{flag(row.key)}</span>{row.label ?? row.key}</span>;
  if (by === "device") {
    const Icon = row.key === "mobile" ? I.mobile : row.key === "tablet" ? I.tablet : I.desktop;
    return <span className="flex items-center gap-2 capitalize"><Icon width={14} height={14} className="text-t3" />{row.key}</span>;
  }
  if (by === "referrer_domain" || by === "referrer" || by === "source") {
    const dom = row.key.replace(/\/.*$/, "");
    const isDomain = dom.includes(".");
    return (
      <span className="flex items-center gap-2">
        {isDomain ? <img src={`https://icons.duckduckgo.com/ip3/${dom}.ico`} width={14} height={14} alt="" className="rounded-sm" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <I.globe width={14} height={14} className="text-t3" />}
        {row.label ?? row.key}
      </span>
    );
  }
  return (row.label ?? row.key) || <span className="text-t3">(none)</span>;
}

export function Rows({ by, rows, total, onPick, metricLabel = "Visitors" }: { by: Dimension; rows: BreakdownRow[]; total: number; onPick?: (r: BreakdownRow) => void; metricLabel?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <ul className="flex flex-col gap-[3px]">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            onClick={onPick ? () => onPick(r) : undefined}
            className="row-bar flex w-full items-center justify-between gap-3 rounded-md px-2 py-[5px] text-left text-[13px] hover:bg-s2/60"
            style={{ "--w": `${(r.visitors / max) * 100}%` } as React.CSSProperties}
            title={`${full(r.visitors)} ${metricLabel.toLowerCase()} · ${r.pct.toFixed(1)}%`}
          >
            <span className="truncate-1 text-t1">{keyLabel(by, r)}</span>
            <span className="num flex-none text-t1">{compact(r.visitors)}</span>
          </button>
        </li>
      ))}
      {!rows.length && <li className="px-2 py-6 text-center text-[12.5px] text-t3">No data for this range{total ? "" : " yet"}.</li>}
    </ul>
  );
}

export function BreakdownPanel({ projectId, title, tabs, limit = 8, filterKey }: { projectId: string; title: string; tabs: Tab[]; limit?: number; filterKey?: (by: Dimension) => string }) {
  const { query, addFilter } = useStats();
  const [tab, setTab] = useState<Dimension>(tabs[0]!.value);
  const [open, setOpen] = useState(false);
  const { data, loading, refetching, error, refetch } = useQuery(() => api.breakdown(projectId, query, tab, limit), [projectId, tab, JSON.stringify(query)]);

  const pick = (r: BreakdownRow) => addFilter({ key: filterKey ? filterKey(tab) : tab, op: "is", value: r.key });

  return (
    <section className="card flex min-h-[320px] flex-col">
      <div className="flex min-h-[46px] items-center justify-between gap-2 border-b hairline px-3 py-2">
        <div className="flex-none pl-1 text-[13.5px] font-semibold text-t1">{title}</div>
        <Tabs tabs={tabs} value={tab} onChange={setTab} size="sm" />
      </div>
      <div className={`flex-1 p-3 ${refetching ? "fade-refetch" : ""}`}>
        <div className="mb-1 flex items-center justify-between px-2 text-[11.5px] font-medium uppercase tracking-wide text-t3">
          <span>{tabs.find((t) => t.value === tab)?.label}</span>
          <span>Visitors</span>
        </div>
        {error ? <ErrorBox error={error} retry={refetch} /> : loading ? <SkeletonRows n={limit} /> : <Rows by={tab} rows={data?.rows ?? []} total={data?.total_visitors ?? 0} onPick={pick} />}
      </div>
      <div className="border-t hairline px-3 py-1.5">
        <Button variant="ghost" size="sm" className="w-full justify-center text-t2" onClick={() => setOpen(true)}>Details</Button>
      </div>
      <DetailsModal open={open} onClose={() => setOpen(false)} projectId={projectId} by={tab} title={`${title} · ${tabs.find((t) => t.value === tab)?.label}`} onPick={(r) => { pick(r); setOpen(false); }} />
    </section>
  );
}

export function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="skeleton h-4" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

export function DetailsModal({ open, onClose, projectId, by, title, onPick }: { open: boolean; onClose: () => void; projectId: string; by: Dimension; title: string; onPick: (r: BreakdownRow) => void }) {
  const { query } = useStats();
  const [view, setView] = useState<"bars" | "table">("bars");
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const { data, loading, error, refetch } = useQuery<Breakdown>(() => api.breakdown(projectId, query, by, limit, offset), [projectId, by, JSON.stringify(query), offset, open], { enabled: open });
  const rows = data?.rows ?? [];
  const csv = () => {
    const lines = [["key", "visitors", "pageviews", "sessions", "bounce_rate", "avg_duration_s"].join(","), ...rows.map((r) => [JSON.stringify(r.label ?? r.key), r.visitors, r.pageviews, r.sessions, r.bounce_rate.toFixed(1), r.avg_duration_s.toFixed(0)].join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${by}.csv`;
    a.click();
  };
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Tabs tabs={[{ value: "bars", label: "Bars" }, { value: "table", label: "Table" }]} value={view} onChange={setView} size="sm" />
        <Button size="sm" onClick={csv} disabled={!rows.length}><I.download width={14} height={14} />CSV</Button>
      </div>
      {error ? <ErrorBox error={error} retry={refetch} /> : loading ? <SkeletonRows n={12} /> : !rows.length ? <Empty title="No data" body="Nothing matched this range and filters." /> : view === "bars" ? (
        <Rows by={by} rows={rows} total={data?.total_visitors ?? 0} onPick={onPick} />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] uppercase tracking-wide text-t3">
              <th className="py-1.5 pr-2 font-medium">{by}</th>
              <th className="num py-1.5 pr-2 text-right font-medium">Visitors</th>
              <th className="num py-1.5 pr-2 text-right font-medium">Pageviews</th>
              <th className="num py-1.5 pr-2 text-right font-medium">Sessions</th>
              <th className="num py-1.5 pr-2 text-right font-medium">Bounce</th>
              <th className="num py-1.5 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t hairline hover:bg-s2/60">
                <td className="py-1.5 pr-2"><button className="truncate-1 max-w-[320px] text-left hover:text-accent" onClick={() => onPick(r)}>{keyLabel(by, r)}</button></td>
                <td className="num py-1.5 pr-2 text-right">{full(r.visitors)}</td>
                <td className="num py-1.5 pr-2 text-right">{full(r.pageviews)}</td>
                <td className="num py-1.5 pr-2 text-right">{full(r.sessions)}</td>
                <td className="num py-1.5 pr-2 text-right">{r.bounce_rate.toFixed(0)}%</td>
                <td className="num py-1.5 text-right">{duration(r.avg_duration_s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(rows.length === limit || offset > 0) && (
        <div className="mt-3 flex justify-end gap-1">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
          <Button size="sm" disabled={rows.length < limit} onClick={() => setOffset(offset + limit)}>Next</Button>
        </div>
      )}
    </Modal>
  );
}
