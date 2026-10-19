import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useQuery } from "../state/query";
import { Card, Empty, ErrorBox, Input, PageHeader, Pagination, Skeleton, Stat } from "../components/ui";
import { fmtDateTime, timeAgo } from "../lib/format";
import { I } from "../components/icons";
import { SessionRow } from "../components/SessionRow";

export function Persons() {
  const { id = "" } = useParams();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, loading, refetching, error, refetch } = useQuery(() => api.persons(id, q, limit, offset), [id, q, offset]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Persons" subtitle="Identified users and anonymous visitors, newest activity first." />
      <div className="relative max-w-md">
        <I.search width={15} height={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search by id, email or property" className="!pl-9" aria-label="Search persons" />
      </div>
      {error && <ErrorBox error={error} retry={refetch} />}
      <Card pad={false} className={refetching ? "fade-refetch" : ""}>
        {loading ? <div className="p-4"><Skeleton className="h-80" /></div> : !data?.rows.length ? <Empty icon={<I.persons width={28} height={28} />} title="No one yet" body="Persons appear with the first event; call hanu.identify() to attach an id and properties." /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-t3"><th className="px-4 py-2 font-medium">Person</th><th className="hidden px-2 py-2 font-medium md:table-cell">Properties</th><th className="num px-2 py-2 text-right font-medium">Sessions</th><th className="px-2 py-2 text-right font-medium">Last seen</th></tr></thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.distinct_id} className="border-t hairline hover:bg-s2/60">
                  <td className="px-4 py-2"><Link to={`/p/${id}/persons/${encodeURIComponent(p.distinct_id)}`} className="flex items-center gap-2 hover:text-accent"><span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${p.is_identified ? "bg-accent-soft text-accent" : "bg-s2 text-t3"}`}>{(p.distinct_id[0] ?? "?").toUpperCase()}</span><span className="truncate-1 max-w-[260px]">{p.distinct_id}</span></Link></td>
                  <td className="hidden max-w-[320px] truncate-1 px-2 py-2 text-[12px] text-t3 md:table-cell">{Object.entries(p.props).filter(([k]) => !k.startsWith("$")).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</td>
                  <td className="num px-2 py-2 text-right">{p.sessions}</td>
                  <td className="num whitespace-nowrap px-2 py-2 text-right text-t2" title={fmtDateTime(p.last_seen)}>{timeAgo(p.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pagination offset={offset} limit={limit} total={data.total} onChange={setOffset} />}
      </Card>
    </div>
  );
}

export function PersonPage() {
  const { id = "", did = "" } = useParams();
  const { data, loading, error, refetch } = useQuery(() => api.person(id, did), [id, did]);
  const p = data?.person;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={<span className="flex items-center gap-2"><Link to={`/p/${id}/persons`} className="btn btn-ghost btn-sm -ml-2"><I.chevron width={16} height={16} className="rotate-90" /></Link><span className="truncate-1 max-w-[60vw]">{did}</span></span>} subtitle={p ? (p.is_identified ? "Identified user" : "Anonymous visitor") : undefined} />
      {error && <ErrorBox error={error} retry={refetch} />}
      {loading || !p ? <Skeleton className="h-40" /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <Card title="Overview">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Sessions">{p.sessions}</Stat>
                <Stat label="First seen">{fmtDateTime(p.first_seen)}</Stat>
                <Stat label="Last seen">{fmtDateTime(p.last_seen)}</Stat>
              </div>
            </Card>
            <Card title="Properties">
              {Object.keys(p.props).length ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                  {Object.entries(p.props).map(([k, v]) => <><dt key={k + "k"} className="font-mono text-t3">{k}</dt><dd key={k + "v"} className="truncate-1 text-t1">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></>)}
                </dl>
              ) : <div className="text-[12.5px] text-t3">No properties. Use hanu.identify(id, {"{...}"}) or hanu.setPersonProps().</div>}
            </Card>
          </div>
          <Card title={`Sessions (${data.sessions.length})`} pad={false}>
            {data.sessions.length ? data.sessions.map((s) => <SessionRow key={s.id} projectId={id} s={s} showPerson={false} />) : <Empty title="No sessions in the last 90 days" />}
          </Card>
        </div>
      )}
    </div>
  );
}
