"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, tokens } from "./api";

const AuthContext = createContext(null);

async function loadSession(attempt = 0) {
  if (!tokens.get()) return null;
  try {
    return await api("/auth/me");
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      tokens.set(null);
      return null;
    }
    // Server unreachable / restarting: keep the token and retry instead of logging out
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return loadSession(attempt + 1);
    }
    return null;
  }
}

export const homeFor = (role) => (role === "super_admin" ? "/super-admin" : "/app");

// The last session of this login, so a page opens at once while /auth/me checks it in the background
const CACHE_KEY = "crm_session";
const tokenTag = () => (tokens.get() || "").slice(-24);
function readCachedSession() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return c && tokenTag() && c.tag === tokenTag() ? c.session : null;
  } catch {
    return null;
  }
}
function writeCachedSession(session) {
  try {
    if (session && tokens.get()) localStorage.setItem(CACHE_KEY, JSON.stringify({ tag: tokenTag(), session }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // private mode: just no instant start
  }
}

export function AuthProvider({ children }) {
  const router = useRouter();
  const [session, setSessionState] = useState(null); // { user, tenant, impersonating }
  const [loading, setLoading] = useState(true);
  const setSession = useCallback((data) => {
    writeCachedSession(data);
    setSessionState(data);
  }, []);

  const refresh = useCallback(async () => {
    const data = await loadSession();
    setSession(data);
    setLoading(false);
    return data;
  }, [setSession]);

  useEffect(() => {
    let active = true;
    // Show the page straight away with the remembered session; the check below corrects it (or logs out)
    const cached = readCachedSession();
    if (cached) {
      setSessionState(cached); // eslint-disable-line react-hooks/set-state-in-effect -- one-time start from browser storage
      setLoading(false);
    }
    loadSession().then((data) => {
      if (!active) return;
      setSession(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [setSession]);

  const login = async (email, password) => {
    const data = await api("/auth/login", { method: "POST", body: { email, password } });
    tokens.set(data.token);
    tokens.setSuper(null);
    setSession(data);
    router.replace(homeFor(data.user.role));
  };

  const logout = () => {
    tokens.set(null);
    tokens.setSuper(null);
    setSession(null);
    router.replace("/login");
  };

  const impersonate = async (tenantId) => {
    const data = await api(`/superadmin/tenants/${tenantId}/impersonate`, { method: "POST" });
    tokens.setSuper(tokens.get());
    tokens.set(data.token);
    setSession(data);
    router.push("/app");
  };

  // Open another business of the same login (no logout). Full reload so nothing of the old business stays on screen.
  const switchBusiness = async (userId) => {
    const data = await api("/auth/switch", { method: "POST", body: { userId } });
    tokens.set(data.token);
    window.location.assign(homeFor(data.user.role));
  };

  const stopImpersonating = () => {
    tokens.set(tokens.getSuper());
    tokens.setSuper(null);
    // Full reload so no business-scoped state or socket survives the switch
    window.location.assign("/super-admin/tenants");
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refresh, impersonate, stopImpersonating, switchBusiness }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
