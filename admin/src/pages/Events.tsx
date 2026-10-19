import { useState } from "react";
import { useParams } from "react-router";
import { api, type EventRow } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { PeriodPicker } from "../components/PeriodPicker";
import { FilterChips } from "../components/FilterChips";
import { Card, Empty, ErrorBox, PageHeader, Select, Skeleton } from "../components/ui";
import { compact, eventLabel, full } from "../lib/format";
import { SkeletonRows } from "../components/BreakdownPanel";

export function Events() {
  const { id = "" } = useParams();
  const { query } = useStats();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, refetching, error, refetch } = useQuery(() => api.events(id, query, 100), [id, JSON.stringify(query)]);
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  const sel = selected ?? rows[0]?.event ?? null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Events" subtitle="Everything the SDK captured, with a breakdown by any property." actions={<PeriodPicker compare={false} />} />
      <FilterChips />
      {error && <ErrorBox error={error} retry={refetch} />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Card title={`${rows.length} events`} pad={false} className={refetching ? "fade-refetch" : ""}>
          <div className="flex items-center justify-between px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-t3"><span>Event</span><span className="flex gap-4"><span className="w-14 text-right">Count</span><span className="w-14 text-right">Visitors</span><span className="w-14 text-right">Sessions</span></span></div>
          {loading ? <SkeletonRows n={10} /> : !rows.length ? <Empty title="No events" body="Nothing was captured in this range." /> : (
            <ul className="flex flex-col gap-[2px] px-2 pb-2">
              {rows.map((r: EventRow) => (
                <li key={r.event}>
                  <button onClick={() => setSelected(r.event)} aria-pressed={sel === r.event} className={`row-bar flex w-full items-center justify-between gap-3 rounded-md px-2 py-[6px] text-left text-[13px] hover:bg-s2/60 ${sel === r.event ? "ring-1 ring-accent/50" : ""}`} style={{ "--w": `${(r.count / max) * 100}%` } as React.CSSProperties}>
                    <span className="truncate-1"><span className="font-mono text-[12.5px]">{r.event}</span>{r.event.startsWith("$") && <span className="ml-2 text-[11.5px] text-t3">{eventLabel(r.event)}</span>}</span>
                    <span className="num flex gap-4"><span className="w-14 text-right">{compact(r.count)}</span><span className="w-14 text-right text-t2">{compact(r.visitors)}</span><span className="w-14 text-right text-t2">{compact(r.sessions)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {sel ? <PropBreakdown projectId={id} event={sel} /> : <Card><Empty title="Pick an event" body="Select an event on the left to break it down by property." /></Card>}
      </div>
    </div>
  );
}

function PropBreakdown({ projectId, event }: { projectId: string; event: string }) {
  const { query } = useStats();
  const [key, setKey] = useState<string>("");
  const keys = useQuery(() => api.eventKeys(projectId, query, event), [projectId, event, JSON.stringify(query)]);
  const k = key && keys.data?.keys.includes(key) ? key : keys.data?.keys[0] ?? "";
  const props = useQuery(() => api.eventProps(projectId, query, event, k, 30), [projectId, event, k, JSON.stringify(query)], { enabled: !!k });
  const rows = props.data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card
      title={<span className="font-mono text-[13px]">{event}</span>}
      actions={
        keys.data?.keys.length ? (
          <Select value={k} onChange={(e) => setKey(e.target.value)} className="!w-auto !py-1 !text-[12.5px]" aria-label="Property">
            {keys.data.keys.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        ) : null
      }
      pad={false}
      className={props.refetching ? "fade-refetch" : ""}
    >
      {keys.loading || props.loading ? <div className="p-3"><Skeleton className="h-48" /></div> : !keys.data?.keys.length ? <Empty title="No properties" body="This event was captured without custom properties." /> : (
        <>
          <div className="flex items-center justify-between px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-t3"><span>{k}</span><span className="flex gap-4"><span className="w-14 text-right">Count</span><span className="w-14 text-right">Visitors</span></span></div>
          <ul className="flex flex-col gap-[2px] px-2 pb-2">
            {rows.map((r) => (
              <li key={r.key} className="row-bar flex items-center justify-between gap-3 rounded-md px-2 py-[6px] text-[13px]" style={{ "--w": `${(r.count / max) * 100}%` } as React.CSSProperties} title={full(r.count)}>
                <span className="truncate-1">{r.key || <span className="text-t3">(empty)</span>}</span>
                <span className="num flex gap-4"><span className="w-14 text-right">{compact(r.count)}</span><span className="w-14 text-right text-t2">{compact(r.visitors)}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
