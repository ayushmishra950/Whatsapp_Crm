import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useIsAdmin, useIsCoaching } from '@/lib/auth';
import { displayName } from '@/lib/format';
import { C, F, R, S } from '@/theme';
import { CourseSelect } from './leads';
import { useToast } from './toast';
import { Button, Chip, Field, Input, Row, Select, Sheet, T } from './ui';

const SOURCES: [string, string][] = [
  ['walkin', '🚶 Walk-in'],
  ['call', '📞 Phone call'],
  ['referral', '🤝 Referral'],
  ['website', '🌐 Website'],
];
// 98765 43210 -> 919876543210; numbers with a country code stay as typed
const toPhone = (v: string) => {
  const d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length === 10 ? `91${d}` : d;
};
type Tpl = { _id: string; name: string; body: string; preview?: string } | null;
const EMPTY = { name: '', phone: '', course: '', language: '', note: '' };

/**
 * Walk-in / phone enquiry: name + mobile -> lead saved, welcome message goes on WhatsApp at once.
 * Stays open for the next visitor.
 */
export function WalkInSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: () => void }) {
  const toast = useToast();
  const coaching = useIsCoaching();
  const isAdmin = useIsAdmin();
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState('walkin');
  const [sendWelcome, setSendWelcome] = useState(true);
  const [welcome, setWelcome] = useState<{ en: Tpl; hi: Tpl } | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const set = (p: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    if (open) api('/contacts/quick/welcome').then(setWelcome).catch(() => setWelcome({ en: null, hi: null }));
  }, [open]);

  const phone = toPhone(form.phone);
  const phoneOk = /^\d{11,15}$/.test(phone);
  const template = form.language === 'hi' ? welcome?.hi || welcome?.en : welcome?.en || welcome?.hi;
  const first = form.name.trim().split(' ')[0] || 'Rahul';
  const preview = template ? (template.preview || template.body).replaceAll('%NAME%', first).replace(/\{\{\d+\}\}/g, '…') : '';

  const save = async () => {
    if (!form.name.trim() || !phoneOk || busy) return;
    setBusy(true);
    try {
      const r = await api('/contacts/quick', { method: 'POST', body: { ...form, phone, source, sendWelcome: sendWelcome && !!template } });
      const who = displayName(r.contact);
      toast.success(`${r.created ? 'Saved' : 'Already in CRM — updated'}: ${who}${r.welcome === 'sent' ? ' · welcome sent ✓' : ''}`);
      setLast({ ...r, who });
      setForm(EMPTY);
      onAdded?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setLast(null);
    setForm(EMPTY);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="New walk-in / enquiry" full
      footer={<><Button title="Close" variant="secondary" onPress={close} /><Button title={sendWelcome && template ? 'Save & send welcome' : 'Save'} icon="person-add" loading={busy} disabled={!form.name.trim() || !phoneOk} onPress={save} /></>}>
      {last ? (
        <View style={{ backgroundColor: C.green50, borderRadius: R.md, padding: S.md, gap: 4 }}>
          <Text style={{ color: C.brand800, fontSize: F.sm }}>
            <Text style={{ fontWeight: '700' }}>{last.who}</Text> {last.created ? 'saved' : 'was already in the CRM (updated)'}.{' '}
            {last.welcome === 'sent' ? 'Welcome sent on WhatsApp ✓' : last.welcome === 'failed' ? `Welcome NOT sent: ${last.welcomeError || 'WhatsApp error'}` : last.welcome === 'no_template' ? 'No welcome sent (no approved template).' : last.welcome === 'opted_out' ? 'Not sent: this number opted out.' : ''}
          </Text>
          <Pressable onPress={() => { close(); router.push(`/lead/${last.contact._id}`); }}>
            <Text style={{ color: C.brand700, fontWeight: '600', fontSize: F.sm }}>Open lead →</Text>
          </Pressable>
        </View>
      ) : null}
      <Row wrap gap={6}>
        {SOURCES.map(([v, l]) => <Chip key={v} label={l} active={source === v} onPress={() => setSource(v)} />)}
      </Row>
      <Field label="Name *"><Input value={form.name} onChangeText={(name) => set({ name })} placeholder="Rahul Sharma" maxLength={100} autoCapitalize="words" /></Field>
      <Field label="Mobile (WhatsApp) *" hint={form.phone && !phoneOk ? '10-digit mobile, or with country code' : phoneOk ? `WhatsApp: +${phone}` : '10-digit number gets +91'}>
        <Input value={form.phone} onChangeText={(p) => set({ phone: p })} placeholder="98765 43210" keyboardType="phone-pad" maxLength={18} />
      </Field>
      {coaching ? (
        <>
          <Field label="Course (optional)"><CourseSelect value={form.course} onChange={(course) => set({ course })} /></Field>
          <Field label="Language (optional)">
            <Select value={form.language} onChange={(language) => set({ language })} options={[{ value: '', label: 'Not sure' }, { value: 'hi', label: 'Hinglish' }, { value: 'en', label: 'English' }]} title="Language" />
          </Field>
        </>
      ) : null}
      <Field label="Note (optional)"><Input value={form.note} onChangeText={(note) => set({ note })} placeholder="Came with father, asked about weekend batch…" maxLength={500} /></Field>
      <Pressable onPress={() => setSendWelcome((s) => !s)} style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md, gap: S.sm }}>
        <Row>
          <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: sendWelcome ? C.brand600 : C.borderStrong, backgroundColor: sendWelcome ? C.brand600 : '#fff', alignItems: 'center', justifyContent: 'center' }}>
            {sendWelcome ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
          </View>
          <T style={{ fontWeight: '600', color: C.text, flex: 1 }}>Send the welcome message on WhatsApp now</T>
        </Row>
        {welcome && (template ? (
          <View style={{ backgroundColor: C.soft, borderRadius: R.sm, padding: S.sm }}>
            <T v="small">{preview}</T>
          </View>
        ) : (
          <T v="small" style={{ color: C.amber }}>No approved welcome template yet: the lead is saved, but no message goes out. {isAdmin ? 'Get “walkin_welcome” approved in Templates.' : 'Ask your admin to approve one.'}</T>
        ))}
      </Pressable>
    </Sheet>
  );
}
