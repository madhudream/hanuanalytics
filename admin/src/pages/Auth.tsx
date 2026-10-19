import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Wordmark } from "../components/Logo";
import { Button, Field, Input } from "../components/ui";
import { ThemeToggle } from "../components/Layout";

export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-3 top-3"><ThemeToggle /></div>
      <div className="mb-6"><Wordmark size={40} /></div>
      <div className="card w-full max-w-[420px] p-6">
        <h1 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-t2">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const { refresh, needsSetup, signupOpen } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (needsSetup) nav("/setup", { replace: true });
  }, [needsSetup, nav]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(email, password);
      await refresh();
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your analytics.">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <div className="rounded-lg bg-critical/10 px-3 py-2 text-[13px] text-critical">{err}</div>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 justify-center">{busy ? "Signing in…" : "Sign in"}</Button>
        {signupOpen && <div className="text-center text-[12.5px] text-t3">New here? <Link to="/register" className="text-t1 underline">Create an account</Link></div>}
      </form>
    </AuthShell>
  );
}

export function Register() {
  const nav = useNavigate();
  const { refresh, signupOpen, loading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.register({ email, password, name, org_name: orgName });
      await refresh();
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? (e.status === 403 ? "Sign-up is by invitation on this instance. Ask an admin for an invite link." : e.message) : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };
  if (!loading && !signupOpen)
    return (
      <AuthShell title="Sign-up is by invitation" subtitle="This instance does not allow open registration. Ask an administrator for an invite link.">
        <Link to="/login" className="btn w-full justify-center">Back to sign in</Link>
      </AuthShell>
    );
  return (
    <AuthShell title="Create your account" subtitle="You will be the owner of a new organization.">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Your name"><Input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters."><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Organization name"><Input required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Inc" /></Field>
        {err && <div className="rounded-lg bg-critical/10 px-3 py-2 text-[13px] text-critical">{err}</div>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 justify-center">{busy ? "Creating…" : "Create account"}</Button>
        <div className="text-center text-[12.5px] text-t3">Already have an account? <Link to="/login" className="text-t1 underline">Sign in</Link></div>
      </form>
    </AuthShell>
  );
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [info, setInfo] = useState<{ org_name: string; email: string; invited_by: string } | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.inviteInfo(token).then(setInfo).catch((e: unknown) => setErr(e instanceof Error ? e.message : "Invalid invite"));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.acceptInvite(token, name, password);
      await refresh();
      toast(`Welcome to ${info?.org_name}`, "success");
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not accept invite");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={info ? `Join ${info.org_name}` : "Invitation"} subtitle={info ? <>{info.invited_by} invited <strong>{info.email}</strong>. Create your account to join.</> : undefined}>
      {err && !info ? (
        <div className="text-[13px] text-critical">{err} <Link to="/login" className="ml-2 underline">Sign in</Link></div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <Field label="Your name"><Input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Password" hint="At least 8 characters."><Input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <div className="rounded-lg bg-critical/10 px-3 py-2 text-[13px] text-critical">{err}</div>}
          <Button type="submit" variant="primary" disabled={busy || !info} className="mt-1 justify-center">{busy ? "Joining…" : "Join organization"}</Button>
          <div className="text-center text-[12.5px] text-t3">Already have an account? <Link to="/login" className="text-t1 underline">Sign in</Link> and the invite will be applied.</div>
        </form>
      )}
    </AuthShell>
  );
}
