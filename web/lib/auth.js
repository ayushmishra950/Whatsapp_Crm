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

export function AuthProvider({ children }) {
  const router = useRouter();
  const [session, setSession] = useState(null); // { user, tenant, impersonating }
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await loadSession();
    setSession(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    loadSession().then((data) => {
      if (!active) return;
      setSession(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

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

  const stopImpersonating = () => {
    tokens.set(tokens.getSuper());
    tokens.setSuper(null);
    // Full reload so no business-scoped state or socket survives the switch
    window.location.assign("/super-admin/tenants");
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refresh, impersonate, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
