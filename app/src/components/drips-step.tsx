import { useState } from 'react';
import { View } from 'react-native';
import { useIsCoaching } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { fitVariableDefaults, renderBody, type Template } from '@/lib/templates';
import { C, R, S } from '@/theme';
import { DELAY_MINUTES, STEP_KINDS, TimeInput, validTime, waitText, type DripStep, type DripVar } from './drips-shared';
import { useContactFields } from './drips-shared';
import { Button, Chip, Field, Input, Row, Select, Sheet, T, type Option } from './ui';

/** {{n}} defaults of a template, as drip variables */
export const variablesFrom = (t?: Template): DripVar[] => fitVariableDefaults(t?.variableDefaults, t?.body).map(({ source, value }) => ({ source, value }));

export function stepTitle(s: DripStep, templates: Template[], statusLabel: (k?: string) => string) {
  if (s.kind === 'message') return templates.find((t) => t._id === s.templateId)?.name || 'Template not chosen';
  if (s.kind === 'status') return s.setStatus ? `Move to ${statusLabel(s.setStatus)}` : 'Status not chosen';
  return s.text || '(no text)';
}

export function stepWhen(s: DripStep, i: number, triggerType: string) {
  if (i === 0 && triggerType === 'date') return `Runs ${s.delayDays ? `${s.delayDays} day(s) after the date` : 'on the date'} at ${s.sendTime || '10:00'}.`;
  if (i === 0)
    return s.delayDays || s.delayMinutes
      ? `Runs ${waitText(s)} after the contact enters${s.sendTime ? `, at ${s.sendTime}` : ''}.`
      : `Runs right away${s.sendTime ? ` (at ${s.sendTime} if that time has not passed today)` : ''}.`;
  return `Runs ${waitText(s)} after step ${i}${s.sendTime ? `, at ${s.sendTime}` : ''}.`;
}

/** Edit one step of a drip (template / task / alert / status, wait, time) */
export function StepSheet({
  step,
  index,
  triggerType,
  templates,
  onClose,
  onSave,
}: {
  step: DripStep;
  index: number;
  triggerType: string;
  templates: Template[];
  onClose: () => void;
  onSave: (s: DripStep) => void;
}) {
  const coaching = useIsCoaching();
  const { list: statuses } = useLeadStatuses();
  const [s, setS] = useState<DripStep>(step);
  const set = (patch: Partial<DripStep>) => setS((x) => ({ ...x, ...patch }));
  const approved = templates.filter((t) => t.status === 'approved');
  const tpl = templates.find((t) => t._id === s.templateId);
  const tplHi = templates.find((t) => t._id === s.templateIdHi);
  const tplOptions = (current?: Template, emptyLabel?: string): Option[] => [
    ...(emptyLabel ? [{ value: '', label: emptyLabel }] : []),
    ...approved.map((t) => ({ value: t._id, label: t.name, hint: `${t.language} · ${t.category}` })),
    ...(current && current.status !== 'approved' ? [{ value: current._id, label: `${current.name} (not approved)` }] : []),
  ];
  const minutesOptions: Option[] = DELAY_MINUTES.concat(DELAY_MINUTES.some(([v]) => v === (s.delayMinutes || 0)) ? [] : [[s.delayMinutes, `+${s.delayMinutes} min`]]).map(([v, l]) => ({ value: String(v), label: l }));

  const problem =
    s.kind === 'message' && !s.templateId
      ? 'Choose the template to send'
      : (s.kind === 'task' || s.kind === 'alert') && !s.text.trim()
        ? `Write what the ${s.kind} says`
        : s.kind === 'status' && !s.setStatus
          ? 'Choose the status'
          : !validTime(s.sendTime)
            ? 'Time must be HH:MM (or empty)'
            : '';

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title={`Step ${index + 1}`}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Done" disabled={!!problem} onPress={() => onSave(s)} />
        </>
      }>
      <Field label="What this step does">
        <Select value={s.kind} title="Step type" options={STEP_KINDS.map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => set({ kind: v as DripStep['kind'] })} />
      </Field>

      {s.kind === 'message' && (
        <>
          {!approved.length && (
            <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.sm }}>
              <T v="small" style={{ color: C.amber900 }}>No approved templates yet. Create one in Templates and get it approved first.</T>
            </View>
          )}
          <Field label="Template">
            <Select value={s.templateId} title="Template" placeholder="Choose an approved template…" options={tplOptions(tpl)} onChange={(v) => set({ templateId: v, variables: variablesFrom(templates.find((t) => t._id === v)) })} />
          </Field>
          {tpl ? <VariableRows vars={s.variables} onChange={(variables) => set({ variables })} /> : null}
          {tpl ? <TemplatePreview t={tpl} vars={s.variables} /> : null}
          {coaching && (
            <View style={{ backgroundColor: C.soft, borderRadius: R.md, padding: S.md, gap: S.sm }}>
              <Field label="Hinglish version (optional)" hint="Leads whose language is Hinglish get this template instead">
                <Select value={s.templateIdHi} title="Hinglish template" options={tplOptions(tplHi, 'Same template for everyone')} onChange={(v) => set({ templateIdHi: v, variablesHi: variablesFrom(templates.find((t) => t._id === v)) })} />
              </Field>
              {tplHi ? <VariableRows vars={s.variablesHi} onChange={(variablesHi) => set({ variablesHi })} /> : null}
            </View>
          )}
        </>
      )}

      {s.kind === 'task' && (
        <>
          <Field label="Task" hint="{name} = the lead's name">
            <Input maxLength={200} value={s.text} placeholder="e.g. Call {name} – hot lead" onChangeText={(text) => set({ text })} />
          </Field>
          <Field label="Due in (minutes)">
            <Input keyboardType="number-pad" value={String(s.dueMinutes ?? 0)} onChangeText={(v) => set({ dueMinutes: Math.max(0, Number(v.replace(/\D/g, '')) || 0) })} />
          </Field>
        </>
      )}
      {s.kind === 'alert' && (
        <Field label="Alert text" hint="Shown in the counsellor's 🔔 (admins if nobody is assigned)">
          <Input maxLength={200} value={s.text} placeholder="e.g. {name} did not reply for 2 days – call now" onChangeText={(text) => set({ text })} />
        </Field>
      )}
      {s.kind === 'status' && (
        <Field label="Move the lead to" hint="This drip keeps going; the new status may start its own drip.">
          <Select value={s.setStatus} title="Lead status" options={statuses.map((x) => ({ value: x.key, label: x.label }))} onChange={(setStatus) => set({ setStatus })} />
        </Field>
      )}

      <Field label={index === 0 ? (triggerType === 'date' ? 'Days after the date' : 'Wait (days + hours)') : 'Wait after previous (days + hours)'}>
        <Row>
          <Input style={{ width: 90 }} keyboardType="number-pad" value={String(s.delayDays ?? 0)} onChangeText={(v) => set({ delayDays: Math.max(0, Math.min(365, Number(v.replace(/\D/g, '')) || 0)) })} accessibilityLabel="Days" />
          <T v="small">days</T>
          <View style={{ flex: 1 }}>
            <Select value={String(s.delayMinutes || 0)} title="Extra hours / minutes" options={minutesOptions} onChange={(v) => set({ delayMinutes: Number(v) })} />
          </View>
        </Row>
      </Field>
      <Field label="At time" hint="24-hour, e.g. 11:00. Leave empty to run as soon as it is due.">
        <TimeInput value={s.sendTime} onChange={(sendTime) => set({ sendTime })} />
        <Row wrap gap={6}>
          {['', '10:00', '11:00', '15:00', '18:00'].map((t) => (
            <Chip key={t || 'none'} label={t || 'As soon as due'} active={s.sendTime === t} onPress={() => set({ sendTime: t })} />
          ))}
        </Row>
      </Field>
      <T v="small">
        {stepWhen(s, index, triggerType)}
        {s.kind !== 'message' ? ' No quiet hours or daily limit (nothing is sent to the customer).' : ''}
      </T>
      {problem ? <T v="small" style={{ color: C.red }}>{problem}</T> : null}
    </Sheet>
  );
}

/** {{1}}, {{2}}… of a template step: contact / course / business field or fixed text */
function VariableRows({ vars, onChange }: { vars: DripVar[]; onChange: (v: DripVar[]) => void }) {
  const { variableOptions, label } = useContactFields();
  if (!vars?.length) return null;
  const setVar = (k: number, patch: Partial<DripVar>) => onChange(vars.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  return (
    <View style={{ gap: S.sm }}>
      <T v="label">Variables</T>
      {vars.map((v, k) => {
        const opts = variableOptions.some((o) => o.value === v.value) || v.source !== 'field' ? variableOptions : [{ value: v.value, label: `${label(v.value)} (not in field list)` }, ...variableOptions];
        return (
          <View key={k} style={{ gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ fontFamily: 'monospace', color: C.text2 }}>{`{{${k + 1}}}`}</T>
              <Row gap={6}>
                <Chip label="Contact field" active={v.source === 'field'} onPress={() => setVar(k, { source: 'field', value: 'name' })} />
                <Chip label="Same text" active={v.source === 'static'} onPress={() => setVar(k, { source: 'static', value: '' })} />
              </Row>
            </Row>
            {v.source === 'field' ? (
              <Select value={v.value} title={`Variable ${k + 1}`} options={opts} onChange={(value) => setVar(k, { value })} />
            ) : (
              <Input value={v.value} placeholder="Text" onChangeText={(value) => setVar(k, { value })} />
            )}
          </View>
        );
      })}
    </View>
  );
}

function TemplatePreview({ t, vars }: { t: Template; vars: DripVar[] }) {
  const { label } = useContactFields();
  const params = vars.map((v, k) => (v.source === 'static' ? v.value || `sample${k + 1}` : `[${label(v.value)}]`));
  return (
    <View style={{ backgroundColor: C.chat, borderRadius: R.md, padding: S.md }}>
      <View style={{ backgroundColor: '#fff', borderRadius: R.md, padding: S.md, gap: 4 }}>
        {t.header ? <T style={{ fontWeight: '700', color: C.text }}>{t.header}</T> : null}
        <T style={{ color: C.text }}>{renderBody(t.body, params)}</T>
        {t.footer ? <T v="tiny">{t.footer}</T> : null}
        {t.buttons?.length ? <T v="small" style={{ color: C.blue }}>{t.buttons.map((b) => b.text).join(' · ')}</T> : null}
      </View>
    </View>
  );
}
