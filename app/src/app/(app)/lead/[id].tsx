import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, Text, View } from 'react-native';
import { showActionMenu } from '@/components/chat';
import { ChannelBadge, instagramUrl } from '@/components/channel';
import { DateField } from '@/components/date-field';
import { FeesPanel } from '@/components/fees';
import { TagInput } from '@/components/tag-input';
import { CallLogSheet, CourseSelect, NextFollowUpSheet, StatusSelect } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Avatar, Badge, Button, Card, Chip, ChipBar, EmptyState, Field, IconButton, Input, Loader, Row, Screen, Select, StatusBadge, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { callOutcomeLabel, LANGUAGES, MANUAL_SOURCES, sourceLabel, useLeadStatuses } from '@/lib/business';
import { useCourses } from '@/lib/courses';
import { fmtDate, fmtDateTime, fmtPhone, fmtRelative, isLate, money, prettyDay, todayKey, displayName } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, F, R, S } from '@/theme';

const KINDS: Record<string, { icon: string; group: string }> = {
  start: { icon: '🌱', group: 'all' },
  visit: { icon: '🚶', group: 'notes' },
  course: { icon: '📘', group: 'courses' },
  call: { icon: '📞', group: 'calls' },
  note: { icon: '📝', group: 'notes' },
  status: { icon: '🔀', group: 'status' },
  fee: { icon: '💰', group: 'fees' },
  task: { icon: '⏰', group: 'tasks' },
  done: { icon: '✅', group: 'tasks' },
  drip: { icon: '🔁', group: 'auto' },
  template: { icon: '📨', group: 'auto' },
  bot: { icon: '🤖', group: 'auto' },
  botmsg: { icon: '🤖', group: 'chat' },
  customer: { icon: '💬', group: 'chat' },
  reply: { icon: '↩️', group: 'chat' },
};
const FILTERS: [string, string][] = [['all', 'Everything'], ['courses', '📘 Courses'], ['calls', '📞 Calls'], ['notes', '📝 Notes'], ['status', '🔀 Status'], ['tasks', '⏰ Tasks'], ['fees', '💰 Fees'], ['auto', '🔁 Drips'], ['chat', '💬 Messages']];
const DID: Record<string, string> = { viewed: 'opened', fees: 'fees', details: 'details', demo: 'asked demo', interested: 'interested ✅', not_now: 'not now', booked: 'booked ✅' };
const daysAgo = (d: string) => {
  const n = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};

/** One page per lead: summary, full history, details, tasks, fees and a link to the chat */
export default function LeadScreen() {
  const { id, tab: startTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const toast = useToast();
  const { session, epoch } = useAuth();
  const coaching = useIsCoaching();
  const courses = useCourses();
  const statuses = useLeadStatuses();
  const isAdmin = session?.user.role === 'admin';
  const [contact, setContact] = useState<any>(null);
  const [conversation, setConversation] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]); // one per app: [{ _id, channel }]
  const [history, setHistory] = useState<any>(null);
  const [tab, setTab] = useState(startTab || 'overview');
  const [filter, setFilter] = useState('all');
  const [withChat, setWithChat] = useState(false);
  const [note, setNote] = useState('');
  const [calling, setCalling] = useState(false);
  const [next, setNext] = useState<{ title: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);

  const loadContact = useCallback(
    () =>
      api(`/contacts/${id}`)
        .then((r) => {
          setContact(r.contact);
          setConversation(r.conversation);
          setChats(r.conversations || (r.conversation ? [r.conversation] : []));
        })
        .catch((err) => {
          toast.error(err);
          router.back();
        }),
    [id, toast]
  );
  const loadHistory = useCallback(() => api(`/contacts/${id}/history`, { query: { chat: withChat ? 'true' : '' } }).then(setHistory).catch(() => {}), [id, withChat]);
  const loadTasks = useCallback(() => api<any[]>('/tasks', { query: { contactId: id, status: 'open' } }).then(setTasks).catch(() => {}), [id]);
  const reloadAll = useCallback(() => Promise.all([loadContact(), loadHistory(), loadTasks()]).finally(() => setRefreshing(false)), [loadContact, loadHistory, loadTasks]);
  useEffect(() => {
    reloadAll();
  }, [reloadAll, epoch]);
  useSocketEvent('task:update', () => { loadTasks(); loadHistory(); }, epoch);
  useSocketEvent('message:new', ({ conversation: c }) => String(c.contactId?._id || c.contactId) === id && loadHistory(), epoch);

  const update = async (patch: any, msg?: string) => {
    try {
      const c = await api(`/contacts/${id}`, { method: 'PATCH', body: patch });
      setContact(c);
      if (msg) toast.success(msg);
      if (patch.leadStatus || patch.course !== undefined) loadHistory();
    } catch (err) {
      toast.error(err);
    }
  };
  // Open the lead's WhatsApp or Instagram chat (asks which when the lead can be reached on both)
  const openChannel = async (channel: 'whatsapp' | 'instagram') => {
    try {
      const existing = chats.find((c) => (c.channel || 'whatsapp') === channel);
      const conv = existing || (await api('/conversations/start', { method: 'POST', body: { contactId: id, channel } }));
      router.push(`/chat/${conv._id}`);
    } catch (err) {
      toast.error(err);
    }
  };
  const openChat = () => {
    const apps: ('whatsapp' | 'instagram')[] = [];
    if (contact?.phone || chats.some((c) => (c.channel || 'whatsapp') === 'whatsapp')) apps.push('whatsapp');
    if (contact?.instagram?.igsid) apps.push('instagram');
    if (apps.length < 2) return openChannel(apps[0] || 'whatsapp');
    const label = (ch: 'whatsapp' | 'instagram') => `${ch === 'instagram' ? '📸 Instagram' : '💬 WhatsApp'}${chats.some((c) => (c.channel || 'whatsapp') === ch) ? '' : ' (start chat)'}`;
    showActionMenu('Open which chat?', apps.map((ch) => ({ key: ch, label: label(ch) })), (k) => openChannel(k as 'whatsapp' | 'instagram'));
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    try {
      const conv = conversation?._id ? conversation : await api('/conversations/start', { method: 'POST', body: { contactId: id } });
      setConversation(conv);
      await api(`/conversations/${conv._id}/messages`, { method: 'POST', body: { type: 'note', text: note.trim() } });
      setNote('');
      toast.success('Note saved');
      loadHistory();
    } catch (err) {
      toast.error(err);
    }
  };
  const removeLead = async () => {
    if (!(await confirm('Delete this lead?', `${displayName(contact)}, their chat, tasks and history are deleted for good.`, { ok: 'Delete', danger: true }))) return;
    try {
      await api(`/contacts/${id}`, { method: 'DELETE' });
      toast.success('Lead deleted');
      router.back();
    } catch (err) {
      toast.error(err);
    }
  };
  const taskDone = async (t: any) => {
    try {
      await api(`/tasks/${t._id}`, { method: 'PATCH', body: { status: 'done' } });
      toast.success('Done ✓');
      setNext({ title: t.title });
      loadTasks();
      loadHistory();
    } catch (err) {
      toast.error(err);
    }
  };
  const taskCancel = async (t: any) => {
    if (!(await confirm('Cancel this task?', t.title, { ok: 'Cancel task', danger: true }))) return;
    try {
      await api(`/tasks/${t._id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      loadTasks();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!contact) return <Loader />;
  const f = contact.fees || {};
  const payable = (f.total || 0) - (f.discount || 0);
  const s = history?.stats || {};
  const converted = contact.leadStatus === 'converted' || f.paid > 0;
  const joinDate = contact.customFields?.joining_date || (converted ? contact.statusUpdatedAt : null);
  const others = (contact.courseInterest || []).filter((c: any) => c.code !== contact.course);
  const facts: { label: string; value: string; sub: string; tone?: string }[] = [
    { label: 'First enquiry', value: fmtDate(contact.createdAt), sub: `${daysAgo(contact.createdAt)} · ${sourceLabel(contact.source)}` },
    ...(coaching ? [{ label: converted ? 'Joined course' : 'Interested in', value: contact.course ? courses.label(contact.course) : '—', sub: [converted ? (joinDate ? `Joined ${prettyDay(String(joinDate).slice(0, 10))}` : 'Converted') : !contact.course ? 'Course not known yet' : '', others.length ? `Also looked at: ${others.map((c: any) => c.name).join(', ')}` : ''].filter(Boolean).join(' · ') }] : []),
    ...(coaching && payable > 0 ? [{ label: 'Fees', value: `${money(f.paid)} / ${money(payable)}`, sub: f.balance > 0 ? `Balance ${money(f.balance)}${f.nextDue ? ` · next ${money(f.nextAmount)} on ${prettyDay(f.nextDue)}` : ''}` : 'Fully paid 🎉', tone: f.nextDue && f.nextDue < todayKey() ? C.red : undefined }] : []),
    { label: 'Calls', value: String(contact.callAttempts || 0), sub: contact.lastCallAt ? `Last ${fmtRelative(contact.lastCallAt)}: ${callOutcomeLabel(contact.lastCallOutcome)}` : 'Never called', tone: !contact.callAttempts ? C.amber : undefined },
    { label: 'Customer last wrote', value: s.lastInboundAt ? fmtRelative(s.lastInboundAt) : 'Never', sub: `${s.inbound || 0} in · ${s.outbound || 0} out` },
    { label: 'Next action', value: contact.nextActionAt ? fmtDateTime(contact.nextActionAt) : 'None set', sub: tasks.length ? `${tasks.length} open task(s)` : 'Set a follow-up so the lead is not lost', tone: !contact.nextActionAt ? C.amber : isLate(contact.nextActionAt) ? C.red : undefined },
  ];
  const events = (history?.events || []).filter((e: any) => filter === 'all' || KINDS[e.kind]?.group === filter);
  const tabs: [string, string][] = [['overview', 'Overview'], ['history', 'History'], ['details', 'Details'], ['tasks', `Tasks${tasks.length ? ` (${tasks.length})` : ''}`], ...(coaching ? ([['fees', 'Fees']] as [string, string][]) : [])];

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); reloadAll(); }}>
      <Stack.Screen
        options={{
          title: displayName(contact),
          headerRight: () => (
            <Row gap={14}>
              <IconButton name={contact.phone ? 'logo-whatsapp' : 'logo-instagram'} color={contact.phone ? C.brand600 : '#be185d'} onPress={openChat} label="Open chat" />
              {isAdmin ? <IconButton name="trash-outline" color={C.red} onPress={removeLead} label="Delete lead" /> : null}
            </Row>
          ),
        }}
      />
      {/* Header */}
      <Row gap={S.md} style={{ alignItems: 'flex-start' }}>
        <Avatar name={displayName(contact).replace(/^[@+]/, '')} size={52} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h2" numberOfLines={2}>{displayName(contact)}</T>
          {contact.phone ? <Pressable onPress={() => Linking.openURL(`tel:+${contact.phone}`)}><T style={{ color: C.brand700 }}>{fmtPhone(contact.phone)}</T></Pressable> : null}
          {contact.instagram?.username ? (
            <Pressable onPress={() => Linking.openURL(instagramUrl(contact))}>
              <Row gap={6}><ChannelBadge channel="instagram" /><T style={{ color: '#be185d' }}>@{contact.instagram.username}</T></Row>
            </Pressable>
          ) : null}
          <Row wrap gap={4}>
            <StatusBadge status={contact.leadStatus} />
            {coaching && contact.course ? <Badge tone="purple">{contact.course}</Badge> : null}
            {contact.optedOut ? <Badge tone="red">opted out</Badge> : null}
            {(contact.tags || []).slice(0, 4).map((t: string) => <Badge key={t}>{t}</Badge>)}
          </Row>
          <T v="small">{contact.assignedTo?.name ? `Counsellor: ${contact.assignedTo.name}` : 'Not assigned'}</T>
        </View>
      </Row>
      <Row wrap gap={6}>
        {contact.phone ? <Button size="sm" icon="call" title="Call" onPress={() => Linking.openURL(`tel:+${contact.phone}`)} /> : null}
        <Button size="sm" variant="secondary" icon={contact.phone ? 'logo-whatsapp' : 'logo-instagram'} title="Chat" onPress={openChat} />
        <Button size="sm" variant="secondary" icon="create-outline" title="Log call" onPress={() => setCalling(true)} />
        <Button size="sm" variant="secondary" icon="calendar-outline" title="Follow-up" onPress={() => setNext({ title: 'Follow up' })} />
      </Row>
      <ChipBar options={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {facts.map((x) => (
              <View key={x.label} style={{ width: '48.5%', backgroundColor: '#fff', borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: S.md }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.faint, textTransform: 'uppercase' }}>{x.label}</Text>
                <Text style={{ fontSize: F.md, fontWeight: '700', color: x.tone || C.text }} numberOfLines={2}>{x.value}</Text>
                <Text style={{ fontSize: 12, color: C.muted }} numberOfLines={3}>{x.sub}</Text>
              </View>
            ))}
          </View>
          {history?.activeDrips?.length ? history.activeDrips.map((d: any) => <Badge key={d._id} tone="gray">🔁 In drip: {d.name}{d.nextRunAt ? ` · next ${fmtRelative(d.nextRunAt)}` : ''}</Badge>) : null}
          {coaching && contact.courseInterest?.length ? (
            <Card style={{ gap: 6, backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }}>
              <T style={{ fontWeight: '700', color: '#3730a3' }}>📘 Courses looked at in the chatbot</T>
              {[...contact.courseInterest].sort((a: any, b: any) => +new Date(b.lastAt) - +new Date(a.lastAt)).map((c: any) => (
                <View key={c.code}>
                  <T style={{ color: C.text, fontWeight: '600' }}>{c.name}{c.code === contact.course ? '  · current' : ''}</T>
                  <T v="tiny" style={{ color: C.muted }}>{(c.actions || []).map((a: string) => DID[a] || a).join(' · ')} · {fmtRelative(c.lastAt)}</T>
                </View>
              ))}
            </Card>
          ) : null}
          {contact.notes ? <Card style={{ backgroundColor: C.amber50, borderColor: '#fde68a' }}><T style={{ color: C.amber900 }}>📌 {contact.notes}</T></Card> : null}
          {contact.adSource?.sourceId ? (
            <Card style={{ gap: 2, backgroundColor: '#f5f3ff', borderColor: '#ddd6fe' }}>
              <T v="tiny" style={{ color: '#6d28d9', fontWeight: '600' }}>📣 Came from a Facebook / Instagram ad · {fmtDateTime(contact.adSource.at)}</T>
              <T style={{ fontWeight: '600', color: '#4c1d95' }}>{contact.adSource.headline || 'Ad'}</T>
              <Row gap={8}>
                <T v="tiny" style={{ color: '#5b21b6' }}>Ad ID: {contact.adSource.sourceId}</T>
                {contact.adSource.sourceUrl ? <Pressable onPress={() => Linking.openURL(contact.adSource.sourceUrl)}><T v="tiny" style={{ color: '#5b21b6', textDecorationLine: 'underline' }}>open</T></Pressable> : null}
              </Row>
            </Card>
          ) : null}
          <ReferralBox contactId={contact._id} />
          <Card style={{ gap: S.sm }}>
            <T v="label">Add a note</T>
            <Input multiline value={note} onChangeText={setNote} placeholder="What they said, what you promised… (only your team sees it)" />
            <Button size="sm" variant="secondary" icon="document-text-outline" title="Save note" disabled={!note.trim()} onPress={saveNote} />
          </Card>
        </>
      )}

      {tab === 'history' && (
        <>
          <ChipBar options={FILTERS} value={filter} onChange={(v) => { setFilter(v); if (v === 'chat') setWithChat(true); }} />
          <Chip label={withChat ? '✓ Including chat messages' : 'Include chat messages'} active={withChat} onPress={() => setWithChat((w) => !w)} style={{ alignSelf: 'flex-start' }} />
          {!history ? <Loader /> : !events.length ? <EmptyState icon="time-outline" title="Nothing here yet" /> : (
            <Card style={{ gap: S.md }}>
              {events.map((e: any, i: number) => (
                <Row key={i} gap={S.md} style={{ alignItems: 'flex-start' }}>
                  <Text style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{KINDS[e.kind]?.icon || '•'}</Text>
                  <View style={{ flex: 1 }}>
                    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={6}>
                      <T style={{ fontWeight: '600', color: C.text, flex: 1 }}>{e.title}</T>
                      <T v="tiny">{fmtDateTime(e.at)}</T>
                    </Row>
                    {e.text ? <T v="small" numberOfLines={['customer', 'reply', 'botmsg', 'template'].includes(e.kind) ? 4 : undefined}>{e.text}</T> : null}
                    {e.by || e.status === 'failed' ? <T v="tiny">{e.by ? `by ${e.by}` : ''}{e.status === 'failed' ? ' · failed' : ''}</T> : null}
                  </View>
                </Row>
              ))}
            </Card>
          )}
        </>
      )}

      {tab === 'details' && <LeadDetails key={contact._id} contact={contact} conversation={conversation} isAdmin={isAdmin} onUpdate={update} onConversation={setConversation} statusesLabel={statuses.label} />}

      {tab === 'tasks' && (
        <>
          <Button variant="soft" icon="add" title="New task / follow-up" onPress={() => setNext({ title: 'Follow up' })} />
          {!tasks.length ? <EmptyState icon="checkbox-outline" title="No open tasks" text="Every open lead should have a next step." /> : tasks.map((t) => (
            <Card key={t._id} style={{ gap: 6 }}>
              <T style={{ fontWeight: '600', color: C.text }}>{t.title}</T>
              <T v="small" style={isLate(t.dueAt) ? { color: C.red } : undefined}>{isLate(t.dueAt) ? 'Overdue · ' : 'Due '}{fmtDateTime(t.dueAt)}{t.assignedTo?.name ? ` · ${t.assignedTo.name}` : ''}</T>
              {t.note ? <T v="small">{t.note}</T> : null}
              <Row gap={6}>
                <Button size="sm" icon="checkmark-circle" title="Done" onPress={() => taskDone(t)} />
                <Button size="sm" variant="ghost" title="Cancel" onPress={() => taskCancel(t)} />
              </Row>
            </Card>
          ))}
        </>
      )}

      {tab === 'fees' && coaching && <FeesPanel contactId={id} onChanged={() => { loadContact(); loadHistory(); }} />}

      {calling && <CallLogSheet contact={contact} onClose={() => setCalling(false)} onSaved={(c) => { if (c?._id) setContact(c); loadHistory(); loadTasks(); }} />}
      {next && <NextFollowUpSheet contact={contact} defaultTitle={next.title} onClose={() => { setNext(null); loadContact(); loadTasks(); loadHistory(); }} />}
    </Screen>
  );
}

/** Editable details: name, email, status, course, language, tags, follow-up, custom fields, notes, counsellor */
function LeadDetails({ contact, conversation, isAdmin, onUpdate, onConversation }: { contact: any; conversation: any; isAdmin: boolean; onUpdate: (p: any, msg?: string) => Promise<void>; onConversation: (c: any) => void; statusesLabel: (k?: string) => string }) {
  const toast = useToast();
  const { session } = useAuth();
  const coaching = useIsCoaching();
  const fields: any[] = (session?.tenant?.settings?.contactFields || []).filter((x: any) => !x.hidden);
  const [form, setForm] = useState({ phone: contact.phone || '', name: contact.name || '', email: contact.email || '', notes: contact.notes || '', followUpNote: contact.followUpNote || '' });
  const [custom, setCustom] = useState<Record<string, string>>({ ...(contact.customFields || {}) });
  const [team, setTeam] = useState<any[]>([]);
  useEffect(() => {
    api('/team').then(setTeam).catch(() => {});
  }, []);
  const saveText = (k: 'name' | 'email' | 'notes' | 'followUpNote') => form[k] !== (contact[k] || '') && onUpdate({ [k]: form[k] }, 'Saved');
  const savePhone = async () => {
    if (!form.phone || form.phone === contact.phone) return setForm((f) => ({ ...f, phone: contact.phone }));
    if (!(await confirm('Change the WhatsApp number?', `${fmtPhone(contact.phone)} → ${fmtPhone(form.phone)}. Messages go to the new number from now on.`, { ok: 'Change' }))) return setForm((f) => ({ ...f, phone: contact.phone }));
    onUpdate({ phone: form.phone }, 'Number saved');
  };
  const saveTags = (tags: string[]) => onUpdate({ tags }, 'Tags saved');
  const saveCustom = (k: string, v?: string) => {
    const now = String(v ?? custom[k] ?? '').trim();
    if (now === (contact.customFields?.[k] || '')) return;
    const nextFields = Object.fromEntries(Object.entries({ ...contact.customFields, [k]: now }).filter(([, x]) => x));
    onUpdate({ customFields: nextFields }, 'Saved');
  };
  const assign = async (userId: string) => {
    try {
      const conv = conversation?._id ? conversation : await api('/conversations/start', { method: 'POST', body: { contactId: contact._id } });
      const c = await api(`/conversations/${conv._id}`, { method: 'PATCH', body: { assignedTo: userId || null } });
      onConversation(c);
      toast.success(userId ? 'Counsellor assigned' : 'Unassigned');
      onUpdate({});
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card style={{ gap: S.md }}>
      <Field label="Name"><Input value={form.name} onChangeText={(name) => setForm({ ...form, name })} onBlur={() => saveText('name')} /></Field>
      <Field label="WhatsApp number" hint={!contact.phone && contact.instagram?.igsid ? 'Instagram lead: add the number when they share it (then you can chat on WhatsApp too)' : 'With country code, e.g. 919876543210'}><Input value={form.phone} onChangeText={(phone) => setForm({ ...form, phone: phone.replace(/[^\d]/g, '') })} onBlur={savePhone} keyboardType="number-pad" /></Field>
      <Field label="Email"><Input value={form.email} onChangeText={(email) => setForm({ ...form, email })} onBlur={() => saveText('email')} autoCapitalize="none" keyboardType="email-address" /></Field>
      <Field label="Lead status"><StatusSelect value={contact.leadStatus} onChange={(leadStatus) => onUpdate({ leadStatus }, 'Status updated')} /></Field>
      {coaching ? (
        <>
          <Field label="Course"><CourseSelect value={contact.course || ''} onChange={(course) => onUpdate({ course }, 'Course saved')} /></Field>
          <Field label="Language"><Select value={contact.language || ''} onChange={(language) => onUpdate({ language }, 'Saved')} options={LANGUAGES.map(([value, label]) => ({ value, label }))} title="Language" /></Field>
        </>
      ) : null}
      {MANUAL_SOURCES.some(([v]) => v === contact.source) ? (
        <Field label="Lead source"><Select value={contact.source} onChange={(source) => onUpdate({ source }, 'Saved')} options={MANUAL_SOURCES.map(([value, label]) => ({ value, label }))} title="Lead source" /></Field>
      ) : (
        <Field label="Lead source"><Input editable={false} value={sourceLabel(contact.source)} /></Field>
      )}
      <Field label="Counsellor (chat owner)">
        <Select value={conversation?.assignedTo?._id || conversation?.assignedTo || contact.assignedTo?._id || ''} onChange={assign} disabled={!isAdmin && !!conversation?.assignedTo} title="Assign to" options={[{ value: '', label: 'Unassigned' }, ...team.filter((t) => t.isActive !== false).map((t) => ({ value: t._id, label: t.name }))]} />
      </Field>
      <Field label="Follow-up reminder" hint="Shows on Today when due">
        <DateField value={contact.followUpAt ? new Date(contact.followUpAt) : null} onChange={(d) => onUpdate({ followUpAt: d ? d.toISOString() : null }, d ? 'Follow-up set' : 'Follow-up cleared')} clearable placeholder="No follow-up" />
      </Field>
      {contact.followUpAt ? <Field label="What to do"><Input value={form.followUpNote} onChangeText={(followUpNote) => setForm({ ...form, followUpNote })} onBlur={() => saveText('followUpNote')} placeholder="e.g. call about fees" /></Field> : null}
      {contact.followUpAt ? <FollowUpMessage contact={contact} onUpdate={onUpdate} /> : null}
      <Field label="Tags"><TagInput value={contact.tags || []} onChange={saveTags} /></Field>
      {fields.map((fd) => (
        <Field key={fd.key} label={fd.label}>
          {fd.type === 'select' ? (
            <Select value={custom[fd.key] || ''} onChange={(v) => { setCustom({ ...custom, [fd.key]: v }); saveCustom(fd.key, v); }} title={fd.label} options={[{ value: '', label: '—' }, ...(fd.options || []).map((o: string) => ({ value: o, label: o }))]} />
          ) : fd.type === 'multiselect' ? (
            <Row wrap gap={6}>
              {(fd.options || []).map((o: string) => {
                const cur = (custom[fd.key] || '').split(',').map((x) => x.trim()).filter(Boolean);
                const on = cur.includes(o);
                return <Chip key={o} label={o} active={on} onPress={() => { const v = (on ? cur.filter((x) => x !== o) : [...cur, o]).join(', '); setCustom({ ...custom, [fd.key]: v }); saveCustom(fd.key, v); }} />;
              })}
            </Row>
          ) : fd.type === 'date' ? (
            <DateField mode="date" clearable value={custom[fd.key] && !custom[fd.key].startsWith('0000') ? new Date(`${custom[fd.key]}T00:00:00`) : null} onChange={(d) => { const v = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''; setCustom({ ...custom, [fd.key]: v }); saveCustom(fd.key, v); }} />
          ) : (
            <Input value={custom[fd.key] || ''} onChangeText={(v) => setCustom({ ...custom, [fd.key]: v })} onBlur={() => saveCustom(fd.key)} />
          )}
        </Field>
      ))}
      <Field label="Notes" hint="Saved when you leave the box"><Input multiline value={form.notes} onChangeText={(notes) => setForm({ ...form, notes })} onBlur={() => saveText('notes')} /></Field>
      <Toggle
        value={!!contact.optedOut}
        onChange={(optedOut) => onUpdate({ optedOut }, optedOut ? 'Opted out of bulk messages' : 'Gets bulk messages again')}
        label="Opted out of bulk messages"
        description="Campaigns and drips skip this lead. You can still reply in the chat."
      />
    </Card>
  );
}

/** "Remind me" only, or also send an approved WhatsApp template to the customer at the follow-up time */
function FollowUpMessage({ contact, onUpdate }: { contact: any; onUpdate: (p: any, msg?: string) => Promise<void> }) {
  const [templates, setTemplates] = useState<any[]>([]);
  // Turned on here first; saved once a template is chosen (the server needs both together)
  const [on, setOn] = useState(contact.followUpAction === 'message');
  useEffect(() => {
    if (on) api<any[]>('/templates', { query: { status: 'approved' } }).then(setTemplates).catch(() => setTemplates([]));
  }, [on]);
  return (
    <View style={{ gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.sm }}>
      <Toggle
        value={on}
        onChange={(v) => {
          setOn(v);
          if (!v && contact.followUpAction === 'message') onUpdate({ followUpAction: 'remind', followUpTemplateId: null }, 'Only a reminder now');
        }}
        label="Also send a WhatsApp message"
        description="At the follow-up time the customer gets the template you choose."
      />
      {on ? (
        <>
          <Select
            value={contact.followUpTemplateId?._id || contact.followUpTemplateId || ''}
            onChange={(id) => id && onUpdate({ followUpAction: 'message', followUpTemplateId: id }, 'The template goes out at the follow-up time')}
            title="Follow-up template"
            placeholder="Choose an approved template…"
            options={templates.map((t) => ({ value: t._id, label: t.name }))}
          />
          <T v="tiny">{contact.followUpSentAt ? `✅ Sent ${fmtDateTime(contact.followUpSentAt)}. Change the time to send again.` : "Sent by itself at the follow-up time (variables use the template's defaults)."}</T>
        </>
      ) : null}
    </View>
  );
}

/** Refer & earn: this lead's code and share link, how many friends they brought, who referred them */
function ReferralBox({ contactId }: { contactId: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    api(`/referrals/contact/${contactId}`).then(setInfo).catch(() => {});
  }, [contactId]);
  if (!info) return null;
  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    toast.success(`${what} copied`);
  };
  return (
    <Card style={{ gap: 6, backgroundColor: C.amber50, borderColor: '#fde68a' }}>
      <T v="tiny" style={{ color: C.amber900, fontWeight: '700' }}>🎁 Refer & earn</T>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <T style={{ color: C.amber900 }}>Code: <Text style={{ fontWeight: '700' }}>{info.code}</Text></T>
        <Button size="sm" variant="ghost" icon="copy-outline" title="Copy code" onPress={() => copy(info.code, 'Code')} />
        <Button size="sm" variant="ghost" icon="share-social-outline" title="Copy share link" disabled={!info.hasNumber} onPress={() => copy(info.link, 'Share link')} />
      </Row>
      {!info.hasNumber ? <T v="tiny" style={{ color: C.amber900 }}>Set the WhatsApp number in Settings → Refer & earn to get a share link.</T> : null}
      <T v="small" style={{ color: C.amber900 }}>
        Referred {info.referred} · joined {info.converted} · discounts given {info.rewardsGiven}
        {info.referredBy ? ` · referred by ${displayName(info.referredBy)}` : ''}
      </T>
    </Card>
  );
}
