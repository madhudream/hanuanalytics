import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, type Project, type ProjectPatch } from "../api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Toggle, CopyButton } from "../components/ui";
import { DomainsEditor } from "../components/DomainsEditor";
import { Snippet } from "../components/Snippet";
import { I } from "../components/icons";

const TABS = ["general", "domains", "snippet", "recording", "retention", "danger"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { general: "General", domains: "Domains", snippet: "Snippet & keys", recording: "Recording", retention: "Retention", danger: "Danger zone" };
const TZS = ["UTC", "Asia/Kolkata", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Singapore", "Asia/Dubai", "Asia/Tokyo", "Australia/Sydney", "America/Sao_Paulo"];

export function Settings() {
  const { id = "" } = useParams();
  const { me, refresh } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.includes(sp.get("tab") as Tab) ? sp.get("tab") : "general") as Tab;
  const original = me?.projects.find((p) => p.id === id);
  const [p, setP] = useState<Project | undefined>(original);
  const [busy, setBusy] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [del, setDel] = useState("");
  useEffect(() => setP(original), [original]);
  if (!p) return null;
  const org = me?.orgs.find((o) => o.id === p.org_id);
  const canDelete = org?.role === "owner" || org?.role === "admin";
  const dirty = JSON.stringify(p) !== JSON.stringify(original);

  const save = async (patch: ProjectPatch) => {
    setBusy(true);
    try {
      await api.updateProject(id, patch);
      await refresh();
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  };
  const up = (patch: Partial<Project>) => setP({ ...p, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" subtitle={p.name} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t} onClick={() => setSp({ tab: t })} className={`nav-link whitespace-nowrap ${t === "danger" ? "text-critical" : ""}`} aria-current={tab === t ? "page" : undefined}>{TAB_LABEL[t]}</button>
          ))}
        </nav>
        <div className="flex flex-col gap-4">
          {tab === "general" && (
            <Card title="General">
              <div className="flex max-w-md flex-col gap-4">
                <Field label="Project name"><Input value={p.name} onChange={(e) => up({ name: e.target.value })} /></Field>
                <Field label="Reporting timezone" hint="Days in the dashboard start at midnight in this timezone.">
                  <Select value={p.timezone} onChange={(e) => up({ timezone: e.target.value })}>{[p.timezone, ...TZS.filter((t) => t !== p.timezone)].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                </Field>
                <div className="flex items-center justify-between rounded-lg border hairline px-3 py-2.5">
                  <div><div className="text-[13px] font-medium">Cookieless mode</div><div className="text-[12px] text-t2">No ids stored in the browser; visitors are counted with a daily rotating hash. No consent banner needed.</div></div>
                  <Toggle checked={p.cookieless} onChange={(v) => up({ cookieless: v })} label="Cookieless" />
                </div>
                <div className="text-[13px] font-medium">Autocapture</div>
                {(Object.keys(p.autocapture) as (keyof Project["autocapture"])[]).map((k) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-[13px] capitalize">{k === "vitals" ? "Web vitals" : k === "errors" ? "JavaScript errors" : k === "scroll" ? "Scroll depth" : k}</span>
                    <Toggle checked={p.autocapture[k]} onChange={(v) => up({ autocapture: { ...p.autocapture, [k]: v } })} label={k} />
                  </div>
                ))}
                <div><Button variant="primary" disabled={!dirty || busy} onClick={() => save({ name: p.name, timezone: p.timezone, cookieless: p.cookieless, autocapture: p.autocapture })}>Save changes</Button></div>
              </div>
            </Card>
          )}
          {tab === "domains" && (
            <Card title="Allowed domains">
              <div className="flex max-w-lg flex-col gap-4">
                <p className="text-[13px] text-t2">Events are accepted only when the page's origin matches one of these. <code className="font-mono">example.com</code> also matches <code className="font-mono">www.example.com</code>; <code className="font-mono">*.example.com</code> matches any subdomain; add <code className="font-mono">localhost</code> for development.</p>
                <DomainsEditor value={p.domains} onChange={(domains) => up({ domains })} />
                <div className="flex items-center justify-between rounded-lg border hairline px-3 py-2.5">
                  <div><div className="text-[13px] font-medium">Allow requests without an Origin</div><div className="text-[12px] text-t2">For server-side or native apps that send no Origin header. Anyone with the public key could then send events.</div></div>
                  <Toggle checked={p.allow_no_origin} onChange={(v) => up({ allow_no_origin: v })} label="Allow no origin" />
                </div>
                <div><Button variant="primary" disabled={!dirty || busy || !p.domains.length} onClick={() => save({ domains: p.domains, allow_no_origin: p.allow_no_origin })}>Save changes</Button></div>
              </div>
            </Card>
          )}
          {tab === "snippet" && (
            <>
              <Card title="Install snippet"><Snippet publicKey={p.public_key} /></Card>
              <Card title="Keys">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border hairline px-3 py-2.5">
                    <div><div className="text-[12px] text-t2">Public key (safe to embed in pages)</div><code className="font-mono text-[13px]">{p.public_key}</code></div>
                    <div className="flex gap-2"><CopyButton text={p.public_key} /><Button size="sm" variant="danger" onClick={() => setRotate(true)}><I.refresh width={14} height={14} />Rotate</Button></div>
                  </div>
                  <p className="text-[12.5px] text-t3">Rotating the key invalidates the old one immediately: pages still using it stop sending events until the snippet is updated.</p>
                </div>
              </Card>
              <Card title="Advanced usage">
                <pre className="overflow-x-auto rounded-lg bg-s2 p-3 font-mono text-[12.5px] leading-relaxed">{`// after the snippet, anywhere on the page:
hanu.capture("signup", { plan: "pro" });
hanu.identify("user_42", { email: "a@b.c" });

// before the snippet loads, queue calls:
window.hanuq = window.hanuq || [];
hanuq.push(["capture", "cta_clicked"]);

// npm / ESM:
import { init } from "${location.origin}/hanu.esm.js";
init("${p.public_key}", { api_host: "${location.origin}" });`}</pre>
              </Card>
            </>
          )}
          {tab === "recording" && (
            <Card title="Session recording">
              <div className="flex max-w-lg flex-col gap-4">
                <div className="flex items-center justify-between"><div><div className="text-[13px] font-medium">Record sessions</div><div className="text-[12px] text-t2">rrweb recording, loaded lazily only when enabled.</div></div><Toggle checked={p.recording.enabled} onChange={(v) => up({ recording: { ...p.recording, enabled: v } })} label="Record sessions" /></div>
                <Field label={`Sample rate · ${Math.round(p.recording.sample_rate * 100)}% of sessions`} hint="Lower it on busy sites to cap storage. The decision is made once per session.">
                  <input type="range" min={0} max={1} step={0.05} value={p.recording.sample_rate} onChange={(e) => up({ recording: { ...p.recording, sample_rate: Number(e.target.value) } })} className="w-full accent-[var(--accent)]" aria-label="Sample rate" />
                </Field>
                <div className="flex items-center justify-between"><div><div className="text-[13px] font-medium">Mask all inputs</div><div className="text-[12px] text-t2">Typed text is replaced with asterisks in the visitor's browser.</div></div><Toggle checked={p.recording.mask_all_inputs} onChange={(v) => up({ recording: { ...p.recording, mask_all_inputs: v } })} label="Mask all inputs" /></div>
                <Field label="Mask text selector" hint="CSS selector whose text content is masked, e.g. .sensitive, [data-private]"><Input value={p.recording.mask_text_selector} onChange={(e) => up({ recording: { ...p.recording, mask_text_selector: e.target.value } })} placeholder=".private" className="font-mono" /></Field>
                <Field label="Block selector" hint="Elements matching this are not recorded at all (a gray box is shown)."><Input value={p.recording.block_selector} onChange={(e) => up({ recording: { ...p.recording, block_selector: e.target.value } })} placeholder=".no-record, iframe" className="font-mono" /></Field>
                <Field label="Minimum session duration (ms)" hint="Recordings shorter than this are discarded."><Input type="number" min={0} step={1000} value={p.recording.min_duration_ms} onChange={(e) => up({ recording: { ...p.recording, min_duration_ms: Number(e.target.value) } })} className="max-w-[160px]" /></Field>
                <div><Button variant="primary" disabled={!dirty || busy} onClick={() => save({ recording: p.recording })}>Save changes</Button></div>
              </div>
            </Card>
          )}
          {tab === "retention" && (
            <Card title="Data retention">
              <div className="flex max-w-lg flex-col gap-4">
                <Field label="Keep events for (days)" hint="Parquet files older than this are deleted from the bucket. 0 keeps everything."><Input type="number" min={0} value={p.retention_days} onChange={(e) => up({ retention_days: Number(e.target.value) })} className="max-w-[160px]" /></Field>
                <Field label="Keep recordings for (days)" hint="Recordings are the bulk of storage; 14–30 days is plenty for debugging."><Input type="number" min={0} value={p.recording_retention_days} onChange={(e) => up({ recording_retention_days: Number(e.target.value) })} className="max-w-[160px]" /></Field>
                <div><Button variant="primary" disabled={!dirty || busy} onClick={() => save({ retention_days: p.retention_days, recording_retention_days: p.recording_retention_days })}>Save changes</Button></div>
              </div>
            </Card>
          )}
          {tab === "danger" && (
            <Card title="Delete project">
              <div className="flex max-w-lg flex-col gap-3">
                <p className="text-[13px] text-t2">Deletes the project, its keys and every event and recording in the bucket. This cannot be undone.</p>
                {!canDelete && <p className="text-[12.5px] text-t3">Only organization owners and admins can delete a project.</p>}
                <Field label={<>Type <strong>{p.name}</strong> to confirm</> as unknown as string}><Input value={del} onChange={(e) => setDel(e.target.value)} disabled={!canDelete} /></Field>
                <div><Button variant="danger" disabled={del !== p.name || busy || !canDelete} onClick={async () => { setBusy(true); try { await api.deleteProject(id); await refresh(); toast("Project deleted"); nav("/"); } catch (e) { toast(e instanceof Error ? e.message : "Delete failed", "error"); } finally { setBusy(false); } }}><I.trash width={14} height={14} />Delete this project</Button></div>
              </div>
            </Card>
          )}
        </div>
      </div>
      <Modal open={rotate} onClose={() => setRotate(false)} title="Rotate public key?" width="max-w-md">
        <p className="text-[13px] text-t2">The current key stops working immediately. Update the snippet on <strong>{p.domains[0]}</strong> right after.</p>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setRotate(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await api.rotateKey(id); await refresh(); toast("Key rotated", "success"); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); } setRotate(false); }}>Rotate key</Button></div>
      </Modal>
    </div>
  );
}
