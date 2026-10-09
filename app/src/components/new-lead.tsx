import { router } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useIsCoaching } from '@/lib/auth';
import { LANGUAGES, MANUAL_SOURCES, useLeadStatuses } from '@/lib/business';
import { DateField } from './date-field';
import { TagInput } from './tag-input';
import { CourseSelect, StatusSelect } from './leads';
import { useToast } from './toast';
import { Button, Field, Input, Select, Sheet } from './ui';

// 98765 43210 -> 919876543210; numbers with a country code stay as typed
const toPhone = (v: string) => {
  const d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length === 10 ? `91${d}` : d;
};
const EMPTY = { phone: '', name: '', email: '', leadStatus: '', course: '', language: '', source: 'manual', notes: '', followUpNote: '' };

/** Add a lead with every detail at once (the green + is the quick walk-in; this is the full form, like "Add contact" on the web) */
export function NewLeadSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: () => void }) {
  const toast = useToast();
  const coaching = useIsCoaching();
  const statuses = useLeadStatuses();
  const [form, setForm] = useState(EMPTY);
  const [followUpAt, setFollowUpAt] = useState<Date | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...p }));
  const phone = toPhone(form.phone);
  const phoneOk = /^\d{11,15}$/.test(phone);

  const close = () => {
    setForm(EMPTY);
    setFollowUpAt(null);
    setTags([]);
    onClose();
  };
  const save = async () => {
    if (!phoneOk || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        phone,
        name: form.name.trim(),
        email: form.email.trim(),
        tags,
        notes: form.notes,
        source: form.source,
        leadStatus: form.leadStatus || statuses.list[0]?.key,
        followUpAt: followUpAt ? followUpAt.toISOString() : null,
        followUpNote: followUpAt ? form.followUpNote.trim() : '',
      };
      if (coaching) {
        body.course = form.course;
        if (form.language) body.language = form.language;
      }
      if (!body.leadStatus) delete body.leadStatus;
      const c = await api('/contacts', { method: 'POST', body });
      toast.success('Lead added');
      onAdded?.();
      close();
      router.push(`/lead/${c._id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add a lead"
      full
      footer={<><Button title="Cancel" variant="secondary" onPress={close} /><Button title="Save lead" icon="checkmark" loading={busy} disabled={!phoneOk} onPress={save} /></>}>
      <Field label="WhatsApp number *" hint={form.phone && !phoneOk ? '10-digit mobile, or the number with its country code' : 'e.g. 98765 43210'} error={form.phone && !phoneOk ? ' ' : undefined}>
        <Input value={form.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" placeholder="98765 43210" autoFocus />
      </Field>
      <Field label="Name"><Input value={form.name} onChangeText={(name) => set({ name })} placeholder="Full name" /></Field>
      <Field label="Email"><Input value={form.email} onChangeText={(email) => set({ email })} keyboardType="email-address" autoCapitalize="none" /></Field>
      <Field label="Lead status"><StatusSelect value={form.leadStatus || statuses.list[0]?.key || ''} onChange={(leadStatus) => set({ leadStatus })} /></Field>
      {coaching ? (
        <>
          <Field label="Course"><CourseSelect value={form.course} onChange={(course) => set({ course })} /></Field>
          <Field label="Language"><Select value={form.language} onChange={(language) => set({ language })} title="Language" options={LANGUAGES.map(([value, label]) => ({ value, label }))} /></Field>
        </>
      ) : null}
      <Field label="Lead source"><Select value={form.source} onChange={(source) => set({ source })} title="Lead source" options={MANUAL_SOURCES.map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Tags"><TagInput value={tags} onChange={setTags} /></Field>
      <Field label="Follow-up reminder" hint="Shows on Today when due"><DateField value={followUpAt} onChange={setFollowUpAt} clearable placeholder="No follow-up" /></Field>
      {followUpAt ? <Field label="What to do"><Input value={form.followUpNote} onChangeText={(followUpNote) => set({ followUpNote })} placeholder="e.g. call about fees" /></Field> : null}
      <Field label="Notes"><Input multiline value={form.notes} onChangeText={(notes) => set({ notes })} placeholder="Anything the team should know" /></Field>
    </Sheet>
  );
}
