import { useState } from "react";
import { useParams } from "react-router";
import { api } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { PeriodPicker } from "../components/PeriodPicker";
import { FilterChips } from "../components/FilterChips";
import { Card, Empty, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { compact, full, timeAgo } from "../lib/format";
import { I } from "../components/icons";

export function Errors() {
  const { id = "" } = useParams();
  const { query } = useStats();
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, refetching, error, refetch } = useQuery(() => api.errors(id, query, 100), [id, JSON.stringify(query)]);
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Errors" subtitle="JavaScript exceptions and unhandled rejections, grouped by message." actions={<PeriodPicker compare={false} />} />
      <FilterChips />
      {error && <ErrorBox error={error} retry={refetch} />}
      <Card pad={false} className={refetching ? "fade-refetch" : ""}>
        {loading ? <div className="p-4"><Skeleton className="h-64" /></div> : !rows.length ? <Empty icon={<I.check width={28} height={28} />} title="No errors" body="No exceptions were captured in this range." /> : (
          <ul>
            <li className="flex items-center justify-between px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-t3"><span>Message</span><span className="flex gap-4"><span className="w-14 text-right">Count</span><span className="w-14 text-right">Visitors</span><span className="w-20 text-right">Last seen</span></span></li>
            {rows.map((r) => (
              <li key={r.message} className="border-t hairline">
                <button className="row-bar flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-s2/60" style={{ "--w": `${(r.count / max) * 100}%` } as React.CSSProperties} onClick={() => setOpen(open === r.message ? null : r.message)} aria-expanded={open === r.message}>
                  <span className="truncate-1 font-mono text-[12.5px]">{r.message}</span>
                  <span className="num flex flex-none gap-4"><span className="w-14 text-right">{compact(r.count)}</span><span className="w-14 text-right text-t2">{compact(r.visitors)}</span><span className="w-20 text-right text-t2">{timeAgo(r.last_seen)}</span></span>
                </button>
                {open === r.message && (
                  <div className="grid gap-2 bg-s2/50 px-4 py-3 text-[12.5px] sm:grid-cols-3">
                    <div><div className="text-[11px] uppercase tracking-wide text-t3">Occurrences</div><div className="num">{full(r.count)}</div></div>
                    <div><div className="text-[11px] uppercase tracking-wide text-t3">Affected visitors</div><div className="num">{full(r.visitors)}</div></div>
                    <div><div className="text-[11px] uppercase tracking-wide text-t3">Sample page</div><a href={r.sample_url} target="_blank" rel="noreferrer" className="truncate-1 block text-accent hover:underline">{r.sample_url}</a></div>
                    <div className="sm:col-span-3"><div className="text-[11px] uppercase tracking-wide text-t3">Last seen</div><div>{new Date(r.last_seen).toLocaleString()}</div></div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
