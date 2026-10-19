import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { useAuth } from "../state/auth";
import { api } from "../api";
import { Wordmark } from "./Logo";
import { I } from "./icons";
import { Button, Dropdown, MenuItem } from "./ui";
import { applyTheme, getTheme, isDark, type Theme } from "../lib/theme";
import { useQuery } from "../state/query";

export function ThemeToggle() {
  const [, force] = useState(0);
  const cur = getTheme();
  const set = (t: Theme) => {
    applyTheme(t);
    force((x) => x + 1);
  };
  const dark = isDark();
  return (
    <Dropdown align="right" button={<button className="btn btn-ghost btn-sm" aria-label="Theme">{dark ? <I.moon width={16} height={16} /> : <I.sun width={16} height={16} />}</button>}>
      {(close) => (
        <>
          {(["light", "dark", "system"] as Theme[]).map((t) => (
            <MenuItem key={t} selected={cur === t} onClick={() => { set(t); close(); }}><span className="capitalize">{t}</span></MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me, setMe } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const isAdmin = !!me?.is_instance_admin;
  const sys = useQuery(() => api.system(), [], { enabled: isAdmin, refreshMs: 60000 });
  const newRequests = sys.data?.requests_new ?? 0;

  const project = me?.projects.find((p) => p.id === id) ?? me?.projects[0];
  const org = me?.orgs.find((o) => o.id === project?.org_id) ?? me?.orgs[0];
  const pid = project?.id;

  const links = pid
    ? [
        { to: `/p/${pid}`, label: "Dashboard", icon: I.home, end: true },
        { to: `/p/${pid}/live`, label: "Live", icon: I.live },
        { to: `/p/${pid}/events`, label: "Events", icon: I.events },
        { to: `/p/${pid}/funnels`, label: "Funnels", icon: I.funnel },
        { to: `/p/${pid}/retention`, label: "Retention", icon: I.retention },
        { to: `/p/${pid}/errors`, label: "Errors", icon: I.errors },
        { to: `/p/${pid}/sessions`, label: "Sessions", icon: I.sessions },
        { to: `/p/${pid}/persons`, label: "Persons", icon: I.persons },
        { to: `/p/${pid}/sql`, label: "SQL", icon: I.sql },
        { to: `/p/${pid}/settings`, label: "Settings", icon: I.settings },
      ]
    : [];

  const sidebar = (
    <aside className={`${open ? "flex" : "hidden md:flex"} fixed inset-y-0 left-0 z-40 w-[236px] flex-col border-r hairline bg-s1 px-3 py-3 md:sticky md:top-0 md:h-screen`}>
      <div className="flex items-center justify-between px-2 py-1">
        <NavLink to="/"><Wordmark /></NavLink>
        <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><I.close /></button>
      </div>

      {me && (
        <div className="mt-4 flex flex-col gap-1.5">
          <Dropdown button={<button className="flex w-full items-center justify-between rounded-lg border hairline px-2.5 py-1.5 text-left hover:bg-s2"><span className="truncate-1"><span className="block text-[10.5px] uppercase tracking-wide text-t3">Organization</span><span className="block truncate-1 text-[13px] font-medium">{org?.name ?? "—"}</span></span><I.swap width={14} height={14} className="text-t3" /></button>}>
            {(close) => (
              <>
                {me.orgs.map((o) => (
                  <MenuItem key={o.id} selected={o.id === org?.id} onClick={() => { const p = me.projects.find((x) => x.org_id === o.id); nav(p ? `/p/${p.id}` : `/org/${o.id}/new-project`); close(); }}>{o.name}</MenuItem>
                ))}
                <div className="my-1 border-t hairline" />
                <MenuItem onClick={() => { nav("/org/new"); close(); }}><span className="flex items-center gap-1.5 text-t2"><I.plus width={14} height={14} />New organization</span></MenuItem>
              </>
            )}
          </Dropdown>
          <Dropdown button={<button className="flex w-full items-center justify-between rounded-lg border hairline px-2.5 py-1.5 text-left hover:bg-s2"><span className="truncate-1"><span className="block text-[10.5px] uppercase tracking-wide text-t3">Project</span><span className="block truncate-1 text-[13px] font-medium">{project?.name ?? "No project"}</span></span><I.chevron width={14} height={14} className="text-t3" /></button>}>
            {(close) => (
              <>
                {me.projects.filter((p) => p.org_id === org?.id).map((p) => (
                  <MenuItem key={p.id} selected={p.id === project?.id} onClick={() => { nav(`/p/${p.id}${loc.pathname.replace(/^\/p\/[^/]+/, "")}`); close(); }}>{p.name}</MenuItem>
                ))}
                <div className="my-1 border-t hairline" />
                {org && <MenuItem onClick={() => { nav(`/org/${org.id}/new-project`); close(); }}><span className="flex items-center gap-1.5 text-t2"><I.plus width={14} height={14} />New project</span></MenuItem>}
              </>
            )}
          </Dropdown>
        </div>
      )}

      <nav className="mt-4 flex flex-col gap-0.5" aria-label="Project">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="nav-link">
            <l.icon /> {l.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t hairline pt-3">
        {org && <NavLink to={`/org/${org.id}/team`} className="nav-link"><I.team /> Team</NavLink>}
        {isAdmin && (
          <NavLink to="/requests" className="nav-link">
            <I.persons /> Requests
            {newRequests > 0 && <span className="num ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink">{newRequests}</span>}
          </NavLink>
        )}
        <NavLink to="/system" className="nav-link"><I.system /> System</NavLink>
        <div className="mt-2 flex items-center justify-between px-2">
          <NavLink to="/account" className="min-w-0 rounded-lg px-1 py-0.5 hover:bg-s2" title="Account settings">
            <div className="truncate-1 text-[12.5px] font-medium">{me?.user.name}</div>
            <div className="truncate-1 text-[11.5px] text-t3">{me?.user.email}</div>
          </NavLink>
          <div className="flex items-center">
            <ThemeToggle />
            <button className="btn btn-ghost btn-sm" aria-label="Log out" title="Log out" onClick={async () => { await api.logout(); setMe(null); nav("/login"); }}><I.logout width={16} height={16} /></button>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-full">
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      {sidebar}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 border-b hairline bg-s1 px-3 py-2 md:hidden">
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Open menu"><I.menu /></Button>
          <Wordmark size={22} />
        </div>
        <main className="mx-auto w-full max-w-[1240px] px-4 py-5 md:px-7 md:py-6">{children}</main>
      </div>
    </div>
  );
}
