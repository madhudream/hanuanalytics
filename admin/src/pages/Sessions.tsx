import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { PeriodPicker } from "../components/PeriodPicker";
import { FilterChips } from "../components/FilterChips";
import { Card, Empty, ErrorBox, Input, PageHeader, Pagination, Skeleton, Toggle } from "../components/ui";
import { SessionRow } from "../components/SessionRow";
import { I } from "../components/icons";

export function Sessions() {
  const { id = "" } = useParams();
  const { query } = useStats();
  const [sp, setSp] = useSearchParams();
  const rec = sp.get("rec") === "1";
  const did = sp.get("did") ?? "";
  const country = sp.get("country") ?? "";
  const [offset, setOffset] = useState(0);
  const [personDraft, setPersonDraft] = useState(did);
  const limit = 50;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); setOffset(0); };
  const { data, loading, refetching, error, refetch } = useQuery(() => api.sessions(id, { ...query, has_recording: rec || undefined, distinct_id: did || undefined, country: country || undefined, limit, offset }), [id, JSON.stringify(query), rec, did, country, offset]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sessions" subtitle="Every visit, with a replay when recording was on." actions={<PeriodPicker compare={false} />} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-t2"><Toggle checked={rec} onChange={(v) => set("rec", v ? "1" : "")} label="Only with recording" />With recording</label>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); set("did", personDraft.trim()); }}>
          <Input value={personDraft} onChange={(e) => setPersonDraft(e.target.value)} placeholder="Person id or email" className="!w-[220px] !py-1.5" aria-label="Person" />
        </form>
        <Input value={country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} placeholder="Country (IN)" className="!w-[120px] !py-1.5 uppercase" aria-label="Country code" maxLength={2} />
        <FilterChips />
      </div>
      {error && <ErrorBox error={error} retry={refetch} />}
      <Card pad={false} className={refetching ? "fade-refetch" : ""}>
        <div className="flex items-center justify-between px-4 py-2 text-[12.5px] text-t2"><span>{data ? `${data.total} sessions` : ""}</span><span className="hidden text-[11.5px] uppercase tracking-wide text-t3 sm:block">Person · pages · location · device · duration</span></div>
        {loading ? <div className="p-4"><Skeleton className="h-80" /></div> : !data?.rows.length ? <Empty icon={<I.sessions width={28} height={28} />} title="No sessions" body={rec ? "No recorded sessions match. Recording may be off or sampled in Settings → Recording." : "No sessions match this range and filters."} /> : (
          <div>{data.rows.map((s) => <SessionRow key={s.id} projectId={id} s={s} />)}</div>
        )}
        {data && <Pagination offset={offset} limit={limit} total={data.total} onChange={setOffset} />}
      </Card>
    </div>
  );
}
