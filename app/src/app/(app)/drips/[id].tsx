import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SegmentBuilder, type SegmentFilter } from '@/components/campaigns-segment';
import { EnrollSheet, Enrollments } from '@/components/drips-enroll';
import {
  OFFSETS,
  PickChip,
  TRIGGERS,
  TagInput,
  draftFromIdea,
  newStep,
  toggleIn,
  triggerSummary,
  useContactFields,
  type Drip,
  type DripForm,
  type DripStep,
  type DripTrigger,
} from '@/components/drips-shared';
import { StepSheet, stepTitle, stepWhen } from '@/components/drips-step';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Loader, Row, Screen, Select, Sheet, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { LEAD_SOURCES, useLeadStatuses } from '@/lib/business';
import { useSocketEvent } from '@/lib/socket';
import type { Template } from '@/lib/templates';
import { C, R, S } from '@/theme';

const KIND_ICON: Record<string, string> = { message: '💬', task: '📝', alert: '🔔', status: '🔀' };
const STATUS: Record<string, [string, string]> = { active: ['On', 'green'], paused: ['Paused', 'yellow'], draft: ['Off', 'gray'] };

const TRIGGER_DEFAULTS: DripTrigger = { type: 'manual', sources: [], adIds: [], tags: [], statuses: [], field: '', offsetDays: 0 };
const idOf = (v: any) => (v && typeof v === 'object' ? v._id : v) || '';
const formFrom = (d: Drip): DripForm => ({
  name: d.name,
  trigger: { ...TRIGGER_DEFAULTS, ...d.trigger },
  condition: d.condition || {},
  stopOnReply: d.stopOnReply,
  stopStatuses: d.stopStatuses || [],
  stopOnStatusChange: (d as any).stopOnStatusChange !== false,
  onComplete: { setStatus: d.onComplete?.setStatus || '', addTag: d.onComplete?.addTag || '' },
  steps: d.steps.map((s: any) => ({ ...newStep(), ...s, kind: s.kind || 'message', templateId: idOf(s.templateId), templateIdHi: idOf(s.templateIdHi), variables: s.variables || [], variablesHi: s.variablesHi || [] })),
});
/** The drip has an extra condition (smart filter: only some contacts enter) */
const hasCondition = (c: Record<string, unknown> = {}) =>
  Object.entries(c).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(k === 'tagMatch' ? 'any' : k === 'referred' ? '' : Array.isArray(v) ? [] : {}));

/** One drip: details, steps, stop rules, people in it. Same fields as the web editor. */
export default function DripScreen() {
  const { id, idea } = useLocalSearchParams<{ id: string; idea?: string }>();
  const isNew = id === 'new';
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const { list: statuses, label: statusLabel } = useLeadStatuses();
  const { dateFields, label: fieldLabel } = useContactFields();
  const [drip, setDrip] = useState<Drip | null>(null);
  const [form, setForm] = useState<DripForm | null>(() => (isNew ? draftFromIdea(idea, { dateFields, statuses }) : null));
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [ads, setAds] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showCondition, setShowCondition] = useState(() => isNew && hasCondition(form?.condition));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(isNew);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<{ index: number; step: DripStep } | null>(null);
  const [activateAsk, setActivateAsk] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [enrollKey, setEnrollKey] = useState(0);

  const loadDrip = useCallback(
    (resetForm: boolean) => {
      if (isNew) return Promise.resolve();
      return api<Drip>(`/drips/${id}`)
        .then((d) => {
          setDrip(d);
          if (resetForm) {
            setForm(formFrom(d));
            setShowCondition(hasCondition(d.condition || {}));
            setDirty(false);
          }
        })
        .catch((err) => {
          toast.error(err);
          router.back();
        });
    },
    [id, isNew, toast]
  );
  useEffect(() => {
    if (!isAdmin) return;
    loadDrip(true);
    api<Template[]>('/templates').then(setTemplates).catch(toast.error);
    api<any[]>('/contacts/ad-sources').then(setAds).catch(() => {});
    api<string[]>('/contacts/tags').then(setAllTags).catch(() => {});
  }, [loadDrip, epoch, isAdmin, toast]);
  useSocketEvent('drip:update', (u: any) => u?._id === id && loadDrip(false), epoch);

  const title = isNew ? 'New drip' : drip?.name || 'Drip';
  const header = <Stack.Screen options={{ title }} />;
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="lock-closed-outline" title="Only admins manage drips" />
      </View>
    );
  }
  if (!form || !templates) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }

  const set = (patch: Partial<DripForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  };
  const setTrigger = (patch: Partial<DripTrigger>) => {
    setForm((f) => (f ? { ...f, trigger: { ...f.trigger, ...patch } } : f));
    setDirty(true);
  };
  const setSteps = (fn: (steps: DripStep[]) => DripStep[]) => {
    setForm((f) => (f ? { ...f, steps: fn(f.steps) } : f));
    setDirty(true);
  };
  const moveStep = (i: number, d: number) =>
    setSteps((steps) => {
      const next = [...steps];
      const j = i + d;
      if (j < 0 || j >= next.length) return steps;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const t = form.trigger;

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, condition: showCondition ? form.condition : {}, steps: form.steps.map((s) => ({ ...s, templateId: s.templateId || null, templateIdHi: s.templateIdHi || null })) };
      const saved = await api<Drip>(isNew ? '/drips' : `/drips/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast.success(isNew ? 'Drip saved. Turn it on when you are ready.' : 'Drip saved');
      if (isNew) router.replace(`/drips/${saved._id}`);
      else loadDrip(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'active' | 'paused', includeExisting = false) => {
    setStatusBusy(true);
    try {
      const r = await api(`/drips/${id}/status`, { method: 'POST', body: { status, includeExisting } });
      toast.success(status === 'active' ? `Drip is ON${r.added ? `, ${r.added} contact(s) added` : ''}` : 'Drip paused');
      setActivateAsk(false);
      loadDrip(false);
      setEnrollKey((k) => k + 1);
    } catch (err) {
      toast.error(err); // server refuses when Settings → Message info is missing
    } finally {
      setStatusBusy(false);
    }
  };
  const turnOn = () => {
    if (dirty) {
      toast.info('Save your changes first');
      return;
    }
    if (['tag_added', 'status_changed', 'ad_lead'].includes(drip?.trigger?.type || '')) setActivateAsk(true);
    else setStatus('active');
  };

  const canSave = form.name.trim().length >= 2 && !form.steps.some((s) => s.kind === 'message' && !s.templateId);
  const [stLabel, stTone] = drip ? STATUS[drip.status] || STATUS.draft : ['', ''];

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={isNew ? undefined : () => { setRefreshing(true); loadDrip(!dirty).finally(() => setRefreshing(false)); }}
      footer={<Button full style={{ flex: 1 }} icon="save-outline" title={isNew ? 'Save drip' : dirty ? 'Save changes' : 'Saved'} loading={saving} disabled={!canSave || !dirty} onPress={save} />}>
      {header}

      {drip ? (
        <Card style={{ gap: S.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge tone={stTone}>{stLabel}</Badge>
            <Row gap={6}>
              {drip.trigger.type !== 'date' ? <Button size="sm" variant="secondary" icon="person-add-outline" title="Add people" onPress={() => setEnrollOpen(true)} /> : null}
              {drip.status === 'active' ? (
                <Button size="sm" variant="secondary" icon="pause" title="Pause" loading={statusBusy} onPress={() => setStatus('paused')} />
              ) : (
                <Button size="sm" icon="play" title="Turn on" loading={statusBusy} onPress={turnOn} />
              )}
            </Row>
          </Row>
          <T v="small">⚡ {triggerSummary(drip.trigger, { statusLabel, fieldLabel })}</T>
          <Row wrap gap={6}>
            <Badge tone="blue">{`${drip.stats?.active || 0} in progress`}</Badge>
            <Badge tone="green">{`${drip.stats?.sent || 0} messages sent`}</Badge>
            <Badge tone="purple">{`${drip.stats?.replied || 0} replied`}</Badge>
            <Badge>{`${drip.stats?.completed || 0} finished`}</Badge>
            {(drip.stats?.failed || 0) > 0 ? <Badge tone="red">{`${drip.stats.failed} failed / skipped`}</Badge> : null}
          </Row>
        </Card>
      ) : null}

      <Card style={{ gap: S.md }}>
        <T v="h3">1. Name & when it starts</T>
        <Field label="Drip name"><Input maxLength={80} value={form.name} onChangeText={(name) => set({ name })} placeholder="e.g. PHP course nurture" /></Field>
        <Field label="Start when…">
          <Select value={t.type} title="Start when" options={TRIGGERS.map(([value, label]) => ({ value, label }))} onChange={(type) => setTrigger({ type })} />
        </Field>
        {t.type === 'new_lead' && (
          <Field label="Only leads from (none selected = all)">
            <Row wrap gap={6}>{LEAD_SOURCES.map(([v, l]) => <PickChip key={v} label={l} on={t.sources.includes(v)} onPress={() => setTrigger({ sources: toggleIn(t.sources, v) })} />)}</Row>
          </Field>
        )}
        {t.type === 'ad_lead' && (
          <Field label="Only these ads (none selected = any ad)" hint="Give ads names on the Ads page.">
            <Row wrap gap={6}>
              {!ads.length && <T v="small">No ad leads yet.</T>}
              {ads.map((a) => <PickChip key={a.adId} label={`📣 ${a.name || a.headline || a.adId}`} on={t.adIds.includes(a.adId)} onPress={() => setTrigger({ adIds: toggleIn(t.adIds, a.adId) })} />)}
            </Row>
          </Field>
        )}
        {t.type === 'tag_added' && (
          <Field label="When one of these tags is added"><TagInput lower value={t.tags} onChange={(tags) => setTrigger({ tags })} placeholder="e.g. php, mern" /></Field>
        )}
        {t.type === 'status_changed' && (
          <Field label="When status becomes">
            <Row wrap gap={6}>{statuses.map((s) => <PickChip key={s.key} label={s.label} on={t.statuses.includes(s.key)} onPress={() => setTrigger({ statuses: toggleIn(t.statuses, s.key) })} />)}</Row>
          </Field>
        )}
        {t.type === 'date' && (
          <>
            <Field label="Date field" hint={!dateFields.length ? 'Add a Date field (e.g. DOB) in Settings → Contact fields first.' : 'Filled by the student (chatbot question, Excel import or contact form).'}>
              <Select value={t.field} title="Date field" options={dateFields.map((f) => ({ value: `custom.${f.key}`, label: f.label }))} onChange={(field) => setTrigger({ field })} />
            </Field>
            <Field label="Send">
              <Select value={String(t.offsetDays || 0)} title="Send" options={OFFSETS.map(([v, l]) => ({ value: String(v), label: l }))} onChange={(v) => setTrigger({ offsetDays: Number(v) })} />
            </Field>
          </>
        )}
        {t.type === 'manual' && <T v="small">After saving, use “Add people” (by filter, e.g. all Converted students).</T>}
        <Toggle
          value={showCondition}
          onChange={(v) => {
            setShowCondition(v);
            setDirty(true);
          }}
          label="Only for some contacts"
          description="Extra condition, e.g. only tag php, or only Interested leads from the last 30 days."
        />
        {showCondition ? <SegmentBuilder value={form.condition as SegmentFilter} onChange={(condition) => set({ condition })} tags={allTags} ads={ads} /> : null}
      </Card>

      <Card style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">2. Steps</T>
          <Button
            size="sm"
            variant="secondary"
            icon="add"
            title="Add step"
            disabled={form.steps.length >= 30}
            onPress={() => setEditing({ index: form.steps.length, step: newStep(2, '11:00') })}
          />
        </Row>
        {!templates.some((x) => x.status === 'approved') && (
          <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.sm }}>
            <T v="small" style={{ color: C.amber900 }}>No approved templates yet. Create one in Templates and get it approved first.</T>
          </View>
        )}
        {form.steps.map((s, i) => {
          const missing = s.kind === 'message' && !s.templateId;
          const hi = s.kind === 'message' && s.templateIdHi ? templates.find((x) => x._id === s.templateIdHi) : null;
          return (
            <View key={s._id || `step-${i}`} style={{ borderWidth: 1, borderColor: missing ? '#fecaca' : C.border, borderRadius: R.md }}>
              <Pressable onPress={() => setEditing({ index: i, step: s })} style={({ pressed }) => [{ padding: S.md, gap: 3 }, pressed && { backgroundColor: C.soft }]}>
                <T v="label">Step {i + 1} · {KIND_ICON[s.kind]} {s.kind === 'message' ? 'Template' : s.kind === 'task' ? 'Task' : s.kind === 'alert' ? 'Alert' : 'Status'}</T>
                <T style={{ color: missing ? C.red : C.text, fontWeight: '500' }}>{stepTitle(s, templates, statusLabel)}</T>
                {hi ? <T v="tiny">Hinglish: {hi.name}</T> : null}
                <T v="tiny">{stepWhen(s, i, t.type)}</T>
              </Pressable>
              <Row style={{ borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: S.sm, paddingVertical: 2, justifyContent: 'flex-end' }} gap={S.md}>
                <IconButton name="create-outline" size={19} label="Edit step" onPress={() => setEditing({ index: i, step: s })} />
                <IconButton name="arrow-up" size={19} color={i === 0 ? C.border : C.text2} label="Move up" onPress={() => i > 0 && moveStep(i, -1)} />
                <IconButton name="arrow-down" size={19} color={i === form.steps.length - 1 ? C.border : C.text2} label="Move down" onPress={() => i < form.steps.length - 1 && moveStep(i, 1)} />
                <IconButton name="trash-outline" size={19} color={form.steps.length === 1 ? C.border : C.red} label="Remove step" onPress={() => form.steps.length > 1 && setSteps((l) => l.filter((_, j) => j !== i))} />
              </Row>
            </View>
          );
        })}
      </Card>

      <Card style={{ gap: S.md }}>
        <T v="h3">3. When to stop</T>
        <Toggle value={form.stopOnReply} onChange={(stopOnReply) => set({ stopOnReply })} label="Stop when the customer replies" description="Your team takes over the conversation instead of more automatic messages." />
        <Field label="Stop when the lead status becomes">
          <Row wrap gap={6}>{statuses.map((s) => <PickChip key={s.key} label={s.label} on={form.stopStatuses.includes(s.key)} onPress={() => set({ stopStatuses: toggleIn(form.stopStatuses, s.key) })} />)}</Row>
        </Field>
        <Toggle
          value={form.stopOnStatusChange ?? !['date', 'manual'].includes(t.type)}
          onChange={(stopOnStatusChange) => set({ stopOnStatusChange })}
          label="One status = one drip"
          description="Stop when the lead moves to any other status, and stop the lead's other drips when this one starts. Turn off for birthday / refer drips that run beside the others."
        />
        <Field label="When the last step is done" hint="e.g. move to Nurture – Later after the 10-day Warm series">
          <Select
            value={form.onComplete.setStatus}
            title="Status when finished"
            options={[{ value: '', label: 'Keep the status' }, ...statuses.map((x) => ({ value: x.key, label: `Move to ${x.label}` }))]}
            onChange={(setStatus) => set({ onComplete: { ...form.onComplete, setStatus } })}
          />
          <Input maxLength={40} autoCapitalize="none" placeholder="Add tag (optional)" value={form.onComplete.addTag} onChangeText={(v) => set({ onComplete: { ...form.onComplete, addTag: v.toLowerCase() } })} />
        </Field>
        <T v="tiny">Always: opted-out contacts are never messaged, nothing is sent during quiet hours, and each contact gets at most the daily limit of automatic messages (Settings → Automation).</T>
      </Card>

      {drip ? <Enrollments dripId={drip._id} reloadKey={enrollKey} /> : null}

      {editing ? (
        <StepSheet
          step={editing.step}
          index={editing.index}
          triggerType={t.type}
          templates={templates}
          onClose={() => setEditing(null)}
          onSave={(s) => {
            const at = editing.index;
            setSteps((l) => (at >= l.length ? [...l, s] : l.map((x, j) => (j === at ? s : x))));
            setEditing(null);
          }}
        />
      ) : null}
      <Sheet
        open={activateAsk}
        onClose={() => setActivateAsk(false)}
        title="Turn on drip"
        footer={
          <>
            <Button variant="secondary" title="Only new ones" disabled={statusBusy} onPress={() => setStatus('active', false)} />
            <Button title="Also add existing" loading={statusBusy} onPress={() => setStatus('active', true)} />
          </>
        }>
        <T>Contacts who already match the start condition ({triggerSummary(drip?.trigger, { statusLabel, fieldLabel })}): add them to the drip now too, or only contacts from now on?</T>
      </Sheet>
      {enrollOpen && drip ? <EnrollSheet dripId={drip._id} onClose={() => setEnrollOpen(false)} onDone={() => { loadDrip(false); setEnrollKey((k) => k + 1); }} /> : null}
    </Screen>
  );
}
