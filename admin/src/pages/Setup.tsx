import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type Project } from "../api";
import { useAuth } from "../state/auth";
import { AuthShell } from "./Auth";
import { Button, Field, Input } from "../components/ui";
import { DomainsEditor } from "../components/DomainsEditor";
import { Snippet } from "../components/Snippet";
import { I } from "../components/icons";

export function Setup() {
  const nav = useNavigate();
  const { refresh, needsSetup, loading } = useAuth();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!loading && !needsSetup && step < 3) nav("/login", { replace: true });
  }, [loading, needsSetup, nav, step]);

  useEffect(() => {
    if (!project || seen) return;
    const h = setInterval(async () => {
      try {
        const o = await api.overview(project.id, { period: "today" });
        if (o.totals.events > 0) setSeen(true);
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(h);
  }, [project, seen]);

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await api.setup({ email, password, name, org_name: orgName, project_name: projectName, domains });
      setProject(res.project);
      await refresh();
      setStep(3);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  const Steps = (
    <ol className="mb-5 flex items-center gap-2 text-[12px] text-t3">
      {["Account", "Organization & project", "Install"].map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${step > i + 1 ? "bg-good text-white" : step === i + 1 ? "bg-accent text-accent-ink" : "bg-s2 text-t3"}`}>{step > i + 1 ? <I.check width={12} height={12} strokeWidth={3} /> : i + 1}</span>
          <span className={step === i + 1 ? "font-medium text-t1" : ""}>{s}</span>
          {i < 2 && <span className="mx-1 h-px w-5 bg-line" />}
        </li>
      ))}
    </ol>
  );

  if (step === 1)
    return (
      <AuthShell title="Set up HanuAnalytics" subtitle="Create the first admin account. This only happens once.">
        {Steps}
        <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="flex flex-col gap-3.5">
          <Field label="Your name"><Input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" hint="At least 8 characters."><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="mt-1 justify-center">Continue</Button>
        </form>
      </AuthShell>
    );

  if (step === 2)
    return (
      <AuthShell title="Your organization and first site" subtitle="Events are only accepted from the domains you list.">
        {Steps}
        <form onSubmit={finish} className="flex flex-col gap-3.5">
          <Field label="Organization name"><Input required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Inc" autoFocus /></Field>
          <Field label="Project name"><Input required value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="acme.com" /></Field>
          <Field label="Allowed domains" hint="One per entry. example.com also matches www.example.com; *.example.com matches every subdomain. Add localhost for development.">
            <DomainsEditor value={domains} onChange={setDomains} />
          </Field>
          {err && <div className="rounded-lg bg-critical/10 px-3 py-2 text-[13px] text-critical">{err}</div>}
          <div className="mt-1 flex gap-2">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button type="submit" variant="primary" disabled={busy || !domains.length} className="flex-1 justify-center">{busy ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </AuthShell>
    );

  return (
    <AuthShell title="Install the snippet" subtitle="Add this to your site and we will wait here for the first event.">
      {Steps}
      {project && (
        <div className="flex flex-col gap-4">
          <Snippet publicKey={project.public_key} />
          <div className="text-[12.5px] text-t2">Public key: <code className="font-mono text-t1">{project.public_key}</code></div>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${seen ? "bg-good/10 text-t1" : "bg-s2 text-t2"}`}>
            {seen ? <I.check width={16} height={16} className="text-good" strokeWidth={2.5} /> : <span className="pulse h-2 w-2 rounded-full bg-accent" />}
            {seen ? "First event received. You're live!" : "Waiting for the first event…"}
          </div>
          <Button variant="primary" className="justify-center" onClick={() => nav(`/p/${project.id}`)}>{seen ? "Open dashboard" : "Skip, open dashboard"}</Button>
        </div>
      )}
    </AuthShell>
  );
}
