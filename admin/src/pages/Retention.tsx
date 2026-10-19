import { useParams } from "react-router";
import { api } from "../api";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { Card, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { compact, fmtDate } from "../lib/format";

function step(p: number): string {
  // ordinal ramp: never lighter than seq-200 so the smallest cell still clears the surface
  if (p >= 60) return "var(--seq-700)";
  if (p >= 40) return "var(--seq-600)";
  if (p >= 25) return "var(--seq-500)";
  if (p >= 15) return "var(--seq-400)";
  if (p >= 8) return "var(--seq-300)";
  return "var(--seq-200)";
}

export function Retention() {
  const { id = "" } = useParams();
  const { query } = useStats();
  const { data, loading, error, refetch } = useQuery(() => api.retention(id, query), [id]);
  const cohorts = data?.cohorts ?? [];
  const weeks = Math.max(0, ...cohorts.map((c) => c.weeks.length));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Retention" subtitle="Of the visitors first seen in a week, the share who came back in each following week." />
      <Card pad={false}>
        {error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : loading ? <div className="p-4"><Skeleton className="h-[320px]" /></div> : (
          <div className="overflow-x-auto p-4">
            <table className="w-full border-separate border-spacing-[3px] text-[12.5px]">
              <thead>
                <tr className="text-[11.5px] uppercase tracking-wide text-t3">
                  <th className="pr-2 text-left font-medium">Cohort</th>
                  <th className="num pr-3 text-right font-medium">Size</th>
                  {Array.from({ length: weeks }, (_, i) => <th key={i} className="num w-[52px] text-center font-medium">W{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <td className="whitespace-nowrap pr-2 text-t1">{fmtDate(c.start)} <span className="text-t3">· {c.cohort}</span></td>
                    <td className="num pr-3 text-right text-t2">{compact(c.size)}</td>
                    {Array.from({ length: weeks }, (_, i) => {
                      const v = c.weeks[i];
                      if (v === undefined) return <td key={i} />;
                      return (
                        <td key={i} className="num h-9 rounded-md text-center" style={{ background: step(v), color: v >= 25 ? "#fff" : "var(--text-1)" }} title={`${c.cohort} · week ${i}: ${v.toFixed(1)}% of ${c.size} returned`}>
                          {v.toFixed(0)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2 text-[11.5px] text-t3">
              <span>Lower</span>
              {["var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-700)"].map((c) => <span key={c} className="h-3 w-6 rounded-sm" style={{ background: c }} />)}
              <span>Higher retention</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
