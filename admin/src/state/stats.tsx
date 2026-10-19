import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { Filter, Period, StatsQuery } from "../api";

interface StatsCtx {
  query: StatsQuery;
  setPeriod: (p: Period, from?: string, to?: string) => void;
  setCompare: (on: boolean) => void;
  addFilter: (f: Filter) => void;
  removeFilter: (i: number) => void;
  clearFilters: () => void;
}

const Ctx = createContext<StatsCtx | null>(null);
const VALID: Period[] = ["today", "yesterday", "7d", "30d", "90d", "12mo", "month", "all", "custom"];

/** The date range + filters live in the URL so views are shareable and the back button works. */
export function StatsProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const period = (VALID.includes(sp.get("period") as Period) ? sp.get("period") : "7d") as Period;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const compare = sp.get("compare") === "1";
  const filters = useMemo<Filter[]>(() => {
    try {
      const raw = sp.get("filters");
      return raw ? (JSON.parse(raw) as Filter[]) : [];
    } catch {
      return [];
    }
  }, [sp]);

  const update = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(sp);
      mut(next);
      setSp(next, { replace: false });
    },
    [sp, setSp],
  );

  const value = useMemo<StatsCtx>(
    () => ({
      query: { period, from, to, filters, compare },
      setPeriod: (p, f, t) =>
        update((n) => {
          n.set("period", p);
          if (p === "custom" && f && t) {
            n.set("from", f);
            n.set("to", t);
          } else {
            n.delete("from");
            n.delete("to");
          }
        }),
      setCompare: (on) => update((n) => (on ? n.set("compare", "1") : n.delete("compare"))),
      addFilter: (f) =>
        update((n) => {
          const cur = filters.filter((x) => !(x.key === f.key && x.op === f.op));
          n.set("filters", JSON.stringify([...cur, f]));
        }),
      removeFilter: (i) =>
        update((n) => {
          const cur = filters.filter((_, j) => j !== i);
          if (cur.length) n.set("filters", JSON.stringify(cur));
          else n.delete("filters");
        }),
      clearFilters: () => update((n) => n.delete("filters")),
    }),
    [period, from, to, filters, compare, update],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStats(): StatsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStats outside StatsProvider");
  return v;
}
