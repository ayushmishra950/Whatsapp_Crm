import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, superToken, tokens } from './api';
import { unregisterPush } from './push';
import { resetSocket } from './socket';

export type Role = 'super_admin' | 'admin' | 'agent';
export type LeadStatus = { key: string; label: string; color?: string; stage?: string };
export type Session = {
  user: { _id: string; name: string; email: string; role: Role; tenantId: string | null };
  tenant: null | {
    _id: string;
    name: string;
    status: string;
    businessType: 'general' | 'coaching';
    logo: string;
    plan?: { _id: string; name: string; limits?: Record<string, number>; modules?: Record<string, boolean> };
    subscription?: { status: string; currentPeriodEnd?: string };
    subscriptionActive?: boolean;
    messagesUsed?: number;
    whatsappMode?: string;
    settings?: any;
  };
  impersonating: boolean;
  businessCount?: number;
};

type AuthValue = {
  session: Session | null;
  loading: boolean;
  /** bumps on every business switch / login: screens reload their data */
  epoch: number;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<Session | null>;
  switchBusiness: (userId: string) => Promise<void>;
  /** Super Admin: open a business as its admin (audited on the server), and come back */
  impersonate: (tenantId: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function loadSession(attempt = 0): Promise<Session | null> {
  if (!(await tokens.load())) return null;
  try {
    return await api<Session>('/auth/me');
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      await tokens.set(null);
      return null;
    }
    // Server unreachable / waking up: keep the token and retry
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return loadSession(attempt + 1);
    }
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);

  const logout = useCallback(async () => {
    await unregisterPush(); // this phone stops getting alerts for this login
    await tokens.set(null);
    await superToken.set(null);
    resetSocket();
    setSession(null);
    setEpoch((e) => e + 1);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    let alive = true;
    loadSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      alive = false;
      setUnauthorizedHandler(null);
    };
  }, [logout]);

  const refresh = useCallback(async () => {
    const s = await loadSession();
    setSession(s);
    return s;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<Session & { token: string }>('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
    await tokens.set(data.token);
    resetSocket();
    const { token: _t, ...s } = data;
    setSession(s);
    setEpoch((e) => e + 1);
  }, []);

  // Open another business of the same login: new token, fresh socket, every screen reloads
  const switchBusiness = useCallback(async (userId: string) => {
    const data = await api<Session & { token: string }>('/auth/switch', { method: 'POST', body: { userId } });
    await tokens.set(data.token);
    resetSocket();
    const { token: _t, ...s } = data;
    setSession(s);
    setEpoch((e) => e + 1);
  }, []);

  const impersonate = useCallback(async (tenantId: string) => {
    const data = await api<Session & { token: string }>(`/superadmin/tenants/${tenantId}/impersonate`, { method: 'POST' });
    await superToken.set(tokens.get());
    await tokens.set(data.token);
    resetSocket();
    const { token: _t, ...s } = data;
    setSession(s);
    setEpoch((e) => e + 1);
  }, []);

  const stopImpersonating = useCallback(async () => {
    const back = await superToken.get();
    await superToken.set(null);
    await tokens.set(back);
    resetSocket();
    setSession(await loadSession());
    setEpoch((e) => e + 1);
  }, []);

  const value = useMemo(
    () => ({ session, loading, epoch, login, logout, refresh, switchBusiness, impersonate, stopImpersonating }),
    [session, loading, epoch, login, logout, refresh, switchBusiness, impersonate, stopImpersonating]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The logged-in session (screens inside the app always have one) */
export function useSession() {
  return useAuth().session as Session;
}

export const useIsCoaching = () => useAuth().session?.tenant?.businessType === 'coaching';
export const useIsAdmin = () => useAuth().session?.user.role === 'admin';
