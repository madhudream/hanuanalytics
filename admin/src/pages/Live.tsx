import { Link, useParams } from "react-router";
import { api } from "../api";
import { useQuery } from "../state/query";
import { Columns } from "../components/charts/Sparkline";
import { Card, PageHeader, Skeleton } from "../components/ui";
import { compact, eventLabel, fmtTime } from "../lib/format";
import { flag } from "../lib/countries";
import { I } from "../components/icons";

export function Live() {
  const { id = "" } = useParams();
  const { data, loading } = useQuery(() => api.live(id), [id], { refreshMs: 5000 });
  const pagesMax = Math.max(1, ...(data?.pages ?? []).map((p) => p.visitors));
  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-2"><span className="pulse h-2.5 w-2.5 rounded-full bg-good" />Live</span>} subtitle="Refreshes every 5 seconds." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card className="lg:col-span-2" pad={false}>
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-end">
            <div>
              <div className="text-[12.5px] font-medium text-t2">Visitors right now</div>
              {loading ? <Skeleton className="mt-1 h-12 w-24" /> : <div className="num text-[52px] font-semibold leading-none tracking-[-0.03em]">{data?.online ?? 0}</div>}
              <div className="mt-1 text-[12px] text-t3">active in the last 5 minutes</div>
            </div>
            <div>
              <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-t3">Visitors per minute · last 30 min</div>
              {loading ? <Skeleton className="h-16" /> : <Columns points={(data?.series ?? []).map((p) => ({ t: p.t, v: p.visitors }))} />}
            </div>
          </div>
        </Card>
        <Card title="Top pages right now" pad={false}>
          <ul className="flex flex-col gap-[3px] p-3">
            {(data?.pages ?? []).map((p) => (
              <li key={p.path} className="row-bar flex items-center justify-between gap-3 rounded-md px-2 py-[5px] text-[13px]" style={{ "--w": `${(p.visitors / pagesMax) * 100}%` } as React.CSSProperties}>
                <span className="truncate-1">{p.path}</span><span className="num">{p.visitors}</span>
              </li>
            ))}
            {!loading && !data?.pages.length && <li className="py-6 text-center text-[12.5px] text-t3">Nobody is on the site right now.</li>}
          </ul>
        </Card>
        <Card title="Event feed" className="lg:col-span-3" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-t3">
                  <th className="px-4 py-2 font-medium">Time</th><th className="px-2 py-2 font-medium">Event</th><th className="px-2 py-2 font-medium">Page</th><th className="px-2 py-2 font-medium">Location</th><th className="px-2 py-2 font-medium">Device</th><th className="px-2 py-2 font-medium">Person</th><th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((e, i) => (
                  <tr key={e.ts + i} className="border-t hairline hover:bg-s2/60">
                    <td className="num whitespace-nowrap px-4 py-1.5 text-t2">{fmtTime(e.ts)}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-md px-1.5 py-0.5 text-[12px] ${e.event.startsWith("$") ? "bg-s2 text-t2" : "bg-accent-soft text-t1"}`}>{eventLabel(e.event)}</span></td>
                    <td className="max-w-[260px] truncate-1 px-2 py-1.5">{e.path}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{flag(e.country)} {e.city || e.country}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-t2">{e.browser} · {e.device}</td>
                    <td className="max-w-[200px] truncate-1 px-2 py-1.5"><Link to={`/p/${id}/persons/${encodeURIComponent(e.distinct_id)}`} className="hover:text-accent">{e.distinct_id}</Link></td>
                    <td className="px-2 py-1.5 text-right"><Link to={`/p/${id}/sessions/${encodeURIComponent(e.session_id)}`} className="btn btn-ghost btn-sm" title="Open session"><I.play width={12} height={12} /></Link></td>
                  </tr>
                ))}
                {loading && Array.from({ length: 8 }, (_, i) => <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-4" /></td></tr>)}
              </tbody>
            </table>
          </div>
          {data && <div className="border-t hairline px-4 py-1.5 text-[11.5px] text-t3">{compact(data.events.length)} most recent events</div>}
        </Card>
      </div>
    </div>
  );
}
