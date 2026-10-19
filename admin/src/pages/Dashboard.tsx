import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Interval } from "../api";
import { useAuth } from "../state/auth";
import { useStats } from "../state/stats";
import { useQuery } from "../state/query";
import { compact, delta, duration, full, isoDate } from "../lib/format";
import { periodRange } from "../lib/period";
import type { Period } from "../api";

function prevRange(period: Period, from?: string, to?: string): [string, string] {
  const [a, b] = periodRange(period, from, to);
  const len = b.getTime() - a.getTime();
  return [isoDate(new Date(a.getTime() - len)), isoDate(new Date(a.getTime() - 86400000))];
}
import { StatTile } from "../components/StatTile";
import { TrendChart } from "../components/charts/TrendChart";
import { BreakdownPanel } from "../components/BreakdownPanel";
import { PeriodPicker } from "../components/PeriodPicker";
import { FilterChips } from "../components/FilterChips";
import { Empty, ErrorBox, Select, Skeleton } from "../components/ui";
import { I } from "../components/icons";
import { Snippet } from "../components/Snippet";

type Metric = "visitors" | "pageviews" | "sessions";

export function Dashboard() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const { query } = useStats();
  const [metric, setMetric] = useState<Metric>("visitors");
  const [interval, setInterval] = useState<Interval>("auto");
  const project = me?.projects.find((p) => p.id === id);
  const { data, loading, refetching, error, refetch } = useQuery(() => api.overview(id, query, interval), [id, JSON.stringify(query), interval]);
  // The previous period's series: the same window shifted back, fetched as a custom range (the API returns prev totals only).
  const prevWindow = prevRange(query.period, query.from, query.to);
  const { data: prevData } = useQuery(
    () => api.overview(id, { ...query, period: "custom", from: prevWindow[0], to: prevWindow[1], compare: false }, data?.interval ?? interval),
    [id, JSON.stringify(query), data?.interval, interval],
    { enabled: !!query.compare && !!data },
  );
  const t = data?.totals;
  const p = data?.prev;
  const noData = !loading && !error && t && t.events === 0 && !(query.filters?.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{project?.name ?? "Dashboard"}</h1>
          <div className="text-[12.5px] text-t3">{project?.domains.join(" · ")}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/p/${id}/live`} className="btn"><span className="pulse h-2 w-2 rounded-full bg-good" /> Live</Link>
          <PeriodPicker />
        </div>
      </div>
      <FilterChips />

      {error && <ErrorBox error={error} retry={refetch} />}

      {noData ? (
        <div className="card">
          <Empty
            icon={<I.events width={28} height={28} />}
            title="No events yet"
            body={<>Install the snippet on <strong>{project?.domains[0] ?? "your site"}</strong> and this page fills up within seconds of the first visit.</>}
            action={project ? <div className="w-[min(90vw,560px)] text-left"><Snippet publicKey={project.public_key} /></div> : undefined}
          />
        </div>
      ) : (
        <section className={`card ${refetching ? "fade-refetch" : ""}`}>
          <div className="grid grid-cols-2 gap-1 border-b hairline p-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Unique visitors" value={t ? compact(t.visitors) : "—"} hint={t && full(t.visitors)} delta={t && delta(t.visitors, p?.visitors)} loading={loading} onClick={() => setMetric("visitors")} active={metric === "visitors"} />
            <StatTile label="Pageviews" value={t ? compact(t.pageviews) : "—"} hint={t && full(t.pageviews)} delta={t && delta(t.pageviews, p?.pageviews)} loading={loading} onClick={() => setMetric("pageviews")} active={metric === "pageviews"} />
            <StatTile label="Sessions" value={t ? compact(t.sessions) : "—"} hint={t && full(t.sessions)} delta={t && delta(t.sessions, p?.sessions)} loading={loading} onClick={() => setMetric("sessions")} active={metric === "sessions"} />
            <StatTile label="Views / session" value={t ? t.views_per_session.toFixed(2) : "—"} delta={t && delta(t.views_per_session, p?.views_per_session)} loading={loading} />
            <StatTile label="Bounce rate" value={t ? `${t.bounce_rate.toFixed(0)}%` : "—"} delta={t && delta(t.bounce_rate, p?.bounce_rate)} invert loading={loading} />
            <StatTile label="Avg. session" value={t ? duration(t.avg_duration_s) : "—"} delta={t && delta(t.avg_duration_s, p?.avg_duration_s)} loading={loading} />
          </div>
          <div className="flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-3 text-[12px] text-t2">
              <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--series-1)" }} />{metric}</span>
              {query.compare && <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--compare)" }} />previous period</span>}
            </div>
            <Select value={interval} onChange={(e) => setInterval(e.target.value as Interval)} className="!w-auto !py-1 !text-[12.5px]" aria-label="Interval">
              <option value="auto">Auto</option><option value="hour">Hourly</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
            </Select>
          </div>
          <div className="px-2 pb-2 pt-1">
            {loading ? <Skeleton className="m-2 h-[240px]" /> : data && <TrendChart series={data.series} prev={query.compare ? prevData?.series : undefined} metric={metric} interval={data.interval} />}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownPanel projectId={id} title="Pages" tabs={[{ value: "path", label: "Top pages" }, { value: "entry_path", label: "Entry" }, { value: "exit_path", label: "Exit" }]} />
        <BreakdownPanel projectId={id} title="Sources" tabs={[{ value: "referrer_domain", label: "Referrers" }, { value: "source", label: "Source" }, { value: "medium", label: "Medium" }, { value: "campaign", label: "Campaign" }]} />
        <BreakdownPanel projectId={id} title="Locations" tabs={[{ value: "country", label: "Countries" }, { value: "region", label: "Regions" }, { value: "city", label: "Cities" }]} />
        <BreakdownPanel projectId={id} title="Devices" tabs={[{ value: "browser", label: "Browser" }, { value: "os", label: "OS" }, { value: "device", label: "Device" }, { value: "screen", label: "Screen" }]} />
        <EventsPanel projectId={id} />
        <VitalsPanel projectId={id} />
      </div>
    </div>
  );
}

function EventsPanel({ projectId }: { projectId: string }) {
  const { query, addFilter } = useStats();
  const { data, loading, refetching } = useQuery(() => api.events(projectId, query, 8), [projectId, JSON.stringify(query)]);
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card flex min-h-[320px] flex-col">
      <div className="flex min-h-[46px] items-center justify-between border-b hairline px-4 py-2">
        <div className="text-[13.5px] font-semibold">Events</div>
        <Link to={`/p/${projectId}/events`} className="btn btn-ghost btn-sm text-t2">All events <I.chevronR width={14} height={14} /></Link>
      </div>
      <div className={`flex-1 p-3 ${refetching ? "fade-refetch" : ""}`}>
        <div className="mb-1 flex items-center justify-between px-2 text-[11.5px] font-medium uppercase tracking-wide text-t3"><span>Event</span><span className="flex gap-6"><span className="w-12 text-right">Count</span><span className="w-12 text-right">Visitors</span></span></div>
        {loading ? <Skeleton className="h-40" /> : (
          <ul className="flex flex-col gap-[3px]">
            {rows.map((r) => (
              <li key={r.event}>
                <button className="row-bar flex w-full items-center justify-between gap-3 rounded-md px-2 py-[5px] text-left text-[13px] hover:bg-s2/60" style={{ "--w": `${(r.count / max) * 100}%` } as React.CSSProperties} onClick={() => addFilter({ key: "event", op: "is", value: r.event })}>
                  <span className="truncate-1 font-mono text-[12.5px]">{r.event}</span>
                  <span className="num flex gap-6"><span className="w-12 text-right">{compact(r.count)}</span><span className="w-12 text-right text-t2">{compact(r.visitors)}</span></span>
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-2 py-6 text-center text-[12.5px] text-t3">No events in this range.</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

const VITAL_META: { key: "lcp" | "inp" | "cls" | "fcp" | "ttfb"; label: string; unit: string; good: number; poor: number }[] = [
  { key: "lcp", label: "LCP", unit: "ms", good: 2500, poor: 4000 },
  { key: "inp", label: "INP", unit: "ms", good: 200, poor: 500 },
  { key: "cls", label: "CLS", unit: "", good: 0.1, poor: 0.25 },
  { key: "fcp", label: "FCP", unit: "ms", good: 1800, poor: 3000 },
  { key: "ttfb", label: "TTFB", unit: "ms", good: 800, poor: 1800 },
];

function VitalsPanel({ projectId }: { projectId: string }) {
  const { query } = useStats();
  const { data, loading, refetching } = useQuery(() => api.vitals(projectId, query), [projectId, JSON.stringify(query)]);
  return (
    <section className="card flex min-h-[320px] flex-col">
      <div className="flex min-h-[46px] items-center justify-between border-b hairline px-4 py-2">
        <div className="text-[13.5px] font-semibold">Web vitals</div>
        <span className="text-[11.5px] text-t3">p75 · share of good / needs work / poor</span>
      </div>
      <div className={`flex-1 p-4 ${refetching ? "fade-refetch" : ""}`}>
        {loading || !data ? <Skeleton className="h-40" /> : (
          <ul className="flex flex-col gap-3">
            {VITAL_META.map((m) => {
              const v = data[m.key];
              const status = v.p75 <= m.good ? "good" : v.p75 <= m.poor ? "warning" : "critical";
              return (
                <li key={m.key} className="flex items-center gap-3">
                  <span className="w-12 text-[12.5px] font-medium text-t2">{m.label}</span>
                  <span className="num w-20 text-[13.5px] font-semibold text-t1">{m.unit === "ms" ? `${(v.p75 / 1000).toFixed(2)}s` : v.p75.toFixed(2)}</span>
                  <span className={`inline-flex items-center gap-1 text-[11.5px] ${status === "good" ? "text-good" : status === "warning" ? "text-serious" : "text-critical"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${status === "good" ? "bg-good" : status === "warning" ? "bg-warning" : "bg-critical"}`} />
                    {status === "good" ? "Good" : status === "warning" ? "Needs work" : "Poor"}
                  </span>
                  <div className="ml-auto flex h-2 w-[42%] overflow-hidden rounded-full bg-s2" role="img" aria-label={`${m.label}: ${v.good}% good, ${v.needs_improvement}% needs improvement, ${v.poor}% poor`} title={`${v.good}% good · ${v.needs_improvement}% needs work · ${v.poor}% poor (n=${v.n})`}>
                    <div style={{ width: `${v.good}%`, background: "var(--good)" }} />
                    <div style={{ width: `${v.needs_improvement}%`, background: "var(--warning)", marginLeft: 2 }} />
                    <div style={{ width: `${v.poor}%`, background: "var(--critical)", marginLeft: 2 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
