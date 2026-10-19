import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { DomainsEditor } from "../components/DomainsEditor";

export function NewProject() {
  const { org = "" } = useParams();
  const nav = useNavigate();
  const { refresh, me } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const o = me?.orgs.find((x) => x.id === org);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.createProject(org, { name, domains, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await refresh();
      nav(`/p/${p.id}/settings?tab=snippet`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create project", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New project" subtitle={o ? `in ${o.name}` : undefined} />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Project name"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="mysite.com" autoFocus /></Field>
          <Field label="Allowed domains" hint="Where the snippet will run. You can change this later."><DomainsEditor value={domains} onChange={setDomains} /></Field>
          <Button type="submit" variant="primary" disabled={busy || !domains.length || !name.trim()} className="justify-center">{busy ? "Creating…" : "Create project"}</Button>
        </form>
      </Card>
    </div>
  );
}

export function NewOrg() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New organization" subtitle="A separate team with its own projects and members." />
      <Card>
        <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const o = await api.createOrg(name.trim()); await refresh(); nav(`/org/${o.id}/new-project`); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); } }} className="flex flex-col gap-4">
          <Field label="Organization name"><Input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()} className="justify-center">Create organization</Button>
        </form>
      </Card>
    </div>
  );
}
