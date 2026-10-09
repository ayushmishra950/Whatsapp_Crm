import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useLeadStatuses, CALL_OUTCOMES } from '@/lib/business';
import { useCourses } from '@/lib/courses';
import { C, S } from '@/theme';
import { DateField } from './date-field';
import { useToast } from './toast';
import { Button, Chip, Field, Input, Row, Select, Sheet, T, type Option } from './ui';

/** Course list (searchable) for coaching businesses */
export function CourseSelect({ value, onChange, placeholder = 'No course' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { list } = useCourses();
  const options: Option[] = [{ value: '', label: 'No course' }, ...list.filter((c) => c.active !== false || c.code === value).map((c) => ({ value: c.code, label: c.name, hint: c.code }))];
  return <Select value={value || ''} options={options} onChange={onChange} placeholder={placeholder} title="Course" />;
}

export function StatusSelect({ value, onChange, allowAll, allLabel = 'All statuses' }: { value: string; onChange: (v: string) => void; allowAll?: boolean; allLabel?: string }) {
  const { list } = useLeadStatuses();
  const options: Option[] = [...(allowAll ? [{ value: '', label: allLabel }] : []), ...list.map((s) => ({ value: s.key, label: s.label }))];
  return <Select value={value || ''} options={options} onChange={onChange} title="Lead status" />;
}

/** Call · Chat · Log call — one tap from any list */
export function LeadActions({ contact, onChanged, compact }: { contact: { _id: string; phone: string; name?: string }; onChanged?: (c?: any) => void; compact?: boolean }) {
  const toast = useToast();
  const [calling, setCalling] = useState(false);
  const chat = async () => {
    try {
      const conv = await api<{ _id: string }>('/conversations/start', { method: 'POST', body: { contactId: contact._id } });
      router.push(`/chat/${conv._id}`);
    } catch (err) {
      toast.error(err);
    }
  };
  const size = compact ? 'sm' : 'md';
  return (
    <Row gap={6} wrap>
      {contact.phone ? <Button size={size} variant="secondary" icon="call" title="Call" onPress={() => Linking.openURL(`tel:+${contact.phone}`)} /> : null}
      <Button size={size} variant="secondary" icon={contact.phone ? 'logo-whatsapp' : 'logo-instagram'} title="Chat" onPress={chat} />
      <Button size={size} variant="ghost" icon="create-outline" title="Log call" onPress={() => setCalling(true)} />
      {calling && <CallLogSheet contact={contact} onClose={() => setCalling(false)} onSaved={(c) => onChanged?.(c)} />}
    </Row>
  );
}

const QUICK: [string, () => Date][] = [
  ['Later today (5 pm)', () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d > new Date() ? d : at(1); }],
  ['Tomorrow 11 am', () => at(1)],
  ['In 3 days', () => at(3)],
  ['Next week', () => at(7)],
];
function at(days: number, hh = 11) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hh, 0, 0, 0);
  return d;
}

/** After a call: outcome, note, new status, next call */
export function CallLogSheet({ contact, onClose, onSaved }: { contact: { _id: string; name?: string; phone: string; leadStatus?: string }; onClose: () => void; onSaved?: (c: any) => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('connected');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [nextAt, setNextAt] = useState<Date | null>(null);
  const [nextTitle, setNextTitle] = useState('Call again');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const c = await api(`/contacts/${contact._id}/calls`, { method: 'POST', body: { outcome, note, ...(status && { leadStatus: status }), ...(nextAt && { nextAt: nextAt.toISOString(), nextTitle }) } });
      toast.success('Call saved');
      onSaved?.(c);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={`Log call · ${contact.name || `+${contact.phone}`}`} footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Save call" loading={busy} onPress={save} /></>}>
      <Field label="What happened">
        <Row wrap gap={6}>
          {CALL_OUTCOMES.map(([v, l]) => <Chip key={v} label={l} active={outcome === v} onPress={() => setOutcome(v)} />)}
        </Row>
      </Field>
      <Field label="Note"><Input multiline value={note} onChangeText={setNote} placeholder="What they said, what you promised…" /></Field>
      <Field label="New lead status (optional)"><StatusSelect value={status} onChange={setStatus} allowAll allLabel="Keep the same status" /></Field>
      <Field label="Next call / follow-up (optional)">
        <Row wrap gap={6}>
          {QUICK.map(([l, fn]) => <Chip key={l} label={l} onPress={() => setNextAt(fn())} />)}
        </Row>
        <DateField value={nextAt} onChange={setNextAt} clearable placeholder="Pick date & time" />
      </Field>
      {nextAt ? <Field label="What to do next"><Input value={nextTitle} onChangeText={setNextTitle} maxLength={120} /></Field> : null}
    </Sheet>
  );
}

/** "Done! Next follow-up?" — one tap for the usual times; creates a task for the same lead */
export function NextFollowUpSheet({ contact, defaultTitle = 'Follow up', onClose }: { contact: { _id: string; name?: string; phone: string }; defaultTitle?: string; onClose: (created: boolean) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(defaultTitle);
  const [when, setWhen] = useState<Date | null>(at(1));
  const [busy, setBusy] = useState(false);
  const save = async (date: Date | null) => {
    if (!date) return;
    setBusy(true);
    try {
      await api('/tasks', { method: 'POST', body: { contactId: contact._id, title: title.trim() || 'Follow up', dueAt: date.toISOString(), kind: 'followup' } });
      toast.success(`Next follow-up: ${date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`);
      onClose(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={() => onClose(false)} title={`✅ Next follow-up for ${contact.name || `+${contact.phone}`}?`} footer={<><Button title="Not needed" variant="ghost" onPress={() => onClose(false)} /><Button title="Set follow-up" icon="calendar" loading={busy} onPress={() => save(when)} /></>}>
      <T v="small">Every open lead should have a next step, otherwise it shows in “No next action”.</T>
      <Field label="What to do"><Input value={title} onChangeText={setTitle} maxLength={120} /></Field>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {QUICK.map(([l, fn]) => (
          <Pressable key={l} disabled={busy} onPress={() => save(fn())} style={{ width: '48%', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
            <T style={{ color: C.text }}>{l}</T>
          </Pressable>
        ))}
      </View>
      <Field label="Or pick a date & time"><DateField value={when} onChange={setWhen} /></Field>
    </Sheet>
  );
}
