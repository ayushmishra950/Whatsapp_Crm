import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_URL, api, tokens } from '@/lib/api';
import { downloadAndShare } from '@/lib/files';
import { appendFile, pickDocument, pickMedia, takePhoto, type PickedFile } from '@/lib/upload';
import { fmtTime } from '@/lib/format';
import { fitVariableDefaults, paramsForContact, renderBody, type Template } from '@/lib/templates';
import { C, F, R, S } from '@/theme';
import { showActionMenu } from './action-menu';
import { useToast } from './toast';
import { Button, Field, Input, Select, Sheet, T } from './ui';

export { showActionMenu };

export type Message = any;

export const messageSnippet = (m?: Message) => {
  if (!m) return '';
  if (m.deletedAt) return '🚫 Message deleted';
  if (m.text) return m.text;
  if (m.type === 'template') return `📋 ${m.template?.name || 'Template'}`;
  if (m.media) return `📎 ${m.media.caption || m.media.fileName || m.type}`;
  return m.type;
};
export const authorOf = (m: Message, contactName?: string) => {
  if (!m) return '';
  if (m.direction === 'inbound') return contactName || 'Customer';
  if (m.isBot) return '🤖 Bot';
  if (m.automation?.kind) return m.automation.kind === 'followup' ? '⏰ Follow-up' : `⚡ ${m.automation.name || 'Drip'}`;
  return m.sentBy?.name || 'You';
};

const STATUS_ICON: Record<string, [React.ComponentProps<typeof Ionicons>['name'], string]> = {
  queued: ['time-outline', C.faint],
  sent: ['checkmark', C.faint],
  delivered: ['checkmark-done', C.faint],
  read: ['checkmark-done', '#0ea5e9'],
  failed: ['alert-circle', C.red],
};

function Media({ m }: { m: Message }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const media = m.media || {};
  // Cloud storage gives a full https:// link; files kept on the server are /uploads/…
  const local = media.url ? (/^https?:\/\//.test(media.url) ? media.url : `${API_URL}${media.url}`) : null;
  const remote = `${API_URL}/api/media/${m._id}`;
  const uri = local || remote;
  // The login goes only to our own server, never to cloud storage
  const headers = uri.startsWith(API_URL) ? { Authorization: `Bearer ${tokens.get() || ''}` } : undefined;
  if (media.removed) {
    return (
      <View style={styles.media}>
        <Ionicons name="trash-outline" size={16} color={C.muted} />
        <Text style={{ flex: 1, fontSize: F.sm, color: C.muted, fontStyle: 'italic' }} numberOfLines={1}>{media.fileName || m.type} — file removed by admin</Text>
      </View>
    );
  }
  if (m.type === 'image') {
    return <Image source={{ uri, headers }} style={{ width: 220, height: 220, borderRadius: R.sm, backgroundColor: C.soft }} contentFit="cover" />;
  }
  const open = async () => {
    setBusy(true);
    try {
      await downloadAndShare(media.url || `/media/${m._id}`, media.fileName || `${m.type}-${m._id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const icon = m.type === 'video' ? 'videocam' : m.type === 'audio' ? 'musical-notes' : 'document-text';
  return (
    <Pressable onPress={open} style={styles.media}>
      <Ionicons name={icon} size={18} color={C.text2} />
      <Text style={{ flex: 1, fontSize: F.sm, color: C.text2 }} numberOfLines={1}>{busy ? 'Opening…' : media.fileName || m.type}</Text>
      <Ionicons name="download-outline" size={16} color={C.muted} />
    </Pressable>
  );
}

function Quote({ m, contactName }: { m: Message; contactName?: string }) {
  return (
    <View style={styles.quote}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: C.brand700 }}>{authorOf(m, contactName)}</Text>
      <Text style={{ fontSize: 12, color: C.text2 }} numberOfLines={2}>{messageSnippet(m)}</Text>
    </View>
  );
}

/** One chat bubble (customer / us / internal note), like WhatsApp */
export function Bubble({ m, contactName, onLongPress }: { m: Message; contactName?: string; onLongPress?: (m: Message) => void }) {
  const out = m.direction === 'outbound';
  const note = m.direction === 'internal';
  const hidden = !!m.deletedAt;
  if (note) {
    return (
      <Pressable onLongPress={() => onLongPress?.(m)} style={styles.note}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: '#b45309', marginBottom: 2 }}>
          {m.isBot ? '🤖 Auto update' : `📝 Note · ${m.sentBy?.name || ''}`} · {fmtTime(m.createdAt)}
        </Text>
        <Text style={{ fontSize: F.sm, color: hidden ? C.faint : C.amber900, fontStyle: hidden ? 'italic' : 'normal' }} selectable>
          {hidden ? `Note deleted by ${m.deletedBy?.name || 'a team member'}` : m.text}
        </Text>
      </Pressable>
    );
  }
  const sender = out ? (m.isBot ? '🤖 Bot' : m.automation?.kind ? (m.automation.kind === 'followup' ? '⏰ Follow-up' : `⚡ ${m.automation.name}`) : m.sentBy?.name || '') : '';
  const [icon, color] = STATUS_ICON[m.status] || [null, ''];
  return (
    <View style={{ alignItems: out ? 'flex-end' : 'flex-start', marginBottom: m.customerReaction?.emoji ? 14 : 0 }}>
      <Pressable onLongPress={() => onLongPress?.(m)} style={[styles.bubble, out ? styles.out : styles.in]}>
        {hidden ? (
          <Text style={{ color: C.faint, fontStyle: 'italic' }}>🚫 {m.deletedBy?._id && m.deletedBy._id === m.sentBy?._id ? 'Message deleted' : `Hidden by ${m.deletedBy?.name || 'admin'}`}</Text>
        ) : (
          <>
            {m.replyTo ? <Quote m={m.replyTo} contactName={contactName} /> : null}
            {m.type === 'template' ? <Text style={styles.meta}>📋 {m.template?.name}</Text> : null}
            {['image', 'video', 'audio', 'document'].includes(m.type) ? <Media m={m} /> : null}
            {m.referral?.sourceId ? (
              <View style={styles.ad}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.violet }}>📣 From ad: {m.referral.headline || m.referral.sourceId}</Text>
                {m.referral.body ? <Text style={{ fontSize: 12, color: C.violet }} numberOfLines={2}>{m.referral.body}</Text> : null}
              </View>
            ) : null}
            {m.direction === 'inbound' && m.interactive?.replyId ? <Text style={styles.meta}>👆 Tapped option</Text> : null}
            {m.text || m.media?.caption ? <Text style={{ fontSize: F.md, color: C.text }} selectable>{m.text || m.media?.caption}</Text> : null}
            {m.type === 'interactive' && m.interactive?.options?.length ? (
              <View style={{ marginTop: 6, gap: 4 }}>
                {m.interactive.kind !== 'buttons' ? <Text style={{ fontSize: 12, fontWeight: '600', color: '#0369a1' }}>☰ {m.interactive.buttonLabel || 'View options'}</Text> : null}
                {m.interactive.options.map((o: any, i: number) => (
                  <Text key={o.id || i} style={m.interactive.kind === 'buttons' ? styles.optBtn : { fontSize: 12, color: C.text2 }}>
                    {m.interactive.kind === 'buttons' ? o.title : `${i + 1}. ${o.title}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
          {sender ? <Text style={{ fontSize: 10, color: m.isBot ? C.violet : m.automation?.kind ? '#b45309' : C.faint }} numberOfLines={1}>{sender} ·</Text> : null}
          <Text style={{ fontSize: 10, color: C.faint }}>{fmtTime(m.createdAt)}</Text>
          {out && !hidden && icon ? <Ionicons name={icon} size={13} color={color} /> : null}
        </View>
        {!hidden && m.status === 'failed' && m.error ? <Text style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{m.error}</Text> : null}
        {!hidden && m.customerReaction?.emoji ? <Text style={[styles.reaction, out ? { right: 8 } : { left: 8 }]}>{m.customerReaction.emoji}</Text> : null}
      </Pressable>
    </View>
  );
}

/** Day separator */
export const DayLabel = ({ date }: { date: string }) => (
  <View style={{ alignItems: 'center', marginVertical: 8 }}>
    <Text style={styles.day}>{new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
  </View>
);

/** Long-press menu on a message: reply, copy, note edit/delete, delete / hide */
export function messageActions(m: Message, { me, isAdmin, windowOpen }: { me: string; isAdmin: boolean; windowOpen: boolean }) {
  if (m.deletedAt) return [];
  const note = m.direction === 'internal';
  const own = m.sentBy?._id === me;
  const list: { key: string; label: string; danger?: boolean }[] = [];
  if (!note && (m.waMessageId || m.igMessageId) && m.status !== 'failed') list.push({ key: 'reply', label: 'Reply' });
  if (m.text || m.media?.caption) list.push({ key: 'copy', label: 'Copy text' });
  if (note && (own || isAdmin)) {
    list.push({ key: 'edit', label: 'Edit note' });
    list.push({ key: 'delete', label: 'Delete note', danger: true });
  }
  if (!note && m.direction === 'outbound' && own) {
    if (m.type === 'text' && (m.waMessageId || m.igMessageId) && m.status !== 'failed' && windowOpen) list.push({ key: 'correct', label: 'Send correction' });
    const within = m.status === 'failed' || Date.now() - new Date(m.createdAt).getTime() <= 48 * 3600 * 1000;
    if (isAdmin || within) list.push({ key: 'delete', label: 'Delete', danger: true });
  } else if (!note && isAdmin) {
    list.push({ key: 'delete', label: 'Hide from CRM', danger: true });
  }
  return list;
}

export const copyText = async (m: Message) => Clipboard.setStringAsync(m.text || m.media?.caption || '');

/** Reply box: reply / internal note, template button (also when the 24h window is closed) */
export function Composer({ conversation, contact, onSent, replyTo, onCancelReply, initialText = '' }: { conversation: any; contact: any; onSent: (m: Message) => void; replyTo?: Message | null; onCancelReply: () => void; initialText?: string }) {
  const toast = useToast();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const windowOpen = !!conversation.windowOpen;
  const realMode = replyTo ? 'reply' : mode;
  const canType = realMode === 'note' || windowOpen;
  // Instagram chat: no templates, Instagram's own file rules
  const instagram = conversation.channel === 'instagram';

  // Photo / camera / document (only inside the 24-hour window, like the web)
  const attach = () =>
    showActionMenu('Send a file', [{ key: 'media', label: '🖼 Photo or video' }, { key: 'camera', label: '📷 Take a photo' }, { key: 'doc', label: instagram ? '📄 PDF document' : '📄 Document (PDF, Word…)' }], async (k) => {
      try {
        const f = k === 'media' ? await pickMedia() : k === 'camera' ? await takePhoto() : await pickDocument(instagram ? 'instagram' : 'whatsapp');
        if (f) {
          const app = instagram ? 'Instagram' : 'WhatsApp';
          const maxFile = instagram ? 25 : 16;
          const maxPhoto = instagram ? 8 : 5;
          if (f.size && f.size > maxFile * 1024 * 1024) return toast.error(`File is too big (${app} allows up to ${maxFile} MB).`);
          if (f.mimeType.startsWith('image/') && f.size && f.size > maxPhoto * 1024 * 1024) return toast.error(`Photo is too big (${app} allows up to ${maxPhoto} MB).`);
          setFile(f);
        }
      } catch (err) {
        toast.error(err);
      }
    });

  const send = async () => {
    if ((!text.trim() && !file) || busy) return;
    setBusy(true);
    try {
      let m;
      if (file && realMode === 'reply') {
        const form = new FormData();
        appendFile(form, 'file', file);
        form.append('caption', text.trim());
        if (replyTo?._id) form.append('replyToId', replyTo._id);
        m = await api(`/conversations/${conversation._id}/messages`, { method: 'POST', form });
      } else {
        const body = realMode === 'note' ? { type: 'note', text: text.trim() } : { type: 'text', text: text.trim(), replyToId: replyTo?._id };
        m = await api(`/conversations/${conversation._id}/messages`, { method: 'POST', body });
      }
      onSent(m);
      setText('');
      setFile(null);
      onCancelReply();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.composer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Pressable onPress={() => setMode('reply')} style={[styles.modeBtn, realMode === 'reply' && { backgroundColor: C.brand50 }]}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: realMode === 'reply' ? C.brand700 : C.muted }}>Reply</Text>
        </Pressable>
        <Pressable onPress={() => { setMode('note'); onCancelReply(); }} style={[styles.modeBtn, realMode === 'note' && { backgroundColor: C.amber50 }]}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: realMode === 'note' ? C.amber : C.muted }}>📝 Internal note</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {realMode === 'reply' ? <Text style={{ fontSize: 11, color: windowOpen ? C.faint : C.amber }}>{windowOpen ? '24h window open' : instagram ? '🔒 Window closed — wait for the customer' : '🔒 Window closed — send a template'}</Text> : null}
      </View>
      {replyTo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <View style={{ flex: 1 }}><Quote m={replyTo} contactName={contact?.name} /></View>
          <Pressable onPress={onCancelReply} hitSlop={8}><Ionicons name="close" size={18} color={C.muted} /></Pressable>
        </View>
      ) : null}
      {file && realMode === 'reply' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.soft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 }}>
          <Ionicons name={file.mimeType.startsWith('image/') ? 'image' : file.mimeType.startsWith('video/') ? 'videocam' : 'document-attach'} size={16} color={C.text2} />
          <Text style={{ flex: 1, fontSize: 13, color: C.text2 }} numberOfLines={1}>{file.name}</Text>
          {busy ? (
            <Text style={{ fontSize: 11, color: C.brand700, fontWeight: '600' }}>Sending…</Text>
          ) : (
            <>
              <Text style={{ fontSize: 11, color: C.muted }}>add a caption below (optional)</Text>
              <Pressable onPress={() => setFile(null)} hitSlop={8} accessibilityLabel="Remove file"><Ionicons name="close" size={16} color={C.muted} /></Pressable>
            </>
          )}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {realMode === 'reply' && windowOpen ? (
          <Pressable onPress={attach} disabled={busy} style={[styles.round, busy && { opacity: 0.5 }]} accessibilityLabel="Attach a file">
            <Ionicons name="attach" size={20} color={C.text2} />
          </Pressable>
        ) : null}
        {realMode === 'reply' && !instagram ? (
          <Pressable onPress={() => setTemplateOpen(true)} disabled={busy} style={[styles.round, !windowOpen && { backgroundColor: C.brand600 }, busy && { opacity: 0.5 }]} accessibilityLabel="Send template">
            <Ionicons name="document-text" size={18} color={windowOpen ? C.text2 : '#fff'} />
          </Pressable>
        ) : null}
        <TextInput
          value={text}
          onChangeText={setText}
          editable={canType && !busy}
          multiline
          placeholder={realMode === 'note' ? 'Private note for your team…' : windowOpen ? (file ? 'Caption (optional)…' : instagram ? 'Reply on Instagram…' : 'Type a message…') : instagram ? 'Instagram allows replies only within 24 h of their message' : 'Free replies are locked. Use a template.'}
          placeholderTextColor={C.faint}
          style={[styles.textbox, realMode === 'note' && { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }, !canType && { backgroundColor: C.soft }]}
        />
        <Pressable
          onPress={send}
          disabled={!canType || (!text.trim() && !file) || busy}
          style={[styles.round, { backgroundColor: canType && (text.trim() || file) ? C.brand600 : C.border }, busy && { opacity: 0.7 }]}
          accessibilityLabel={busy ? 'Sending' : 'Send'}
          accessibilityState={{ disabled: busy, busy }}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={17} color="#fff" />}
        </Pressable>
      </View>
      {templateOpen && (
        <TemplateSheet
          conversationId={conversation._id}
          contact={contact}
          replyTo={replyTo}
          onClose={() => setTemplateOpen(false)}
          onSent={(m) => { onSent(m); setTemplateOpen(false); onCancelReply(); }}
        />
      )}
    </View>
  );
}

/** Pick an approved template, fill its {{n}} values, preview and send */
export function TemplateSheet({ conversationId, contact, replyTo, onClose, onSent }: { conversationId: string; contact: any; replyTo?: Message | null; onClose: () => void; onSent: (m: Message) => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [id, setId] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Template[]>('/templates', { query: { status: 'approved' } }).then(setTemplates).catch(() => setTemplates([]));
  }, []);
  const t = useMemo(() => templates?.find((x) => x._id === id), [templates, id]);
  const choose = (v: string) => {
    setId(v);
    const tpl = templates?.find((x) => x._id === v);
    setParams(tpl ? paramsForContact(tpl, contact) : []);
  };
  const send = async () => {
    setBusy(true);
    try {
      const m = await api(`/conversations/${conversationId}/messages`, { method: 'POST', body: { type: 'template', templateId: id, params, replyToId: replyTo?._id } });
      onSent(m);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const vars = t ? fitVariableDefaults(t.variableDefaults, t.body) : [];
  return (
    <Sheet open onClose={onClose} title="Send a template message" full footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Send" icon="send" loading={busy} disabled={!t || params.some((p) => !p.trim())} onPress={send} /></>}>
      {!templates ? (
        <T v="small">Loading…</T>
      ) : !templates.length ? (
        <T v="small">No approved templates. Ask your admin to create one in Templates.</T>
      ) : (
        <>
          <Field label="Template">
            <Select value={id} onChange={choose} title="Template" options={templates.map((x) => ({ value: x._id, label: x.name, hint: `${x.category} · ${x.language}` }))} placeholder="Choose a template" />
          </Field>
          {vars.map((v, i) => (
            <Field key={i} label={`Value for {{${i + 1}}}`} hint={v.source === 'field' ? `From the contact: ${v.value}` : undefined}>
              <Input value={params[i] || ''} onChangeText={(x) => setParams((ps) => ps.map((p, j) => (j === i ? x : p)))} />
            </Field>
          ))}
          {t ? (
            <View style={{ backgroundColor: C.chat, borderRadius: R.md, padding: S.md }}>
              <View style={{ backgroundColor: '#fff', borderRadius: R.md, padding: S.md }}>
                {t.header ? <Text style={{ fontWeight: '700', marginBottom: 4 }}>{t.header}</Text> : null}
                <Text style={{ fontSize: F.md, color: C.text }}>{renderBody(t.body, params)}</Text>
                {t.footer ? <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{t.footer}</Text> : null}
                {(t.buttons || []).map((b, i) => <Text key={i} style={styles.optBtn}>{b.type === 'URL' ? '🔗 ' : b.type === 'PHONE_NUMBER' ? '📞 ' : '↩ '}{b.text}</Text>)}
              </View>
            </View>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } },
  in: { backgroundColor: '#fff', borderTopLeftRadius: 2 },
  out: { backgroundColor: C.bubbleOut, borderTopRightRadius: 2 },
  note: { alignSelf: 'center', maxWidth: '92%', backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 8, padding: 8, marginVertical: 4 },
  meta: { fontSize: 11, fontWeight: '600', color: C.muted, marginBottom: 2 },
  media: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 6, padding: 8, minWidth: 180 },
  quote: { borderLeftWidth: 4, borderLeftColor: C.brand500, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4 },
  ad: { borderWidth: 1, borderColor: '#ddd6fe', backgroundColor: C.violet50, borderRadius: 6, padding: 6, marginBottom: 4 },
  optBtn: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#0369a1', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 6, paddingVertical: 6, marginTop: 4 },
  reaction: { position: 'absolute', bottom: -12, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 4, fontSize: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  day: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, fontSize: 11, color: C.muted, overflow: 'hidden' },
  composer: { backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingHorizontal: S.md, paddingTop: S.sm },
  modeBtn: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  textbox: { flex: 1, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 20, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, maxHeight: 120, fontSize: F.md, color: C.text, backgroundColor: '#fff' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' },
});
