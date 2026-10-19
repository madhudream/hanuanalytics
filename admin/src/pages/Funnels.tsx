import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { FunnelChart } from "../components/charts/FunnelChart";
import { PeriodPicker } from "../components/PeriodPicker";
import { FilterChips } from "../components/FilterChips";
import { Button, Card, Empty, ErrorBox, PageHeader, Select, Skeleton } from "../components/ui";
import { I } from "../components/icons";
import { full } from "../lib/format";

export function Funnels() {
  const { id = "" } = useParams();
  const { query } = useStats();
  const [sp, setSp] = useSearchParams();
  const steps = useMemo(() => (sp.get("steps") ?? "$pageview,signup").split(",").filter(Boolean), [sp]);
  const windowDays = Number(sp.get("window") ?? 7);
  const [draft, setDraft] = useState<string[]>(steps);
  const [win, setWin] = useState(windowDays);
  const events = useQuery(() => api.events(id, { period: "90d" }, 200), [id]);
  const names = events.data?.rows.map((r) => r.event) ?? [];
  const funnel = useQuery(() => api.funnel(id, query, steps, windowDays), [id, JSON.stringify(query), steps.join(","), windowDays], { enabled: steps.length >= 2 });

  const apply = () => {
    const n = new URLSearchParams(sp);
    n.set("steps", draft.filter(Boolean).join(","));
    n.set("window", String(win));
    setSp(n);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Funnels" subtitle="How many people who did the first step went on to do the next, in order." actions={<PeriodPicker compare={false} />} />
      <FilterChips />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Steps">
          <ol className="flex flex-col gap-2">
            {draft.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="num w-5 text-[12px] text-t3">{i + 1}.</span>
                <Select value={s} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Step ${i + 1}`}>
                  {!names.includes(s) && s && <option value={s}>{s}</option>}
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
                <button className="btn btn-ghost btn-sm" aria-label="Remove step" disabled={draft.length <= 2} onClick={() => setDraft(draft.filter((_, j) => j !== i))}><I.close width={14} height={14} /></button>
              </li>
            ))}
          </ol>
          <Button size="sm" className="mt-2" onClick={() => setDraft([...draft, names[0] ?? "$pageview"])} disabled={draft.length >= 8}><I.plus width={14} height={14} />Add step</Button>
          <div className="mt-4">
            <label className="label">Conversion window</label>
            <Select value={win} onChange={(e) => setWin(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
            </Select>
          </div>
          <Button variant="primary" className="mt-4 w-full justify-center" onClick={apply}>Run funnel</Button>
        </Card>
        <Card title={`Conversion · ${windowDays}-day window`} className={funnel.refetching ? "fade-refetch" : ""}>
          {funnel.error ? <ErrorBox error={funnel.error} retry={funnel.refetch} /> : funnel.loading ? <Skeleton className="h-[300px]" /> : !funnel.data ? <Empty title="Add at least two steps" /> : (
            <>
              <FunnelChart steps={funnel.data.steps} />
              {funnel.data.steps.length >= 2 && (
                <div className="mt-5 flex flex-wrap gap-6 border-t hairline pt-4 text-[13px]">
                  <div><div className="text-[11.5px] uppercase tracking-wide text-t3">Overall conversion</div><div className="num text-[22px] font-semibold">{funnel.data.steps[funnel.data.steps.length - 1]!.pct.toFixed(1)}%</div></div>
                  <div><div className="text-[11.5px] uppercase tracking-wide text-t3">Entered</div><div className="num text-[22px] font-semibold">{full(funnel.data.steps[0]!.count)}</div></div>
                  <div><div className="text-[11.5px] uppercase tracking-wide text-t3">Completed</div><div className="num text-[22px] font-semibold">{full(funnel.data.steps[funnel.data.steps.length - 1]!.count)}</div></div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
