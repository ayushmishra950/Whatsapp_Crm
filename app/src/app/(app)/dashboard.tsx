import { Stack, router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Badge, Card, ChipBar, Divider, Loader, Row, Screen, SectionTitle, Stat, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { fmtDateTime, fmtNum, displayName } from '@/lib/format';
import { C, R, S } from '@/theme';

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};
const BAR: Record<string, string> = { gray: '#94a3b8', blue: '#0ea5e9', green: C.brand500, yellow: '#fbbf24', red: '#ef4444', purple: '#8b5cf6' };
const CAMPAIGN_TONE: Record<string, string> = { completed: 'green', running: 'blue', scheduled: 'yellow', paused: 'yellow', failed: 'red', draft: 'gray' };
const rupees = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
const go = (href: string) => router.push(href as Href);

/** Leads, chats, customers & WhatsApp cost, team (admin) — same as the web dashboard */
export default function DashboardScreen() {
  const { session, epoch } = useAuth();
  const toast = useToast();
  const { list: statuses } = useLeadStatuses();
  const isAdmin = session?.user.role === 'admin';
  const [d, setD] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(
    () =>
      api('/dashboard', { query: { tz: tz() } })
        .then(setD)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  const refresh = () => {
    setRefreshing(true);
    setTick((t) => t + 1);
    load();
  };

  if (!d) return <Loader />;
  const maxDay = Math.max(1, ...d.daily.map((x: any) => Math.max(x.inbound, x.outbound)));
  const totalLeads = Math.max(1, (Object.values(d.leadFunnel) as number[]).reduce((a, b) => a + b, 0));
  const usagePct = d.monthlyLimit ? Math.min(100, Math.round((d.messagesThisMonth / d.monthlyLimit) * 100)) : 0;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: 'Dashboard' }} />
      <View>
        <T v="h2">Hello, {session?.user.name.split(' ')[0]} 👋</T>
        <T v="small">{isAdmin ? 'Here is how your business is doing today' : 'Your chats at a glance'}</T>
      </View>

      <Row wrap gap={S.sm}>
        <Stat label={isAdmin ? 'Open chats' : 'My open chats'} value={fmtNum(d.openChats)} />
        <Stat label={isAdmin ? 'Pending chats' : 'My pending chats'} value={fmtNum(d.pendingChats)} />
        <Stat label="Unassigned" value={fmtNum(d.unassigned)} sub={d.botActive ? `Waiting for an agent · 🤖 ${d.botActive} with bot` : 'Waiting for an agent'} />
        <Stat label="New leads today" value={fmtNum(d.newLeadsToday)} sub={`${fmtNum(d.contacts)} total contacts`} />
      </Row>

      <NeedsAttention isAdmin={isAdmin} tick={tick} />
      {isAdmin && <MessagesAndCost tick={tick} />}

      <Card style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">Messages – last 7 days</T>
        </Row>
        <Legend items={[['#0ea5e9', 'Received'], [C.brand600, 'Sent']]} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 6 }}>
          {d.daily.map((x: any) => (
            <View key={x.day} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={{ height: 116, width: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                <View style={{ width: '35%', maxWidth: 14, height: `${(x.inbound / maxDay) * 100}%`, backgroundColor: '#0ea5e9', borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                <View style={{ width: '35%', maxWidth: 14, height: `${(x.outbound / maxDay) * 100}%`, backgroundColor: C.brand600, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              </View>
              <T v="tiny">{weekday(x.day)}</T>
            </View>
          ))}
        </View>
        <Divider />
        <Row wrap gap={S.lg}>
          <T v="small">↙ {fmtNum(d.todayIn)} received today</T>
          <T v="small">↗ {fmtNum(d.todayOut)} sent today</T>
        </Row>
      </Card>

      <Card style={{ gap: S.md }}>
        <T v="h3">Lead pipeline</T>
        {statuses.map((s) => {
          const n = d.leadFunnel[s.key] || 0;
          return (
            <Pressable key={s.key} onPress={() => go(`/leads?leadStatus=${s.key}`)} style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.7 }]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="small" style={{ color: C.text2 }}>{s.label}</T>
                <T style={{ fontWeight: '600', color: C.text }}>{n}</T>
              </Row>
              <Bar pct={(n / totalLeads) * 100} color={BAR[s.color || ''] || C.brand500} />
            </Pressable>
          );
        })}
        <Pressable onPress={() => go('/leads')}>
          <T style={{ color: C.brand700, fontWeight: '600' }}>View leads ›</T>
        </Pressable>
      </Card>

      <Card style={{ gap: S.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6}>
            <T v="h3">🔔 Follow-ups due today</T>
            {d.followUpsDue > 0 ? <Badge tone="amber">{d.followUpsDue}</Badge> : null}
          </Row>
        </Row>
        {d.followUps.length ? (
          d.followUps.map((f: any, i: number) => {
            const overdue = new Date(f.followUpAt) < new Date();
            return (
              <View key={f._id}>
                {i ? <Divider style={{ marginBottom: S.sm }} /> : null}
                <Pressable onPress={() => go(`/lead/${f._id}`)} style={{ gap: 2 }}>
                  <Row wrap gap={6}>
                    <T style={{ fontWeight: '600', color: C.text }}>{displayName(f)}</T>
                    <StatusBadge status={f.leadStatus} />
                  </Row>
                  <T v="small" numberOfLines={2}>
                    {f.followUpAction === 'message' ? (f.followUpSentAt ? '⏰ WhatsApp sent · ' : '⏰ WhatsApp at this time · ') : ''}
                    {f.followUpNote || 'No note'}
                    {isAdmin && f.followUpBy?.name ? ` · by ${f.followUpBy.name}` : ''}
                  </T>
                  <T v="tiny" style={{ color: overdue ? C.red : C.amber, fontWeight: '600' }}>{overdue ? 'Overdue · ' : ''}{fmtDateTime(f.followUpAt)}</T>
                </Pressable>
              </View>
            );
          })
        ) : (
          <T v="small">No follow-ups due. Set one from a lead (lead page → Next follow-up).</T>
        )}
      </Card>

      <Card style={{ gap: S.sm }}>
        <T v="h3">📣 Leads from ads (30 days)</T>
        {d.adLeads.length ? (
          d.adLeads.map((a: any) => (
            <Row key={a.adId} style={{ justifyContent: 'space-between' }} gap={S.md}>
              <T style={{ flex: 1, color: C.text }} numberOfLines={1}>{a.name || a.headline || a.adId}</T>
              <T v="small">{a.leads} leads · {a.converted} converted ({Math.round((a.converted / Math.max(1, a.leads)) * 100)}%)</T>
            </Row>
          ))
        ) : (
          <T v="small">No leads from Click-to-WhatsApp ads yet. When someone messages you from a Facebook / Instagram ad, it shows here.</T>
        )}
      </Card>

      <Celebrations tick={tick} />
      {isAdmin && <TeamPerformance tick={tick} />}

      {isAdmin && (
        <Card style={{ gap: S.sm }}>
          <T v="h3">Plan usage this month</T>
          <T style={{ fontSize: 22, fontWeight: '700', color: C.text }}>
            {fmtNum(d.messagesThisMonth)} <T v="small">/ {d.monthlyLimit ? fmtNum(d.monthlyLimit) : '∞'} messages</T>
          </T>
          <Bar pct={usagePct} color={usagePct > 85 ? '#ef4444' : C.brand500} />
          <T v="tiny">{session?.tenant?.plan?.name} plan</T>
        </Card>
      )}

      {isAdmin && (
        <Card style={{ gap: S.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="h3">Recent campaigns</T>
            <Pressable onPress={() => go('/campaigns')}>
              <T style={{ color: C.brand700 }}>View all</T>
            </Pressable>
          </Row>
          {d.recentCampaigns.length ? (
            d.recentCampaigns.map((c: any) => (
              <Pressable key={c._id} onPress={() => go(`/campaigns/${c._id}`)} style={{ paddingVertical: 4 }}>
                <Row style={{ justifyContent: 'space-between' }} gap={S.md}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: '500', color: C.text }} numberOfLines={1}>{c.name}</T>
                    <T v="tiny">{c.stats?.sent || 0}/{c.stats?.total || 0} sent · {c.stats?.read || 0} read</T>
                  </View>
                  <Badge tone={CAMPAIGN_TONE[c.status] || 'gray'}>{c.status}</Badge>
                </Row>
              </Pressable>
            ))
          ) : (
            <T v="small">No campaigns yet</T>
          )}
        </Card>
      )}
    </Screen>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: C.soft, overflow: 'hidden' }}>
      <View style={{ height: 8, borderRadius: 4, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
    </View>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <Row wrap gap={S.md}>
      {items.map(([color, label]) => (
        <Row key={label} gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
          <T v="tiny" style={{ color: C.muted }}>{label}</T>
        </Row>
      ))}
    </Row>
  );
}

/** Overdue tasks, leads with no next action, customers waiting for a reply */
function NeedsAttention({ isAdmin, tick }: { isAdmin: boolean; tick: number }) {
  const { epoch } = useAuth();
  const [a, setA] = useState<any>(null);
  useEffect(() => {
    api('/dashboard/attention').then(setA).catch(() => {});
  }, [epoch, tick]);
  if (!a) return null;
  const boxes = [
    { label: 'Overdue tasks', n: a.overdueTasks.count, href: '/tasks', tone: C.red, hint: `${a.dueToday.count} more due today` },
    { label: 'Leads without a next action', n: a.noNextAction.count, href: '/leads?nextAction=none', tone: C.amber, hint: 'Add a task or follow-up' },
    { label: 'Customers waiting > 30 min', n: a.waitingReply.count, href: '/inbox', tone: C.blue, hint: 'Last message is theirs' },
  ];
  const total = a.overdueTasks.count + a.noNextAction.count + a.waitingReply.count;
  return (
    <Card style={{ gap: S.md }}>
      <T v="h3">⚠️ Needs attention {isAdmin ? '' : '(my leads)'}{!total ? <T v="small"> – all clear 🎉</T> : null}</T>
      <Row wrap gap={S.sm}>
        {boxes.map((b) => (
          <Pressable key={b.label} onPress={() => go(b.href)} style={({ pressed }) => [{ flex: 1, minWidth: 100, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md }, pressed && { backgroundColor: C.soft }]}>
            <T style={{ fontSize: 22, fontWeight: '700', color: b.n ? b.tone : C.faint }}>{fmtNum(b.n)}</T>
            <T v="small" style={{ color: C.text2 }}>{b.label}</T>
            <T v="tiny">{b.hint}</T>
          </Pressable>
        ))}
      </Row>
      {a.overdueTasks.items.slice(0, 5).map((t: any) => (
        <Pressable key={t._id} onPress={() => (t.contactId?._id ? go(`/lead/${t.contactId._id}`) : go('/tasks'))}>
          <Row style={{ justifyContent: 'space-between' }} gap={S.md}>
            <T v="small" style={{ flex: 1, color: C.text2 }} numberOfLines={1}>
              <T v="small" style={{ fontWeight: '700', color: C.text }}>{t.title}</T> · {displayName(t.contactId)}
              {t.assignedTo?.name ? ` · ${t.assignedTo.name}` : ''}
            </T>
            <T v="tiny" style={{ color: C.red, fontWeight: '600' }}>{fmtDateTime(t.dueAt)}</T>
          </Row>
        </Pressable>
      ))}
    </Card>
  );
}

/** New vs returning customers per day, messages, and the estimated WhatsApp cost (template messages) */
function MessagesAndCost({ tick }: { tick: number }) {
  const { epoch } = useAuth();
  const [days, setDays] = useState('14');
  const [m, setM] = useState<any>(null);
  useEffect(() => {
    api('/dashboard/messages', { query: { days, tz: tz() } }).then(setM).catch(() => {});
  }, [days, epoch, tick]);
  if (!m) return null;
  const max = Math.max(1, ...m.days.map((d: any) => d.newCustomers + d.returningCustomers));
  const today = m.days[m.days.length - 1];
  const tile = (bg: string, fg: string, label: string, value: string, sub?: string) => (
    <View style={{ flex: 1, minWidth: 130, backgroundColor: bg, borderRadius: R.md, padding: S.md }}>
      <T v="tiny" style={{ color: fg }}>{label}</T>
      <T style={{ fontSize: 20, fontWeight: '700', color: fg }}>{value}</T>
      {sub ? <T v="tiny" style={{ color: fg }}>{sub}</T> : null}
    </View>
  );
  return (
    <Card style={{ gap: S.md }}>
      <T v="h3">💬 Customers & WhatsApp cost</T>
      <ChipBar options={[['7', '7 days'], ['14', '14 days'], ['30', '30 days']]} value={days} onChange={setDays} />
      <Row wrap gap={S.sm}>
        {tile(C.brand50, C.brand700, 'New customers today', String(today?.newCustomers || 0))}
        {tile(C.blue50, '#0369a1', 'Returning today', String(today?.returningCustomers || 0))}
        {tile(C.soft, C.text, `New · ${days} days`, String(m.totals.newCustomers))}
        {tile(C.soft, C.text, 'Messages in / out', `${m.totals.inbound} / ${m.totals.outbound}`)}
        {tile(C.amber50, '#b45309', `WhatsApp cost · ${days} days`, rupees(m.totals.cost), `${m.totals.marketing} marketing · ${m.totals.utility} utility · today ${rupees(today?.cost)}`)}
      </Row>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: days === '30' ? 1 : 3 }}>
        {m.days.map((d: any) => (
          <View key={d.day} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View style={{ height: 100, width: '100%', justifyContent: 'flex-end' }}>
              <View style={{ width: '100%', height: `${(d.returningCustomers / max) * 100}%`, backgroundColor: '#38bdf8', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
              <View style={{ width: '100%', height: `${(d.newCustomers / max) * 100}%`, backgroundColor: C.brand500 }} />
            </View>
            <T v="tiny" style={{ fontSize: 9 }}>{Number(d.day.slice(8))}</T>
          </View>
        ))}
      </View>
      <Legend items={[[C.brand500, 'New customers'], ['#38bdf8', 'Returning customers']]} />
      <T v="tiny">
        Cost = template messages × rate (marketing {rupees(m.rates.marketing)}, utility {rupees(m.rates.utility)}). Replies within 24 h are free. Estimate — set Meta&apos;s current rates in Settings.
      </T>
    </Card>
  );
}

/** Birthdays / anniversaries today and in the next 7 days (date contact fields) */
function Celebrations({ tick }: { tick: number }) {
  const { session } = useAuth();
  const dateFields: { key: string; label: string }[] = (session?.tenant?.settings?.contactFields || []).filter((f: any) => f.type === 'date');
  const key = dateFields.map((f) => f.key).join(',');
  const [counts, setCounts] = useState<[string, string, number][] | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(',').flatMap((k) =>
        ['today', 'this_week'].map((when) =>
          api('/segments/count', { method: 'POST', body: { filter: { dateMatch: { field: `custom.${k}`, when } } } }).then((r) => [k, when, r.reachable] as [string, string, number])
        )
      )
    )
      .then((rows) => alive && setCounts(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, tick]);
  if (!dateFields.length || !counts) return null;
  const n = (k: string, w: string) => counts.find(([a, b]) => a === k && b === w)?.[2] ?? 0;
  return (
    <Card style={{ gap: S.sm }}>
      <T v="h3">🎂 Birthdays & anniversaries</T>
      {dateFields.map((f) => (
        <View key={f.key} style={{ backgroundColor: '#fdf2f8', borderRadius: R.md, padding: S.md }}>
          <T style={{ fontWeight: '600', color: C.text }}>{f.label}</T>
          <T v="small">{n(f.key, 'today')} today · {n(f.key, 'this_week')} in next 7 days</T>
        </View>
      ))}
    </Card>
  );
}

const fmtMins = (m?: number | null) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

/** Per team member: chats, messages, conversions and how fast they reply */
function TeamPerformance({ tick }: { tick: number }) {
  const { epoch } = useAuth();
  const [days, setDays] = useState('7');
  const [t, setT] = useState<any>(null);
  useEffect(() => {
    let active = true;
    api('/dashboard/team', { query: { days } })
      .then((r) => active && setT(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [days, epoch, tick]);
  const ended = t?.bot?.ended || {};
  return (
    <Card style={{ gap: S.md }}>
      <SectionTitle>👥 Team performance</SectionTitle>
      <ChipBar options={[['7', 'Last 7 days'], ['30', 'Last 30 days']]} value={days} onChange={setDays} />
      {!t ? (
        <T v="small">Loading…</T>
      ) : (
        <>
          {t.members.map((m: any, i: number) => (
            <View key={m._id} style={{ gap: 4, opacity: m.isActive ? 1 : 0.5 }}>
              {i ? <Divider style={{ marginBottom: S.sm }} /> : null}
              <Row gap={6}>
                <T style={{ fontWeight: '600', color: C.text }}>{m.name}</T>
                <Badge tone={m.role === 'admin' ? 'purple' : 'gray'}>{m.role}</Badge>
              </Row>
              <Row wrap gap={S.md}>
                <T v="small">💬 {m.chatsHandled} handled</T>
                <T v="small">📂 {m.openChats} open</T>
                <T v="small">✉️ {m.messagesSent} sent</T>
                <T v="small">✅ {m.converted} converted</T>
                <T v="small">⏱ {fmtMins(m.medianReplyMinutes)}</T>
              </Row>
            </View>
          ))}
          <Divider />
          <T v="tiny">
            🤖 Chatbot: {t.bot.chatsStarted} chats started · {ended.lead_complete || 0} leads collected · {(ended.handoff || 0) + (ended.loop_guard || 0)} handed to the team
          </T>
        </>
      )}
    </Card>
  );
}
