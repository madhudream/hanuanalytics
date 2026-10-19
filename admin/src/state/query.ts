import { useEffect, useRef, useState } from "react";

/**
 * Minimal data hook: keeps the previous result while refetching (the dataviz "refetch keeps the frame" rule),
 * exposes loading/refetching/error, and ignores stale responses.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { enabled?: boolean; refreshMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    setRefetching(true);
    fnRef
      .current()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (id !== seq.current) return;
        setLoading(false);
        setRefetching(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (!opts.refreshMs || !enabled) return;
    const h = setInterval(() => setTick((t) => t + 1), opts.refreshMs);
    return () => clearInterval(h);
  }, [opts.refreshMs, enabled]);

  return { data, error, loading: loading && data === undefined, refetching, refetch: () => setTick((t) => t + 1) };
}
