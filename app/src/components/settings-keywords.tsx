import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useLeadStatuses } from '@/lib/business';
import { C, R, S } from '@/theme';
import { PickChip, TagInput, toggleIn } from './drips-shared';
import { Note } from './settings-forms';
import { useToast } from './toast';
import { Button, Field, IconButton, Input, Row, Select, Sheet, T, Toggle, confirm } from './ui';

/** Same shape as the server's PUT /settings/automation-rules */
export type KeywordRule = {
  name: string;
  enabled?: boolean;
  keywords: string[];
  onlyIfStatusIn: string[];
  setStatus: string;
  addTags: string[];
  alert: boolean;
  task: string;
};

const blank = (): KeywordRule => ({ name: '', enabled: true, keywords: [], onlyIfStatusIn: [], setStatus: '', addTags: [], alert: false, task: '' });

/** Short line for the Settings row */
export const keywordRulesSummary = (rules?: KeywordRule[]) => {
  const list = rules || [];
  if (!list.length) return 'Hot words & objections → status, tag, alert, task';
  const on = list.filter((r) => r.enabled !== false).length;
  return `${list.length} rule(s) · ${on} on · ${list.slice(0, 3).map((r) => r.name).join(', ')}${list.length > 3 ? '…' : ''}`;
};

/** A3/A4: words in a customer's message → status / tags / alert / task (admin) */
export function KeywordRulesSheet({ initial, onClose, onSaved }: { initial?: KeywordRule[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const { list: statuses } = useLeadStatuses();
  const [rules, setRules] = useState<KeywordRule[]>(() => (initial || []).map((r) => ({ ...blank(), ...r })));
  const [saving, setSaving] = useState(false);
  const setRule = (i: number, patch: Partial<KeywordRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const invalid = rules.some((r) => !r.name?.trim() || !r.keywords?.length);

  const remove = async (i: number) => {
    const r = rules[i];
    if ((r.name || r.keywords.length) && !(await confirm('Delete this rule?', `"${r.name || 'Unnamed rule'}" is removed when you save.`, { ok: 'Delete', danger: true }))) return;
    setRules((rs) => rs.filter((_, j) => j !== i));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api('/settings/automation-rules', {
        method: 'PUT',
        body: {
          rules: rules.map(({ name, enabled, keywords, onlyIfStatusIn, setStatus, addTags, alert, task }) => ({
            name: name.trim(),
            enabled: enabled !== false,
            keywords,
            onlyIfStatusIn,
            setStatus,
            addTags,
            alert,
            task: task.trim(),
          })),
        },
      });
      toast.success('Keyword rules saved');
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Keyword rules (hot words & objections)"
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Save rules" loading={saving} disabled={invalid} onPress={save} />
        </>
      }>
      <Note>Words in a customer&apos;s message change the status, add a tag, alert the team or create a task. Checked on every message.</Note>
      {!rules.length ? <T v="small">No rules yet. Example: “join, admission, fees jama” → Interested – Hot + alert.</T> : null}
      {rules.map((r, i) => {
        const off = r.enabled === false;
        return (
          <View key={i} style={{ gap: S.md, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md, backgroundColor: off ? C.soft : '#fff', opacity: off ? 0.75 : 1 }}>
            <Row gap={S.sm}>
              <Input style={{ flex: 1, fontWeight: '600' }} maxLength={60} value={r.name} placeholder="Rule name, e.g. Hot words" onChangeText={(name) => setRule(i, { name })} accessibilityLabel="Rule name" />
              <IconButton name="trash-outline" color={C.red} label="Delete rule" onPress={() => remove(i)} />
            </Row>
            <Toggle value={!off} onChange={(v) => setRule(i, { enabled: v })} label="Rule is on" />
            <Field label="When the customer writes any of" hint="Whole words or phrases, comma or Enter between them" error={!r.keywords.length ? 'Add at least one keyword' : undefined}>
              <TagInput lower value={r.keywords} onChange={(keywords) => setRule(i, { keywords })} placeholder="e.g. join, fees jama" />
            </Field>
            <Field label="Only if the lead is (none = any status)">
              <Row wrap gap={6}>
                {statuses.map((s) => <PickChip key={s.key} label={s.label} on={r.onlyIfStatusIn.includes(s.key)} onPress={() => setRule(i, { onlyIfStatusIn: toggleIn(r.onlyIfStatusIn, s.key) })} />)}
              </Row>
            </Field>
            <Field label="Move to status">
              <Select value={r.setStatus} title="Move to status" onChange={(setStatus) => setRule(i, { setStatus })} options={[{ value: '', label: "Don't change" }, ...statuses.map((s) => ({ value: s.key, label: s.label }))]} />
            </Field>
            <Field label="Add tags">
              <TagInput lower value={r.addTags} onChange={(addTags) => setRule(i, { addTags: addTags.slice(0, 10) })} placeholder="e.g. objection-price" />
            </Field>
            <Field label="Create a task (due in 15 min)">
              <Input maxLength={120} value={r.task} placeholder="e.g. Hot lead – call now" onChangeText={(task) => setRule(i, { task })} />
            </Field>
            <Toggle value={r.alert} onChange={(alert) => setRule(i, { alert })} label="🔔 Alert counsellor + admins" />
            {!r.setStatus && !r.addTags.length && !r.alert && !r.task.trim() ? <T v="tiny" style={{ color: C.amber }}>Choose a status, tag, alert or task, else this rule does nothing.</T> : null}
          </View>
        );
      })}
      <Button variant="secondary" size="sm" icon="add" title="Add rule" disabled={rules.length >= 30} style={{ alignSelf: 'flex-start' }} onPress={() => setRules((rs) => [...rs, blank()])} />
    </Sheet>
  );
}
