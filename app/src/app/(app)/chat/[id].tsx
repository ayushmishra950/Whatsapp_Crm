import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Bubble, Composer, DayLabel, copyText, messageActions, showActionMenu, type Message } from '@/components/chat';
import { StatusSelect } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Button, Field, IconButton, Input, Loader, Select, Sheet, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { displayName, contactHandle } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, F, S } from '@/theme';

/** One WhatsApp chat: messages (live), reply / template / note, assign, resolve, bot */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { session, epoch } = useAuth();
  const { reload: reloadCounts } = useCounts();
  const me = session?.user._id || '';
  const isAdmin = session?.user.role === 'admin';
  const headerHeight = useHeaderHeight();
  const [conv, setConv] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [seed, setSeed] = useState<{ n: number; text: string } | null>(null);
  const [editing, setEditing] = useState<{ m: Message; text: string } | null>(null);
  const [panel, setPanel] = useState<'assign' | 'status' | null>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([api(`/conversations/${id}`), api<Message[]>(`/conversations/${id}/messages`, { query: { limit: 50 } })])
        .then(([{ conversation, contact: ct }, msgs]) => {
          setConv(conversation);
          setContact(ct);
          setMessages(msgs);
          setHasOlder(msgs.length === 50);
          if (conversation.unreadCount > 0) api(`/conversations/${id}/read`, { method: 'POST' }).then(reloadCounts).catch(() => {});
        })
        .catch((err) => {
          toast.error(err);
          router.back();
        })
        .finally(() => setLoading(false)),
    [id, toast, reloadCounts]
  );
  useEffect(() => {
    load();
    api('/team').then(setTeam).catch(() => {});
  }, [load, epoch]);

  const loadOlder = async () => {
    const older = await api<Message[]>(`/conversations/${id}/messages`, { query: { before: messages[0]?.createdAt, limit: 50 } });
    setMessages((m) => [...older, ...m]);
    setHasOlder(older.length === 50);
  };

  const applyUpdate = (u: Message) => setMessages((list) => list.map((x) => (x._id === u._id ? { ...x, ...u } : x)));
  useSocketEvent('message:new', ({ message, conversation }) => {
    if (conversation._id !== id) return;
    setMessages((m) => (m.some((x) => x._id === message._id) ? m : [...m, message]));
    setConv(conversation);
    if (message.direction === 'inbound') api(`/conversations/${id}/read`, { method: 'POST' }).catch(() => {});
  }, epoch);
  useSocketEvent('message:status', ({ messageId, conversationId, status, error }) => {
    if (conversationId === id) setMessages((m) => m.map((x) => (x._id === messageId ? { ...x, status, error } : x)));
  }, epoch);
  useSocketEvent('message:updated', (u) => u.conversationId === id && applyUpdate(u), epoch);
  useSocketEvent('conversation:updated', (c) => {
    if (c._id !== id) return;
    if (!isAdmin && c.assignedTo?._id && c.assignedTo._id !== me) {
      toast.info('This chat was assigned to another counsellor');
      router.back();
      return;
    }
    setConv(c);
  }, epoch);

  const patch = async (body: any, msg?: string) => {
    try {
      const c = await api(`/conversations/${id}`, { method: 'PATCH', body });
      setConv(c);
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(err);
    }
  };
  const bot = async (action: 'stop' | 'restart') => {
    setBusy(true);
    try {
      setConv(await api(`/conversations/${id}/bot`, { method: 'POST', body: { action } }));
      toast.success(action === 'stop' ? 'You took over this chat. The bot is off here.' : 'Chat handed to the bot. Menu sent.');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (leadStatus: string) => {
    try {
      setContact(await api(`/contacts/${contact._id}`, { method: 'PATCH', body: { leadStatus } }));
      toast.success('Lead status updated');
      setPanel(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const onLongPress = (m: Message) =>
    showActionMenu('Message', messageActions(m, { me, isAdmin, windowOpen: !!conv?.windowOpen }), async (key) => {
      if (key === 'reply') setReplyTo(m);
      if (key === 'copy') copyText(m).then(() => toast.success('Copied'));
      if (key === 'correct') {
        setReplyTo(m);
        setSeed({ n: Date.now(), text: m.text });
      }
      if (key === 'edit') setEditing({ m, text: m.text });
      if (key === 'delete') {
        const note = m.direction === 'internal';
        const ok = await confirm(
          note ? 'Delete this note?' : m.sentBy?._id === me ? 'Delete this message?' : 'Hide this message?',
          note ? 'The note is removed for your whole team.' : 'It is removed from the CRM. WhatsApp can not unsend: the customer still has it.',
          { ok: note || m.sentBy?._id === me ? 'Delete' : 'Hide', danger: true }
        );
        if (!ok) return;
        try {
          applyUpdate(await api(`/conversations/${id}/messages/${m._id}`, { method: 'DELETE' }));
        } catch (err) {
          toast.error(err);
        }
      }
    });

  const saveNote = async () => {
    if (!editing) return;
    try {
      applyUpdate(await api(`/conversations/${id}/messages/${editing.m._id}`, { method: 'PATCH', body: { text: editing.text } }));
      setEditing(null);
      toast.success('Note updated');
    } catch (err) {
      toast.error(err);
    }
  };

  const menu = () =>
    showActionMenu(displayName(contact), [
      { key: 'lead', label: '👤 Lead page (details, history, fees)' },
      { key: 'status', label: '🏷 Change lead status' },
      { key: 'assign', label: '👥 Assign to…' },
      conv?.status === 'resolved' ? { key: 'reopen', label: '↩ Reopen chat' } : { key: 'resolve', label: '✅ Resolve chat' },
      conv?.status === 'pending' ? { key: 'reopen', label: '📂 Move back to Open' } : { key: 'pending', label: '⏳ Mark as pending (waiting on customer)' },
      conv?.bot?.active ? { key: 'stop', label: '✋ Take over from bot' } : { key: 'restart', label: '🤖 Hand to bot (send menu)' },
    ], (k) => {
      if (k === 'lead') router.push(`/lead/${contact._id}`);
      if (k === 'status') setPanel('status');
      if (k === 'assign') setPanel('assign');
      if (k === 'resolve') patch({ status: 'resolved' }, 'Chat resolved');
      if (k === 'reopen') patch({ status: 'open' }, 'Chat is open');
      if (k === 'pending') patch({ status: 'pending' }, 'Moved to Pending');
      if (k === 'stop') bot('stop');
      if (k === 'restart') {
        if (!conv?.windowOpen) return toast.error('24-hour window closed: the bot can only answer when the customer writes.');
        bot('restart');
      }
    });

  // Newest at the bottom: the list is inverted, so feed it newest-first
  const rows = useMemo(() => {
    const out: { key: string; m?: Message; day?: string }[] = [];
    messages.forEach((m, i) => {
      if (i === 0 || new Date(m.createdAt).toDateString() !== new Date(messages[i - 1].createdAt).toDateString()) out.push({ key: `d-${m._id}`, day: m.createdAt });
      out.push({ key: m._id, m });
    });
    return out.reverse();
  }, [messages]);

  if (loading || !conv) return <Loader />;
  const name = displayName(contact);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.chat }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => router.push(`/lead/${contact._id}`)} style={{ alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start' }}>
              <Text style={{ fontWeight: '700', fontSize: F.md, color: C.text }} numberOfLines={1}>{name}</Text>
              <Text style={{ fontSize: 11, color: conv.channel === 'instagram' ? '#be185d' : C.muted }} numberOfLines={1}>{conv.channel === 'instagram' ? 'Instagram' : 'WhatsApp'} · {contactHandle(contact)} · {conv.assignedTo?.name || (conv.bot?.active ? 'Bot' : 'Unassigned')}</Text>
            </Pressable>
          ),
          headerRight: () => <IconButton name="ellipsis-horizontal-circle" onPress={menu} color={C.brand700} label="Chat options" />,
        }}
      />
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: S.md }}
        renderItem={({ item }) => (item.day ? <DayLabel date={item.day} /> : <Bubble m={item.m} contactName={contact?.name} onLongPress={onLongPress} />)}
        ListFooterComponent={hasOlder ? <View style={{ alignItems: 'center', padding: 8 }}><Button size="sm" variant="secondary" title="Load older messages" onPress={loadOlder} /></View> : null}
        keyboardShouldPersistTaps="handled"
      />
      {conv.bot?.active ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.violet50, padding: S.sm, paddingHorizontal: S.md, borderTopWidth: 1, borderTopColor: '#ddd6fe' }}>
          <T v="small" style={{ flex: 1, color: C.violet }}>🤖 Chatbot is handling this chat. Sending a reply stops the bot.</T>
          <Button size="sm" variant="secondary" title="Take over" icon="hand-left-outline" loading={busy} onPress={() => bot('stop')} />
        </View>
      ) : null}
      <View style={{ paddingBottom: Platform.OS === 'ios' ? 20 : 8, backgroundColor: '#fff' }}>
        <Composer
          key={`${id}:${seed?.n || 0}`}
          initialText={seed?.text}
          conversation={conv}
          contact={contact}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={(m) => setMessages((list) => (list.some((x) => x._id === m._id) ? list : [...list, m]))}
        />
      </View>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit note" footer={<><Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} /><Button title="Save" onPress={saveNote} disabled={!editing?.text.trim()} /></>}>
        <Input multiline value={editing?.text || ''} onChangeText={(text) => editing && setEditing({ ...editing, text })} />
      </Sheet>
      <Sheet open={panel === 'assign'} onClose={() => setPanel(null)} title="Assign chat to">
        <Field label="Counsellor">
          <Select
            value={conv.assignedTo?._id || ''}
            onChange={(v) => { patch({ assignedTo: v || null }, v ? 'Chat assigned' : 'Chat unassigned'); setPanel(null); }}
            options={[{ value: '', label: 'Unassigned' }, ...team.filter((t) => t.isActive !== false).map((t) => ({ value: t._id, label: t._id === me ? `${t.name} (me)` : t.name }))]}
            title="Assign to"
          />
        </Field>
      </Sheet>
      <Sheet open={panel === 'status'} onClose={() => setPanel(null)} title="Lead status">
        <StatusSelect value={contact?.leadStatus || ''} onChange={setStatus} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
