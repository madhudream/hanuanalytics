import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type Org, type Project } from "../api";

interface AuthState {
  loading: boolean;
  me: Me | null;
  needsSetup: boolean;
  signupOpen: boolean;
  google: boolean;
  refresh: () => Promise<void>;
  setMe: (me: Me | null) => void;
  orgOf: (project: Project) => Org | undefined;
}

const Ctx = createContext<AuthState>({ loading: true, me: null, needsSetup: false, signupOpen: false, google: false, refresh: async () => {}, setMe: () => {}, orgOf: () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [google, setGoogle] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.setupStatus();
      setNeedsSetup(s.needs_setup);
      setSignupOpen(!!s.signup_open);
      setGoogle(!!s.google);
      if (s.needs_setup) {
        setMe(null);
        return;
      }
      setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else if (!(e instanceof ApiError)) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ loading, me, needsSetup, signupOpen, google, refresh, setMe, orgOf: (p) => me?.orgs.find((o) => o.id === p.org_id) }),
    [loading, me, needsSetup, signupOpen, google, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
