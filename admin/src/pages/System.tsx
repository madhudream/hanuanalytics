import { useState } from "react";
import { api, type SignupMode } from "../api";
import { useAuth } from "../state/auth";
import { useQuery } from "../state/query";
import { useToast } from "../state/toast";
import { Button, Card, ErrorBox, PageHeader, Skeleton, Stat } from "../components/ui";
import { duration, full, timeAgo } from "../lib/format";
import { I } from "../components/icons";

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${ok ? "text-good" : "text-critical"}`}><span className={`h-2 w-2 rounded-full ${ok ? "bg-good" : "bg-critical"}`} />{ok ? "Healthy" : "Problem"}</span>;
}

export function System() {
  const { toast } = useToast();
  const { me } = useAuth();
  const { data, loading, error, refetch } = useQuery(() => api.system(), [], { refreshMs: 15000 });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = !!me?.is_instance_admin;
  const setMode = async (mode: SignupMode) => {
    setSaving(true);
    try {
      await api.setSignupMode(mode);
      toast(mode === "open" ? "Anyone can now create an account" : "Sign-up is now invite-only", "success");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="System" subtitle={data ? `HanuAnalytics ${data.version} · up ${duration(data.uptime_s)}` : undefined} actions={<Button disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.compact(); toast(`Compacted ${r.merged_files} files in ${r.ms} ms`, "success"); refetch(); } catch (e) { toast(e instanceof Error ? e.message : "Compaction failed", "error"); } finally { setBusy(false); } }}><I.refresh width={14} height={14} />{busy ? "Compacting…" : "Compact now"}</Button>} />
      {error && <ErrorBox error={error} retry={refetch} />}
      {loading || !data ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card title="HanuDB" actions={<Dot ok={data.hanudb.ok} />}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="URL"><span className="font-mono text-[12.5px]">{data.hanudb.url}</span></Stat>
              {data.hanudb.status && Object.entries(data.hanudb.status).slice(0, 5).map(([k, v]) => <Stat key={k} label={k}>{typeof v === "number" ? full(v) : String(v)}</Stat>)}
            </div>
          </Card>
          <Card title="Object store" actions={<Dot ok={data.store.ok} />}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Backend"><span className="font-mono text-[12.5px]">{data.store.kind}</span></Stat>
              <Stat label="Event files">{full(data.files.events ?? 0)}</Stat>
              <Stat label="Recording files">{full(data.files.recordings ?? 0)}</Stat>
            </div>
          </Card>
          <Card title="Ingest buffer">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Pending events">{full(data.buffer.pending_events)}</Stat>
              <Stat label="Last flush">{data.buffer.last_flush_at ? timeAgo(data.buffer.last_flush_at) : "never"}</Stat>
              <Stat label="Events, last 30 min">{full(data.live?.events_30m ?? 0)}</Stat>
            </div>
          </Card>
          <Card title="GeoIP" actions={<Dot ok={data.geo.loaded} />}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Database">DB-IP City Lite</Stat>
              <Stat label="Build">{data.geo.build || "—"}</Stat>
            </div>
            <p className="mt-3 text-[12px] text-t3">IP geolocation by <a href="https://db-ip.com" className="underline" target="_blank" rel="noreferrer">DB-IP</a> (CC BY 4.0). IP addresses are never stored.</p>
          </Card>
          <Card title="Sign-up" actions={<span className="text-[12px] text-t3">{isAdmin ? "Instance admin" : "Read-only"}</span>}>
            <div className="flex flex-col gap-3">
              <div className="text-[12.5px] text-t2">Who can create an account on this instance{data.public_url ? <> at <span className="font-mono text-t1">{data.public_url}</span></> : null}.</div>
              <div role="radiogroup" aria-label="Sign-up mode" className="flex flex-col gap-2">
                {([["invite", "Invite only", "New people join through invite links from the Team page."], ["open", "Open", "Anyone who reaches the login page can register and gets their own organization."]] as const).map(([mode, label, help]) => (
                  <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${data.signup_mode === mode ? "border-accent bg-accent-soft/50" : "hairline"} ${!isAdmin ? "cursor-default opacity-80" : ""}`}>
                    <input type="radio" name="signup_mode" value={mode} className="mt-1 accent-[var(--accent)]" checked={data.signup_mode === mode} disabled={!isAdmin || saving} onChange={() => setMode(mode)} />
                    <span><span className="block text-[13px] font-medium">{label}</span><span className="block text-[12px] text-t2">{help}</span></span>
                  </label>
                ))}
              </div>
            </div>
          </Card>
          <Card title="How it stays cheap">
            <ul className="list-disc pl-4 text-[12.5px] text-t2">
              <li>Events are batched into Parquet files; one object write per flush, not per event.</li>
              <li>Hourly and daily compaction keeps the file count small so queries stay fast.</li>
              <li>Recordings are gzip chunks with their own retention.</li>
              <li>Metadata lives in HanuDB on the same free VM; the bucket is the only durable store.</li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
