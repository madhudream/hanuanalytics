import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, type AccessRequest, type RequestStatus } from "../api";
import { useAuth } from "../state/auth";
import { useQuery } from "../state/query";
import { useToast } from "../state/toast";
import { Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Modal, PageHeader, Skeleton, Tabs } from "../components/ui";
import { fmtDateTime, timeAgo } from "../lib/format";
import { I } from "../components/icons";

type Tab = RequestStatus | "all";

function hostOf(website: string): string {
  try {
    return new URL(website.includes("://") ? website : `https://${website}`).host;
  } catch {
    return website;
  }
}

function mailto(r: AccessRequest): string {
  const subject = "Your HanuAnalytics account";
  const body = `Hi ${r.name.split(" ")[0] ?? r.name},\n\nYour HanuAnalytics access is approved. Create your account with this link (it works once):\n\n${r.invite_url}\n\nAfter signing in, add ${hostOf(r.website)} as a project and paste the snippet before </head>. Reply to this email if anything is unclear.\n\nWelcome aboard!`;
  return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function StatusChip({ s }: { s: RequestStatus }) {
  const cls = s === "new" ? "bg-accent-soft text-t1" : s === "approved" ? "bg-good/15 text-good" : "bg-s2 text-t2";
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium capitalize ${cls}`}>{s === "approved" && <I.check width={11} height={11} strokeWidth={3} />}{s}</span>;
}

export function Requests() {
  const { me } = useAuth();
  const { toast } = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = ((["new", "approved", "rejected", "all"] as Tab[]).includes(sp.get("status") as Tab) ? sp.get("status") : "new") as Tab;
  const setTab = (t: Tab) => setSp({ status: t });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = !!me?.is_instance_admin;
  const { data, loading, refetching, error, refetch } = useQuery(() => api.requests(tab), [tab], { enabled: isAdmin });
  const rows = data?.rows ?? [];

  const openApprove = (r: AccessRequest) => {
    setOrgName(hostOf(r.website) || r.name);
    setApproving(r);
  };
  const approve = async () => {
    if (!approving) return;
    setBusy(approving.id);
    try {
      await api.approveRequest(approving.id, orgName.trim() || undefined);
      toast(`Approved ${approving.email}. Copy the invite link and email it.`, "success");
      setApproving(null);
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Approve failed", "error");
    } finally {
      setBusy(null);
    }
  };
  const reject = async (r: AccessRequest) => {
    setBusy(r.id);
    try {
      await api.rejectRequest(r.id);
      toast(`Rejected ${r.email}`);
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reject failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) return <Empty title="Instance admins only" body="Access requests are handled by the administrator of this instance." />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Requests" subtitle="People who asked for an account on the home page. Approving creates an invite link you email them yourself." actions={<Tabs tabs={[{ value: "new", label: "New" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} value={tab} onChange={setTab} />} />
      {error && <ErrorBox error={error} retry={refetch} />}
      <Card pad={false} className={refetching ? "fade-refetch" : ""}>
        {loading ? <div className="p-4"><Skeleton className="h-48" /></div> : !rows.length ? (
          <Empty icon={<I.persons width={28} height={28} />} title="No requests yet" body="People ask for access on the home page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-t3">
                  <th className="px-4 py-2 font-medium">Who</th><th className="px-2 py-2 font-medium">Website</th><th className="px-2 py-2 font-medium">Message</th><th className="px-2 py-2 font-medium">Requested</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const long = r.message.length > 90;
                  const open = expanded === r.id;
                  return (
                    <tr key={r.id} className="border-t hairline align-top hover:bg-s2/40">
                      <td className="px-4 py-2.5"><div className="font-medium">{r.name}</div><a href={`mailto:${r.email}`} className="text-[12px] text-t2 hover:text-accent">{r.email}</a></td>
                      <td className="whitespace-nowrap px-2 py-2.5">{r.website ? <a href={r.website.includes("://") ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">{hostOf(r.website)}<I.external width={12} height={12} className="text-t3" /></a> : <span className="text-t3">—</span>}</td>
                      <td className="max-w-[360px] px-2 py-2.5 text-t2">
                        <span className={open ? "whitespace-pre-wrap" : "truncate-1 block"}>{open || !long ? r.message : r.message.slice(0, 90) + "…"}</span>
                        {long && <button className="mt-0.5 text-[12px] text-accent hover:underline" onClick={() => setExpanded(open ? null : r.id)}>{open ? "Show less" : "Show more"}</button>}
                        {r.status === "approved" && r.invite_url && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border hairline bg-s1 p-2">
                            <span className="truncate-1 max-w-[220px] font-mono text-[11.5px] text-t1" title={r.invite_url}>{r.invite_url}</span>
                            <CopyButton text={r.invite_url} label="Copy link" />
                            <a href={mailto(r)} className="btn btn-sm">Email invite</a>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-t2" title={fmtDateTime(r.created_at)}>{timeAgo(r.created_at)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5"><StatusChip s={r.status} />{r.decided_at && <div className="mt-0.5 text-[11px] text-t3">{timeAgo(r.decided_at)}</div>}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">
                        {r.status === "new" && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => openApprove(r)}>Approve</Button>
                            <Button size="sm" disabled={busy === r.id} onClick={() => reject(r)}>Reject</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={!!approving} onClose={() => setApproving(null)} title={approving ? `Approve ${approving.name}` : ""} width="max-w-md">
        {approving && (
          <form onSubmit={(e) => { e.preventDefault(); void approve(); }} className="flex flex-col gap-4">
            <p className="text-[13px] text-t2">This creates an organization and an invite link for <strong className="text-t1">{approving.email}</strong> as its owner. Nothing is emailed automatically — you copy the link afterwards.</p>
            <Field label="Organization name"><Input required value={orgName} onChange={(e) => setOrgName(e.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2"><Button onClick={() => setApproving(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy === approving.id || !orgName.trim()}>{busy === approving.id ? "Approving…" : "Approve"}</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
