import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type SessionEvent } from "../api";
import { useQuery } from "../state/query";
import { Button, Card, Empty, ErrorBox, PageHeader, Skeleton, Stat } from "../components/ui";
import { duration, eventLabel, fmtDateTime, fmtTime, bytes } from "../lib/format";
import { flag } from "../lib/countries";
import { I } from "../components/icons";
import { useToast } from "../state/toast";

type Player = { addEventListener: (n: string, cb: (e: unknown) => void) => void; goto: (ms: number, play?: boolean) => void; pause: () => void; play: () => void; $destroy?: () => void; getReplayer?: () => { getCurrentTime: () => number } };

export function Replay() {
  const { id = "", sid = "" } = useParams();
  const { toast } = useToast();
  const detail = useQuery(() => api.session(id, sid), [id, sid]);
  const s = detail.data?.session;
  const [events, setEvents] = useState<unknown[] | null>(null);
  const [noRec, setNoRec] = useState(false);
  const [current, setCurrent] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [playerW, setPlayerW] = useState(960);

  useEffect(() => {
    if (!s) return;
    if (!s.has_recording) { setNoRec(true); return; }
    let on = true;
    api.recording(id, sid).then((e) => on && setEvents(e)).catch(() => on && setNoRec(true));
    return () => { on = false; };
  }, [id, sid, s]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => es[0] && setPlayerW(Math.floor(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!events || !holder.current) return;
    let destroyed = false;
    let inst: Player | null = null;
    (async () => {
      const mod = await import("rrweb-player");
      await import("rrweb-player/dist/style.css");
      if (destroyed || !holder.current) return;
      holder.current.innerHTML = "";
      const Ctor = (mod.default ?? mod) as unknown as new (o: { target: HTMLElement; props: Record<string, unknown> }) => Player;
      inst = new Ctor({ target: holder.current, props: { events, width: playerW, height: Math.round((playerW * 9) / 16), autoPlay: false, skipInactive: true, showController: true, speedOption: [1, 2, 4, 8], mouseTail: { strokeStyle: "#e85d04" } } });
      inst.addEventListener("ui-update-current-time", (e) => setCurrent(((e as { payload: number }).payload ?? 0) as number));
      player.current = inst;
    })().catch((e: unknown) => toast(e instanceof Error ? e.message : "Player failed to load", "error"));
    return () => { destroyed = true; try { inst?.pause(); inst?.$destroy?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, playerW]);

  const t0 = s ? new Date(s.start).getTime() : 0;
  const seek = (ev: SessionEvent) => {
    const ms = Math.max(0, new Date(ev.ts).getTime() - t0);
    player.current?.goto(ms, true);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to={`/p/${id}/sessions`} className="btn btn-ghost btn-sm -ml-2"><I.chevron width={16} height={16} className="rotate-90" /></Link>Session replay</span>}
        subtitle={s ? <>{s.distinct_id} · {fmtDateTime(s.start)}</> : undefined}
        actions={s && <Link to={`/p/${id}/persons/${encodeURIComponent(s.distinct_id)}`} className="btn"><I.persons width={15} height={15} />Person</Link>}
      />
      {detail.error && <ErrorBox error={detail.error} retry={detail.refetch} />}
      {s && (
        <Card pad={false}>
          <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Duration">{duration(s.duration_s)}</Stat>
            <Stat label="Pages">{s.pageviews}</Stat>
            <Stat label="Clicks">{s.clicks}</Stat>
            <Stat label="Errors"><span className={s.errors ? "text-critical" : ""}>{s.errors}</span></Stat>
            <Stat label="Location">{flag(s.country)} {s.city || s.country}</Stat>
            <Stat label="Device"><span className="capitalize">{s.device}</span></Stat>
            <Stat label="Browser">{s.browser} · {s.os}</Stat>
            <Stat label="Recording">{s.has_recording ? bytes(s.rec_bytes) : "—"}</Stat>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {noRec ? (
            <Card><Empty icon={<I.sessions width={28} height={28} />} title="No recording for this session" body="Recording was off, sampled out, or the session was shorter than the minimum duration. The event timeline on the right is still complete." /></Card>
          ) : (
            <div className="relative">
              {!events && <Skeleton className="aspect-video w-full" />}
              <div ref={holder} className="w-full" />
            </div>
          )}
        </div>
        <Card title="Timeline" pad={false} className="max-h-[70vh] overflow-hidden">
          <div className="overflow-y-auto">
            {detail.loading ? <div className="p-3"><Skeleton className="h-64" /></div> : (
              <ol>
                {detail.data?.events.map((ev, i) => {
                  const off = new Date(ev.ts).getTime() - t0;
                  const active = events && current >= off && (detail.data!.events[i + 1] ? current < new Date(detail.data!.events[i + 1]!.ts).getTime() - t0 : true);
                  const isErr = ev.event === "$exception";
                  return (
                    <li key={ev.ts + i} className={`border-t hairline ${active ? "bg-accent-soft/60" : ""}`}>
                      <button className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-s2/60" onClick={() => seek(ev)} disabled={!events}>
                        <span className="num w-[52px] flex-none text-t3">{events ? duration(off / 1000) : fmtTime(ev.ts)}</span>
                        <span className="min-w-0">
                          <span className={`block font-medium ${isErr ? "text-critical" : "text-t1"}`}>{eventLabel(ev.event)}{ev.event === "$autocapture" && typeof ev.props.$el_text === "string" && <span className="font-normal text-t2"> · “{ev.props.$el_text}”</span>}</span>
                          <span className="truncate-1 block text-t3">{isErr && typeof ev.props.$message === "string" ? ev.props.$message : ev.path}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>
      </div>
      {events && (
        <div className="flex items-center gap-2 text-[12px] text-t3">
          <Button size="sm" onClick={() => player.current?.goto(0, true)}><I.play width={12} height={12} />From start</Button>
          <span>Inputs are masked by the SDK before anything leaves the visitor's browser.</span>
        </div>
      )}
    </div>
  );
}
