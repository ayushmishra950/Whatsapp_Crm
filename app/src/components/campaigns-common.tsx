import { View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { C } from '@/theme';
import { EmptyState } from './ui';

export type CampaignStats = { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
export type Campaign = {
  _id: string;
  name: string;
  status: string;
  templateId?: any;
  createdBy?: { _id: string; name: string };
  stats: CampaignStats;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  pauseReason?: string;
  audience?: any;
  variables?: { source: 'field' | 'static'; value: string }[];
};
export type Page<T> = { items: T[]; total: number; page: number; limit: number };

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Bulk messaging: admins always; agents only when Settings allows it (same rule as the web and the server) */
export function useCanBroadcast() {
  const { session } = useAuth();
  return session?.user.role === 'admin' || !!session?.tenant?.settings?.agentsCanBroadcast;
}

export const NoBroadcast = () => (
  <View style={{ flex: 1, backgroundColor: C.bg }}>
    <EmptyState icon="lock-closed-outline" title="Bulk messaging is not enabled for agents" text="Ask your admin to turn on “Agents can send bulk campaigns” in Settings." />
  </View>
);

/** Thin progress bar */
export const Progress = ({ value }: { value: number }) => (
  <View style={{ height: 6, borderRadius: 3, backgroundColor: C.soft, overflow: 'hidden' }}>
    <View style={{ height: 6, width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: C.brand500 }} />
  </View>
);
