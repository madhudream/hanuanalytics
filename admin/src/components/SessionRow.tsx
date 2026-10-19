import { Link } from "react-router";
import type { Session } from "../api";
import { duration, fmtDateTime } from "../lib/format";
import { flag } from "../lib/countries";
import { I } from "./icons";

export function SessionRow({ projectId, s, showPerson = true }: { projectId: string; s: Session; showPerson?: boolean }) {
  const Dev = s.device === "mobile" ? I.mobile : s.device === "tablet" ? I.tablet : I.desktop;
  return (
    <Link to={`/p/${projectId}/sessions/${encodeURIComponent(s.session_id)}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t hairline px-4 py-2.5 text-[13px] hover:bg-s2/60 sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_auto]">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.has_recording ? "bg-accent-soft text-accent" : "bg-s2 text-t3"}`} title={s.has_recording ? "Has recording" : "No recording"}>
        {s.has_recording ? <I.play width={14} height={14} /> : <I.sessions width={15} height={15} />}
      </span>
      <span className="min-w-0">
        {showPerson && <span className="truncate-1 block font-medium text-t1">{s.distinct_id}</span>}
        <span className="truncate-1 block text-[12px] text-t2">{s.entry_path}{s.pageviews > 1 && <> → {s.exit_path}</>}</span>
      </span>
      <span className="hidden min-w-0 text-[12.5px] text-t2 sm:block">
        <span className="truncate-1 block">{flag(s.country)} {s.city ? `${s.city}, ` : ""}{s.country}</span>
        <span className="truncate-1 flex items-center gap-1"><Dev width={12} height={12} /> {s.browser} · {s.os}</span>
      </span>
      <span className="hidden text-[12.5px] text-t2 sm:block">
        <span className="num block">{duration(s.duration_s)} · {s.pageviews} page{s.pageviews === 1 ? "" : "s"}</span>
        {s.errors > 0 && <span className="text-critical">{s.errors} error{s.errors > 1 ? "s" : ""}</span>}
        {s.errors === 0 && <span className="text-t3">{s.clicks} click{s.clicks === 1 ? "" : "s"}</span>}
      </span>
      <span className="num whitespace-nowrap text-right text-[12px] text-t3">{fmtDateTime(s.start)}</span>
    </Link>
  );
}
