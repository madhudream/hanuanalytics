import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";

export function Account() {
  const { me, refresh } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(me?.user.name ?? "");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"name" | "password" | null>(null);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("name");
    try {
      await api.updateMe({ name: name.trim() });
      await refresh();
      toast("Name updated", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setBusy(null);
    }
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast("The new passwords do not match", "error");
      return;
    }
    setBusy("password");
    try {
      await api.updateMe({ password, current_password: current });
      setCurrent("");
      setPassword("");
      setConfirm("");
      toast("Password changed", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change the password", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Account" subtitle={me?.user.email} />
      <div className="flex flex-col gap-4">
        <Card title="Profile">
          <form onSubmit={saveName} className="flex flex-col gap-4">
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email" hint="Email changes are not supported yet."><Input value={me?.user.email ?? ""} disabled /></Field>
            <div><Button type="submit" variant="primary" disabled={busy !== null || name.trim() === me?.user.name || !name.trim()}>Save name</Button></div>
          </form>
        </Card>
        <Card title="Change password">
          <form onSubmit={savePassword} className="flex flex-col gap-4">
            <Field label="Current password"><Input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="New password" hint="At least 8 characters."><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Confirm new password"><Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <div><Button type="submit" variant="primary" disabled={busy !== null || !current || !password}>Change password</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}
