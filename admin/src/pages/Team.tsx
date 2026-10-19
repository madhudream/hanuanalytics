import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { api, type Invite, type Role } from "../api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { useQuery } from "../state/query";
import { Button, Card, CopyButton, Empty, ErrorBox, Field, Input, PageHeader, Select, Skeleton } from "../components/ui";
import { fmtDate } from "../lib/format";
import { I } from "../components/icons";

export function Team() {
  const { org = "" } = useParams();
  const { me, refresh } = useAuth();
  const { toast } = useToast();
  const o = me?.orgs.find((x) => x.id === org);
  const canManage = o?.role === "owner" || o?.role === "admin";
  const { data, loading, error, refetch } = useQuery(() => api.members(org), [org]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [created, setCreated] = useState<Invite | null>(null);
  const [name, setName] = useState(o?.name ?? "");
  const [busy, setBusy] = useState(false);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.invite(org, email, role);
      setCreated(r.invite);
      setEmail("");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Invite failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Team" subtitle={o?.name} />
      {error && <ErrorBox error={error} retry={refetch} />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <Card title="Members" pad={false}>
            {loading ? <div className="p-4"><Skeleton className="h-32" /></div> : (
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-t3"><th className="px-4 py-2 font-medium">Member</th><th className="px-2 py-2 font-medium">Role</th><th className="hidden px-2 py-2 font-medium sm:table-cell">Joined</th><th /></tr></thead>
                <tbody>
                  {data?.members.map((m) => (
                    <tr key={m.user_id} className="border-t hairline">
                      <td className="px-4 py-2"><div className="font-medium">{m.name}{m.user_id === me?.user.id && <span className="ml-1.5 text-[11px] text-t3">(you)</span>}</div><div className="text-[12px] text-t3">{m.email}</div></td>
                      <td className="px-2 py-2">
                        {canManage && m.user_id !== me?.user.id ? (
                          <Select value={m.role} onChange={async (e) => { try { await api.setRole(org, m.user_id, e.target.value as Role); toast("Role updated", "success"); refetch(); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } }} className="!w-auto !py-1 !text-[12.5px]" aria-label={`Role for ${m.name}`}>
                            <option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option>
                          </Select>
                        ) : <span className="capitalize text-t2">{m.role}</span>}
                      </td>
                      <td className="hidden px-2 py-2 text-t2 sm:table-cell">{fmtDate(m.joined_at, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="px-2 py-2 text-right">{canManage && m.user_id !== me?.user.id && <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={async () => { if (!confirm(`Remove ${m.name} from ${o?.name}?`)) return; try { await api.removeMember(org, m.user_id); refetch(); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } }}><I.trash width={14} height={14} /></Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Pending invites" pad={false}>
            {loading ? <div className="p-4"><Skeleton className="h-16" /></div> : !data?.invites.length ? <Empty title="No pending invites" /> : (
              <ul>
                {data.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-t hairline px-4 py-2.5 text-[13px]">
                    <div><div className="font-medium">{i.email} <span className="ml-1 rounded bg-s2 px-1.5 py-0.5 text-[11px] capitalize text-t2">{i.role}</span></div><div className="text-[12px] text-t3">Expires {fmtDate(i.expires_at)}</div></div>
                    <div className="flex gap-2"><CopyButton text={i.url} label="Copy link" />{canManage && <Button size="sm" variant="ghost" onClick={async () => { await api.revokeInvite(org, i.id); refetch(); }}>Revoke</Button>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Invite someone">
            {canManage ? (
              <form onSubmit={invite} className="flex flex-col gap-3">
                <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Role" hint="Members can view everything; admins also manage projects; owners also manage billing-level settings and the team.">
                  <Select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></Select>
                </Field>
                <Button type="submit" variant="primary" disabled={busy} className="justify-center">Create invite link</Button>
                {created && (
                  <div className="rounded-lg border hairline bg-s2 p-3 text-[12.5px]">
                    <div className="mb-1 font-medium">Share this link with {created.email}</div>
                    <div className="truncate-1 font-mono text-[12px] text-t2">{created.url}</div>
                    <div className="mt-2"><CopyButton text={created.url} label="Copy invite link" /></div>
                    <div className="mt-2 text-t3">No email is sent; the link works once and expires in 7 days.</div>
                  </div>
                )}
              </form>
            ) : <p className="text-[13px] text-t2">Ask an owner or admin to invite people.</p>}
          </Card>
          {o?.role === "owner" && (
            <Card title="Organization">
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button className="mt-3" disabled={name === o.name || !name.trim()} onClick={async () => { try { await api.renameOrg(org, name.trim()); await refresh(); toast("Renamed", "success"); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); } }}>Rename</Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
