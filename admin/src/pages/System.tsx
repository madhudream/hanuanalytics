import { useState } from "react";
import { api, type SignupMode } from "../api";
import { useAuth } from "../state/auth";
import { useQuery } from "../state/query";
import { useToast } from "../state/toast";
import { Button, Card, ErrorBox, Input, PageHeader, Skeleton, Stat } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { fmtDateTime } from "../lib/format";
import { duration, full, timeAgo } from "../lib/format";
import { I } from "../components/icons";

function AccountsSection() {
  const { data, loading, error, refetch } = useQuery(() => api.accounts(), []);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle) || r.orgs.some((o) => o.org_name.toLowerCase().includes(needle)));
  return (
    <Card title="Accounts" actions={<span className="text-[12px] text-t3">Instance admin</span>} pad={false}>
      {error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : loading || !data ? <div className="p-4"><Skeleton className="h-40" /></div> : (
        <>
          <div className="grid grid-cols-3 gap-1 border-b hairline p-2">
            <StatTile label="Users" value={full(data.totals.users)} />
            <StatTile label="Organizations" value={full(data.totals.orgs)} />
            <StatTile label="Projects" value={full(data.totals.projects)} />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="relative w-full max-w-xs">
              <I.search width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or organization" className="!py-1.5 !pl-8 !text-[13px]" aria-label="Search accounts" />
            </div>
            <span className="num text-[12px] text-t3">{rows.length} of {data.rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-t3">
                  <th className="px-4 py-2 font-medium">Account</th><th className="px-2 py-2 font-medium">Sign-in</th><th className="px-2 py-2 font-medium">Organizations</th><th className="px-2 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hairline align-top hover:bg-s2/40">
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2 font-medium">{r.name}{r.is_instance_admin && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-t1">Instance admin</span>}</div><div className="text-[12px] text-t2">{r.email}</div></td>
                    <td className="whitespace-nowrap px-2 py-2.5"><span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${r.sign_in === "google" ? "bg-s2 text-t1" : "bg-s2 text-t2"}`}>{r.sign_in === "google" ? "Google" : "Password"}</span></td>
                    <td className="px-2 py-2.5 text-t2">{r.orgs.length ? r.orgs.map((o) => <div key={o.org_id}><span className="text-t1">{o.org_name}</span> · <span className="capitalize">{o.role}</span> · {o.projects} project{o.projects === 1 ? "" : "s"}</div>) : <span className="text-t3">none</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-t2" title={fmtDateTime(r.created_at)}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-[12.5px] text-t3">No accounts match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

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
      {isAdmin && <AccountsSection />}
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
