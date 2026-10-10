import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import { useSocketEvent } from './socket';

export type Counts = { newLeads?: number; tasksDue?: number; feesDue?: number; unreadChats?: number; unreadComments?: number; notifications?: number };
const Ctx = createContext<{ counts: Counts; reload: () => void }>({ counts: {}, reload: () => {} });

/** Badges for the tabs (unread chats, tasks due, new leads, fees due) — live + every minute */
export function CountsProvider({ children }: { children: ReactNode }) {
  const { session, epoch } = useAuth();
  const [counts, setCounts] = useState<Counts>({});
  const reload = useCallback(() => {
    if (!session?.tenant) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    Promise.all([
      api<Counts>('/dashboard/counts', { query: { tz } }).catch(() => ({})),
      api<{ unread?: number }>('/notifications', { query: { limit: 1 } }).catch(() => ({}) as { unread?: number }),
    ]).then(([c, n]) => setCounts({ ...c, notifications: n.unread || 0 }));
  }, [session?.tenant]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 60 * 1000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reload());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [reload, epoch]);
  useSocketEvent('task:update', reload, epoch);
  useSocketEvent('notification:new', reload, epoch);
  useSocketEvent('message:new', reload, epoch);
  useSocketEvent('conversation:updated', reload, epoch);
  useSocketEvent('social:comment', reload, epoch);
  useSocketEvent('social:read', reload, epoch);
  return <Ctx.Provider value={{ counts, reload }}>{children}</Ctx.Provider>;
}

export const useCounts = () => useContext(Ctx);
