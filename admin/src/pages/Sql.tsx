import { useState } from "react";
import { useParams } from "react-router";
import { api, type SqlResult } from "../api";
import { Button, Card, ErrorBox, PageHeader, Textarea } from "../components/ui";
import { I } from "../components/icons";

const EXAMPLES: { label: string; sql: string }[] = [
  { label: "Pageviews by page, last 7 days", sql: `SELECT path, count(*) AS views, count(DISTINCT visitor) AS visitors\nFROM events\nWHERE event = '$pageview' AND ts > now() - interval '7 days'\nGROUP BY path ORDER BY views DESC LIMIT 20` },
  { label: "Signups by plan (custom prop)", sql: `SELECT json_get_str(props, 'plan') AS plan, count(*) AS signups\nFROM events\nWHERE event = 'signup'\nGROUP BY 1 ORDER BY 2 DESC` },
  { label: "Daily unique visitors", sql: `SELECT date_trunc('day', ts) AS day, count(DISTINCT visitor) AS visitors\nFROM events\nWHERE ts > now() - interval '30 days'\nGROUP BY 1 ORDER BY 1` },
  { label: "Slowest pages by LCP p75", sql: `SELECT path, approx_percentile_cont(CAST(json_get_str(props, '$lcp') AS DOUBLE), 0.75) AS lcp_p75, count(*) AS samples\nFROM events\nWHERE event = '$web_vitals'\nGROUP BY path HAVING count(*) > 20 ORDER BY lcp_p75 DESC LIMIT 20` },
  { label: "Sessions with errors", sql: `SELECT session_id, distinct_id, min(ts) AS started, count(*) FILTER (WHERE event = '$exception') AS errors\nFROM events\nGROUP BY 1, 2 HAVING errors > 0 ORDER BY started DESC LIMIT 50` },
];

export function Sql() {
  const { id = "" } = useParams();
  const [sql, setSql] = useState(EXAMPLES[0]!.sql);
  const [res, setRes] = useState<SqlResult | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.sql(id, sql, 1000));
    } catch (e) {
      setErr(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  const csv = () => {
    if (!res) return;
    const esc = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [res.columns.map((c) => esc(c.name)).join(","), ...res.rows.map((r) => r.map(esc).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "query.csv";
    a.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="SQL" subtitle={<>Read-only SQL over this project's <code className="font-mono">events</code> table (Apache DataFusion). Custom props: <code className="font-mono">json_get_str(props, 'key')</code>.</>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card pad={false}>
          <Textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={9} className="!rounded-b-none !border-0 font-mono !text-[13px] leading-relaxed" aria-label="SQL" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void run(); } }} />
          <div className="flex items-center justify-between border-t hairline px-3 py-2">
            <span className="text-[12px] text-t3"><span className="kbd">⌘</span> + <span className="kbd">Enter</span> to run · results capped at 1,000 rows</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={csv} disabled={!res?.rows.length}><I.download width={14} height={14} />CSV</Button>
              <Button size="sm" variant="primary" onClick={run} disabled={busy}>{busy ? "Running…" : "Run"}</Button>
            </div>
          </div>
        </Card>
        <Card title="Examples" pad={false}>
          <ul className="p-1.5">
            {EXAMPLES.map((e) => <li key={e.label}><button className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-s2" onClick={() => setSql(e.sql)}>{e.label}</button></li>)}
          </ul>
          <div className="border-t hairline px-3 py-2 text-[12px] text-t3">Columns: ts, event, distinct_id, anon_id, session_id, visitor, url, host, path, title, referrer, referrer_domain, source, medium, campaign, term, content, country, region, city, browser, browser_version, os, os_version, device, screen_w, screen_h, viewport_w, viewport_h, language, timezone, is_new_visitor, is_session_start, duration_ms, scroll_depth, props, lib_version.</div>
        </Card>
      </div>
      {err && <ErrorBox error={err} />}
      {res && (
        <Card title={<span className="num">{res.rows.length} row{res.rows.length === 1 ? "" : "s"}{res.truncated ? " (truncated)" : ""} · {res.took_ms} ms</span>} pad={false}>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-s1"><tr>{res.columns.map((c) => <th key={c.name} className="whitespace-nowrap border-b hairline px-3 py-2 text-left font-medium text-t2">{c.name} <span className="font-normal text-t3">{c.type}</span></th>)}</tr></thead>
              <tbody>
                {res.rows.map((r, i) => <tr key={i} className="border-t hairline hover:bg-s2/60">{r.map((v, j) => <td key={j} className="num max-w-[360px] truncate-1 whitespace-nowrap px-3 py-1.5 font-mono">{v === null || v === undefined ? <span className="text-t3">null</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
