import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import type { LeadStatus } from '@/lib/auth';
import { STAGES } from '@/lib/business';
import { C, R, S } from '@/theme';
import { Note } from './settings-forms';
import { useToast } from './toast';
import { Button, Chip, Field, IconButton, Input, Row, Select, Sheet, T, Toggle, confirm } from './ui';

const COLORS: [string, string, string][] = [
  ['gray', 'Gray', '#94a3b8'],
  ['blue', 'Blue', '#0ea5e9'],
  ['green', 'Green', C.brand500],
  ['yellow', 'Yellow', '#fbbf24'],
  ['red', 'Red', '#ef4444'],
  ['purple', 'Purple', '#8b5cf6'],
];
const dot = (c?: string) => COLORS.find(([k]) => k === c)?.[2] || '#94a3b8';
const UNITS: [string, string][] = [['minutes', 'minutes'], ['hours', 'hours'], ['days', 'days']];

type StatusRow = LeadStatus & { timeLimit?: { amount?: number | string; unit?: string }; onTimeout?: { moveTo?: string; task?: string; alert?: boolean } };

/** Admin edits the business's lead statuses: name, colour, stage, order, time limit */
export function LeadStatusesSheet({ initial, coaching, onClose, onSaved }: { initial: StatusRow[]; coaching: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [rows, setRows] = useState<StatusRow[]>(() => initial.map((s) => ({ ...s })));
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const setRow = (i: number, patch: Partial<StatusRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setRows((r) => {
      const n = [...r];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const removed = initial.filter((s) => !rows.some((r) => r.key === s.key));
  const statusOptions = rows.filter((x) => x.label.trim());

  const save = async () => {
    setSaving(true);
    try {
      const res = await api('/settings/lead-statuses', {
        method: 'PUT',
        body: {
          statuses: rows.map(({ key, label, color, stage, timeLimit, onTimeout }) => ({
            ...(key ? { key } : {}),
            label: label.trim(),
            color: color || 'gray',
            stage: stage || '',
            timeLimit: { amount: Number(timeLimit?.amount) || 0, unit: timeLimit?.unit || 'days' },
            onTimeout: { moveTo: onTimeout?.moveTo || '', task: onTimeout?.task || '', alert: !!onTimeout?.alert },
          })),
        },
      });
      toast.success(res.movedToNew ? `Statuses saved. ${res.movedToNew} lead(s) of removed statuses moved to "New".` : 'Lead statuses saved');
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async () => {
    const ok = await confirm(
      'Reset to the 19 playbook statuses?',
      'Your status list is replaced by the 19 playbook statuses with stages and time limits. Hot-word / objection keyword rules and the “lead came back → Hot” rule are added. Leads in a status that is not in the new list move to New.',
      { ok: 'Replace statuses', danger: true }
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await api('/settings/lead-statuses/preset', { method: 'POST', body: {} });
      toast.success(`19 statuses, keyword rules and "lead came back" rule added${res.movedToNew ? `. ${res.movedToNew} lead(s) moved to New.` : ''}`);
      setRows(res.leadStatuses);
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const limitText = (r: StatusRow) => (Number(r.timeLimit?.amount) > 0 ? `${r.timeLimit?.amount} ${r.timeLimit?.unit || 'days'}` : '');

  return (
    <Sheet open onClose={onClose} title="Lead statuses" full
      footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Save statuses" loading={saving} disabled={rows.some((r) => !r.label.trim())} onPress={save} /></>}>
      <T v="small">How you sort your leads. Tap ⏱ to put a status in a stage and give it a time limit: when it runs out the lead moves on automatically.</T>
      {coaching ? <Button title="Reset to the 19 playbook statuses" icon="sparkles-outline" variant="soft" size="sm" disabled={saving} onPress={applyPreset} /> : null}
      {rows.map((r, i) => {
        const expanded = open === i;
        const meta = [STAGES.find((st) => st.key === r.stage)?.label, limitText(r)].filter(Boolean).join(' · ');
        return (
          <View key={r.key || `new-${i}`} style={{ borderWidth: 1, borderColor: expanded ? C.brand500 : C.border, borderRadius: R.md, padding: S.sm, gap: S.sm }}>
            <Row gap={6}>
              <Pressable
                accessibilityLabel={`Colour ${r.color || 'gray'}, tap to change`}
                hitSlop={6}
                onPress={() => {
                  const k = COLORS.findIndex(([c]) => c === (r.color || 'gray'));
                  setRow(i, { color: COLORS[(k + 1) % COLORS.length][0] });
                }}
                style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: dot(r.color), borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, elevation: 1 }}
              />
              <Input style={{ flex: 1, minHeight: 38 }} maxLength={30} value={r.label} placeholder="e.g. Call back" onChangeText={(label) => setRow(i, { label })} />
              <IconButton name="timer-outline" size={20} color={expanded ? C.brand700 : C.muted} label="Stage and time limit" onPress={() => setOpen(expanded ? null : i)} />
              <IconButton name="arrow-up" size={18} color={i === 0 ? C.border : C.muted} label="Move up" onPress={() => move(i, -1)} />
              <IconButton name="arrow-down" size={18} color={i === rows.length - 1 ? C.border : C.muted} label="Move down" onPress={() => move(i, 1)} />
              <IconButton
                name="trash-outline"
                size={18}
                color={r.key === 'new' ? C.border : C.red}
                label="Remove status"
                onPress={() => (r.key === 'new' ? toast.info('New leads get this status: it can be renamed but not removed') : setRows((x) => x.filter((_, j) => j !== i)))}
              />
            </Row>
            {meta && !expanded ? <T v="tiny" style={{ marginLeft: 28 }}>⏱ {meta}</T> : null}
            {expanded ? (
              <View style={{ gap: S.sm, backgroundColor: C.soft, borderRadius: R.sm, padding: S.sm }}>
                <Field label="Colour">
                  <Row wrap gap={6}>
                    {COLORS.map(([k, l]) => <Chip key={k} label={l} active={(r.color || 'gray') === k} onPress={() => setRow(i, { color: k })} />)}
                  </Row>
                </Field>
                <Field label="Stage">
                  <Select value={r.stage || ''} title="Stage" onChange={(stage) => setRow(i, { stage })} options={[{ value: '', label: 'No stage' }, ...STAGES.map((st) => ({ value: st.key, label: st.label }))]} />
                </Field>
                <Field label="Time limit in this status" hint="0 = no limit">
                  <Row gap={S.sm}>
                    <Input
                      style={{ width: 90 }}
                      keyboardType="number-pad"
                      value={String(r.timeLimit?.amount ?? 0)}
                      onChangeText={(v) => setRow(i, { timeLimit: { unit: r.timeLimit?.unit || 'days', amount: v.replace(/[^\d]/g, '') } })}
                    />
                    <View style={{ flex: 1 }}>
                      <Select value={r.timeLimit?.unit || 'days'} title="Unit" onChange={(unit) => setRow(i, { timeLimit: { amount: r.timeLimit?.amount || 0, unit } })} options={UNITS.map(([value, label]) => ({ value, label }))} />
                    </View>
                  </Row>
                </Field>
                {Number(r.timeLimit?.amount) > 0 ? (
                  <>
                    <Field label="When time runs out, move to">
                      <Select
                        value={r.onTimeout?.moveTo || ''}
                        title="Move to"
                        onChange={(moveTo) => setRow(i, { onTimeout: { ...r.onTimeout, moveTo } })}
                        options={[{ value: '', label: 'Stay in this status' }, ...statusOptions.filter((x) => x !== r).map((x) => ({ value: x.key || x.label, label: x.label }))]}
                      />
                    </Field>
                    <Field label="…and create a task">
                      <Input maxLength={120} value={r.onTimeout?.task || ''} placeholder="e.g. Call this lead" onChangeText={(task) => setRow(i, { onTimeout: { ...r.onTimeout, task } })} />
                    </Field>
                    <Toggle value={!!r.onTimeout?.alert} onChange={(alert) => setRow(i, { onTimeout: { ...r.onTimeout, alert } })} label="🔔 Alert the counsellor and admins" />
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {removed.length ? <Note tone="amber">Removing {removed.map((s) => `“${s.label}”`).join(', ')}: leads with this status will move to the first status (“New”).</Note> : null}
      <Button title="Add status" icon="add" variant="secondary" size="sm" disabled={rows.length >= 20} onPress={() => setRows((r) => [...r, { key: '', label: '', color: 'gray' }])} style={{ alignSelf: 'flex-start' }} />
    </Sheet>
  );
}

type FieldInfo = { key: string; label: string; type?: string; options?: string[]; contacts: number; usedIn?: string[] };
type FieldRow = { key?: string; label: string; type: string; optionsText: string };
const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date', hint: 'Birthday / anniversary (used by yearly drips)' },
  { value: 'select', label: 'Dropdown', hint: 'Fixed choices' },
  { value: 'multiselect', label: 'Multi-select' },
];
const hasOptions = (t: string) => t === 'select' || t === 'multiselect';

/** Extra details kept for each lead (Course, City…): add, rename, remove */
export function ContactFieldsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [info, setInfo] = useState<{ builtin: { key: string; label: string }[]; fields: FieldInfo[]; discovered: { key: string; contacts: number }[] } | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      api('/settings/contact-fields')
        .then((r) => {
          setInfo(r);
          setRows(r.fields.map(({ key, label, type, options }: FieldInfo) => ({ key, label, type: type || 'text', optionsText: (options || []).join(', ') })));
        })
        .catch(toast.error),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load]);

  const removed = info ? info.fields.filter((f) => !rows.some((r) => r.key === f.key)) : [];
  const setRow = (i: number, patch: Partial<FieldRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const invalid = rows.some((r) => !r.label.trim() || (hasOptions(r.type) && !r.optionsText.trim()));

  const save = async () => {
    const lost = removed.reduce((n, f) => n + f.contacts, 0);
    if (lost > 0) {
      const ok = await confirm('Delete fields?', `${removed.map((f) => `“${f.label}”`).join(', ')} will be deleted, together with the values saved on ${lost} contact(s). This can not be undone.`, { ok: 'Delete and save', danger: true });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await api('/settings/contact-fields', {
        method: 'PUT',
        body: {
          fields: rows.map(({ key, label, type, optionsText }) => ({
            ...(key ? { key } : {}),
            label: label.trim(),
            type: type || 'text',
            options: hasOptions(type) ? optionsText.split(',').map((o) => o.trim()).filter(Boolean) : [],
          })),
        },
      });
      toast.success(res.removed?.length ? `Fields saved. Deleted: ${res.removed.join(', ')} (values removed from ${res.contactsUpdated} contact(s)).` : 'Contact fields saved');
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const discovered = info ? info.discovered.filter((d) => !rows.some((r) => r.label.trim().toLowerCase() === d.key.replace(/_/g, ' '))) : [];

  return (
    <Sheet open onClose={onClose} title="Contact fields" full
      footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Save fields" loading={saving} disabled={!info || invalid} onPress={save} /></>}>
      <T v="small">Extra details you keep for each lead (Course, City, Fees…). Use them in template variables, bulk campaigns and chatbot questions, and fill them on each lead.</T>
      {!info ? (
        <ActivityIndicator color={C.brand600} />
      ) : (
        <>
          {info.builtin.map((f) => (
            <Row key={f.key} gap={S.sm} style={{ backgroundColor: C.soft, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: S.sm }}>
              <Ionicons name="lock-closed-outline" size={14} color={C.faint} />
              <T v="small" style={{ flex: 1, color: C.text2 }}>{f.label}</T>
              <T v="tiny">built-in</T>
            </Row>
          ))}
          {rows.map((r, i) => {
            const stats = info.fields.find((f) => f.key === r.key);
            const used = !!stats?.usedIn?.length;
            return (
              <View key={r.key || `new-${i}`} style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.sm, gap: S.sm }}>
                <Row gap={6}>
                  <Input style={{ flex: 1, minHeight: 38 }} maxLength={40} value={r.label} placeholder="Field name, e.g. Course" onChangeText={(label) => setRow(i, { label })} />
                  <IconButton
                    name="trash-outline"
                    size={18}
                    color={used ? C.border : C.red}
                    label="Delete field"
                    onPress={() => (used ? toast.info(`Can not delete: used in ${stats?.usedIn?.join(', ')}`) : setRows((x) => x.filter((_, j) => j !== i)))}
                  />
                </Row>
                <Select value={r.type} title="Field type" onChange={(type) => setRow(i, { type })} options={FIELD_TYPES} />
                {hasOptions(r.type) ? <Input value={r.optionsText} placeholder="Options, comma separated: 10th, 12th, Graduate" onChangeText={(optionsText) => setRow(i, { optionsText })} /> : null}
                <T v="tiny">{r.key ? `${stats?.contacts || 0} contact(s) have a value` : 'New field'}</T>
                {used ? <T v="tiny" style={{ color: C.amber }}>Used in {stats?.usedIn?.join(', ')}. Remove it there first to delete this field.</T> : null}
              </View>
            );
          })}
          {discovered.length ? (
            <Note tone="blue">Found on your contacts but not in this list (e.g. from an older import). Tap to add:</Note>
          ) : null}
          {discovered.length ? (
            <Row wrap gap={6}>
              {discovered.map((d) => (
                <Chip
                  key={d.key}
                  label={`+ ${d.key.replace(/_/g, ' ')} (${d.contacts})`}
                  onPress={() => setRows((x) => [...x, { label: d.key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), type: /dob|birth|anniv/i.test(d.key) ? 'date' : 'text', optionsText: '' }])}
                />
              ))}
            </Row>
          ) : null}
          {removed.length ? (
            <Note tone="amber">Deleting {removed.map((f) => `“${f.label}”`).join(', ')} also deletes its saved values from {removed.reduce((n, f) => n + f.contacts, 0)} contact(s).</Note>
          ) : null}
          <Button title="Add field" icon="add" variant="secondary" size="sm" disabled={rows.length >= 50} onPress={() => setRows((r) => [...r, { label: '', type: 'text', optionsText: '' }])} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
    </Sheet>
  );
}
