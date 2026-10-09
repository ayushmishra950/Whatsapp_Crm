import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { NoBroadcast, useCanBroadcast, type Campaign } from '@/components/campaigns-common';
import { SegmentBuilder, type AdSource, type SegmentCount, type SegmentFilter } from '@/components/campaigns-segment';
import { DateField } from '@/components/date-field';
import { CampaignVariablesEditor } from '@/components/templates-editor';
import { TemplatePreview, variableExample, type Tpl } from '@/components/templates-preview';
import { useToast } from '@/components/toast';
import { Button, Card, Chip, Field, Icon, IconButton, Input, Loader, Row, Screen, Select, T, confirm, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { fmtDateTime, fmtPhone } from '@/lib/format';
import { fitVariableDefaults } from '@/lib/templates';
import { C, R, S } from '@/theme';

type AudienceType = 'all' | 'filter' | 'status' | 'tags' | 'ads' | 'contacts';
type Variable = { source: 'field' | 'static'; value: string };

const AUDIENCES: { id: AudienceType; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All contacts', icon: 'people-outline' },
  { id: 'filter', label: 'Smart filter', icon: 'options-outline' },
  { id: 'status', label: 'By lead status', icon: 'ellipse-outline' },
  { id: 'tags', label: 'By tags', icon: 'pricetag-outline' },
  { id: 'ads', label: 'From an ad', icon: 'megaphone-outline' },
  { id: 'contacts', label: 'Pick contacts', icon: 'list-outline' },
];

const campaignVariablesFrom = (t?: Tpl): Variable[] => fitVariableDefaults(t?.variableDefaults, t?.body).map(({ source, value }) => ({ source, value }));
const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const csv = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/**
 * New bulk campaign on one form: name, approved template, audience, variables, when to send.
 * ?edit=<id> edits a draft or scheduled campaign. Optional prefill: ?tags=a,b (e.g. an imported batch tag) / ?statuses=… / ?ids=… (contacts picked on the Leads tab) / ?label=…
 */
export default function NewCampaignScreen() {
  const params = useLocalSearchParams<{ edit?: string; tags?: string; statuses?: string; ids?: string; label?: string }>();
  const editId = params.edit || '';
  const toast = useToast();
  const { epoch } = useAuth();
  const canBroadcast = useCanBroadcast();
  const { list: statuses } = useLeadStatuses();
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [ads, setAds] = useState<AdSource[]>([]);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [prefillLabel, setPrefillLabel] = useState(params.label || (params.ids ? `${csv(params.ids).length} picked contacts` : ''));
  const [audienceType, setAudienceType] = useState<AudienceType>(params.ids ? 'contacts' : params.tags ? 'tags' : params.statuses ? 'status' : 'all');
  const [selectedTags, setSelectedTags] = useState<string[]>(csv(params.tags));
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(csv(params.statuses));
  const [selectedAds, setSelectedAds] = useState<string[]>([]);
  const [smartFilter, setSmartFilter] = useState<SegmentFilter>({});
  const [smartCount, setSmartCount] = useState<SegmentCount | null>(null);
  const [contactIds, setContactIds] = useState<string[]>(csv(params.ids));
  const [picked, setPicked] = useState<Record<string, any>>({});
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<any[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);

  // Lists for the form
  const loadLists = useCallback(() => {
    api<Tpl[]>('/templates', { query: { status: 'approved' } }).then(setTemplates).catch((err) => {
      toast.error(err);
      setTemplates([]);
    });
    api<string[]>('/contacts/tags').then(setTags).catch(() => {});
    api<AdSource[]>('/contacts/ad-sources').then(setAds).catch(() => {});
  }, [toast]);
  useEffect(() => {
    if (canBroadcast) loadLists();
  }, [loadLists, canBroadcast, epoch]);

  // Contacts picked on the Leads tab (?ids=…): a few are shown by name, so fetch them
  const prefillIds = params.ids || '';
  useEffect(() => {
    const list = csv(prefillIds);
    if (!list.length || list.length > 20 || !canBroadcast) return;
    let active = true;
    Promise.all(list.map((cid) => api<{ contact: any }>(`/contacts/${cid}`).then((r) => r.contact).catch(() => null))).then((found) => {
      if (active) setPicked((p) => ({ ...p, ...Object.fromEntries(found.filter(Boolean).map((c) => [c._id, c])) }));
    });
    return () => {
      active = false;
    };
  }, [prefillIds, canBroadcast]);

  // Editing a draft / scheduled campaign
  useEffect(() => {
    if (!editId || !canBroadcast) return;
    api<Campaign>(`/campaigns/${editId}`)
      .then((c) => {
        if (!['draft', 'scheduled'].includes(c.status)) {
          toast.error(`A ${c.status} campaign can not be edited`);
          router.replace(`/campaigns/${c._id}`);
          return;
        }
        const a = c.audience || {};
        setName(c.name);
        setTemplateId(c.templateId?._id || c.templateId || '');
        setVariables((c.variables || []).map(({ source, value }) => ({ source, value })));
        setAudienceType(a.type || 'all');
        setSelectedTags(a.tags || []);
        setSelectedStatuses(a.leadStatuses || []);
        setSelectedAds(a.adIds || []);
        setSmartFilter(a.filter || {});
        setContactIds((a.contactIds || []).map(String));
        if (a.type === 'contacts' && a.contactIds?.length > 20) setPrefillLabel(`${a.contactIds.length} picked contacts`);
        if (c.status === 'scheduled' && c.scheduledAt) {
          setWhen('later');
          setScheduledAt(new Date(c.scheduledAt));
        }
        setEditing(c);
      })
      .catch((err) => {
        toast.error(err);
        router.back();
      });
  }, [editId, canBroadcast, toast]);

  const template = useMemo(() => templates?.find((t) => t._id === templateId), [templates, templateId]);
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    // Start with the template's own variable defaults (set on the Templates screen)
    setVariables(campaignVariablesFrom(templates?.find((x) => x._id === id)));
  };

  // Live audience count (same endpoint as the web)
  const needsCountFetch =
    audienceType === 'all' ||
    (audienceType === 'tags' && selectedTags.length > 0) ||
    (audienceType === 'status' && selectedStatuses.length > 0) ||
    (audienceType === 'ads' && selectedAds.length > 0);
  useEffect(() => {
    if (!needsCountFetch || !canBroadcast) return;
    let active = true;
    const body = {
      tags: audienceType === 'tags' ? selectedTags : [],
      leadStatuses: audienceType === 'status' ? selectedStatuses : [],
      adIds: audienceType === 'ads' ? selectedAds : [],
    };
    api<{ count: number }>('/contacts/count', { method: 'POST', body })
      .then((r) => active && setFetchedCount(r.count))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [needsCountFetch, canBroadcast, audienceType, selectedTags, selectedStatuses, selectedAds]);
  const count = audienceType === 'contacts' ? contactIds.length : audienceType === 'filter' ? smartCount?.reachable ?? null : needsCountFetch ? fetchedCount : 0;

  // Contact search for "Pick contacts"
  useEffect(() => {
    if (audienceType !== 'contacts' || !canBroadcast) return;
    const t = setTimeout(
      () =>
        api<{ items: any[] }>('/contacts', { query: { search: contactSearch, limit: 20 } })
          .then((r) => setContactResults(r.items.filter((c) => !c.optedOut)))
          .catch(() => {}),
      250
    );
    return () => clearTimeout(t);
  }, [contactSearch, audienceType, canBroadcast]);

  const sampleParams = variables.map((v, i) => (v.source === 'static' ? v.value : variableExample({ ...v, example: '' }, i)));

  const submit = async (launch: boolean) => {
    if (launch && when === 'now') {
      const ok = await confirm(`Send to ${count ?? 0} people?`, `“${template?.name}” goes out on WhatsApp right away to ${count ?? 0} contacts. Opted-out contacts are skipped. This can not be undone.`, { ok: 'Send now' });
      if (!ok) return;
    } else if (launch && scheduledAt) {
      const ok = await confirm(`Schedule for ${count ?? 0} people?`, `“${template?.name}” will be sent on ${fmtDateTime(scheduledAt)}.`, { ok: editId ? 'Save changes' : 'Schedule' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        templateId,
        audience: { type: audienceType, tags: selectedTags, leadStatuses: selectedStatuses, adIds: selectedAds, contactIds, ...(audienceType === 'filter' && { filter: smartFilter }) },
        variables,
        launch: launch && when === 'now',
        scheduledAt: launch && when === 'later' && scheduledAt ? scheduledAt.toISOString() : undefined,
      };
      const c = editId ? await api<Campaign>(`/campaigns/${editId}`, { method: 'PUT', body }) : await api<Campaign>('/campaigns', { method: 'POST', body });
      toast.success(launch ? (when === 'later' ? (editId ? 'Changes saved. Campaign is scheduled.' : 'Campaign scheduled') : 'Campaign started') : 'Draft saved');
      router.replace(`/campaigns/${c._id}`);
    } catch (err) {
      toast.error(err);
      // The server keeps the draft when launching fails: open it so it can be fixed and relaunched
      const draftId = err instanceof ApiError ? (err.details as any)?.campaignId : null;
      if (!editId && draftId) router.replace(`/campaigns/${draftId}`);
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? (editing.status === 'scheduled' ? 'Edit scheduled campaign' : 'Edit draft campaign') : 'New campaign';
  if (!canBroadcast) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <NoBroadcast />
      </>
    );
  }
  if (!templates || (editId && !editing)) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Loader />
      </>
    );
  }

  const valid = name.trim().length >= 2 && !!template && (count || 0) > 0 && variables.every((v) => v.value) && (when === 'now' || !!scheduledAt);
  const step = (n: number) => (template && variables.length ? n : n > 3 ? n - 1 : n);
  const pickedOverflow = audienceType === 'contacts' && !!prefillLabel && contactIds.length > 20;

  return (
    <Screen
      footer={
        <View style={{ flex: 1, gap: S.sm }}>
          <Button
            icon={when === 'later' ? 'calendar-outline' : 'send'}
            title={when === 'later' ? (editId ? 'Save changes' : 'Schedule campaign') : `Send to ${count ?? 0} contacts`}
            disabled={!valid}
            loading={saving}
            onPress={() => submit(true)}
          />
          <Button variant="secondary" title={editing?.status === 'scheduled' ? 'Unschedule (save as draft)' : 'Save as draft'} disabled={!name.trim() || !templateId || saving} onPress={() => submit(false)} />
        </View>
      }>
      <Stack.Screen options={{ title }} />
      {editing?.status === 'scheduled' ? <T v="small">Currently scheduled for {fmtDateTime(editing.scheduledAt)}. Changes can be made until 1 minute before it starts.</T> : null}

      <Card style={{ gap: S.md }}>
        <T v="h3">1. Campaign details</T>
        <Field label="Campaign name">
          <Input value={name} onChangeText={setName} placeholder="e.g. Diwali offer 2026" />
        </Field>
        <Field label="Approved template" hint={!templates.length ? 'No approved templates yet — create one in Templates first.' : undefined}>
          <Select value={templateId} onChange={chooseTemplate} placeholder="Select a template" title="Approved template" options={templates.map((t) => ({ value: t._id, label: `${t.name} (${t.language})`, hint: t.category }))} />
        </Field>
        {template ? <TemplatePreview t={template} params={sampleParams} /> : null}
      </Card>

      <Card style={{ gap: S.md }}>
        <T v="h3">2. Audience</T>
        {prefillLabel ? (
          <Row style={{ backgroundColor: C.brand50, borderRadius: R.sm, padding: S.sm }}>
            <T v="small" style={{ flex: 1, color: C.brand800 }}>Audience: <T v="small" style={{ fontWeight: '700', color: C.brand800 }}>{prefillLabel}</T></T>
            <IconButton
              name="close"
              size={18}
              label="Choose a different audience"
              onPress={() => {
                setPrefillLabel('');
                setAudienceType('all');
                setContactIds([]);
                setSelectedTags([]);
              }}
            />
          </Row>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {AUDIENCES.map((a) => {
            const on = audienceType === a.id;
            return (
              <Pressable
                key={a.id}
                onPress={() => {
                  setAudienceType(a.id);
                  setPrefillLabel('');
                }}
                style={{ width: '31%', flexGrow: 1, alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: R.md, paddingVertical: S.md, paddingHorizontal: 4, borderColor: on ? C.brand500 : C.border, backgroundColor: on ? C.brand50 : '#fff' }}>
                <Icon name={a.icon} size={20} color={on ? C.brand700 : C.muted} />
                <T v="tiny" style={{ color: on ? C.brand700 : C.text2, fontWeight: '600', textAlign: 'center' }}>{a.label}</T>
              </Pressable>
            );
          })}
        </View>

        {audienceType === 'status' ? (
          <Row wrap gap={6}>
            {statuses.map((st) => <Chip key={st.key} label={st.label} active={selectedStatuses.includes(st.key)} onPress={() => setSelectedStatuses((s) => toggleIn(s, st.key))} />)}
          </Row>
        ) : null}
        {audienceType === 'tags' ? (
          <Row wrap gap={6}>
            {!tags.length ? <T v="small">No tags yet. Add tags to contacts first (imported sheets get a batch tag).</T> : null}
            {[...selectedTags.filter((t) => !tags.includes(t)), ...tags].map((t) => <Chip key={t} label={t} active={selectedTags.includes(t)} onPress={() => setSelectedTags((s) => toggleIn(s, t))} />)}
          </Row>
        ) : null}
        {audienceType === 'ads' ? (
          <Row wrap gap={6}>
            {!ads.length ? <T v="small">No leads from Facebook / Instagram ads yet. They appear here when someone messages you from a Click-to-WhatsApp ad.</T> : null}
            {ads.map((a) => <Chip key={a.adId} label={`📣 ${a.name || a.headline || a.adId} (${a.leads})`} active={selectedAds.includes(a.adId)} onPress={() => setSelectedAds((s) => toggleIn(s, a.adId))} />)}
          </Row>
        ) : null}
        {audienceType === 'filter' ? (
          <>
            <T v="tiny" style={{ color: C.muted }}>Combine everything: e.g. Interested + tag php + contacted us in the last 30 days, or birthdays this month.</T>
            <SegmentBuilder value={smartFilter} onChange={setSmartFilter} onCount={setSmartCount} tags={tags} ads={ads} />
          </>
        ) : null}
        {audienceType === 'contacts' && pickedOverflow ? <T v="small">{contactIds.length} contacts picked.</T> : null}
        {audienceType === 'contacts' && !pickedOverflow ? (
          <View style={{ gap: S.sm }}>
            <Input placeholder="Search contacts" value={contactSearch} onChangeText={setContactSearch} autoCorrect={false} clearButtonMode="while-editing" />
            {contactIds.length ? (
              <Row wrap gap={6}>
                {contactIds.map((cid) => <Chip key={cid} label={`✕ ${picked[cid]?.name || fmtPhone(picked[cid]?.phone) || 'Contact'}`} active onPress={() => setContactIds((s) => s.filter((x) => x !== cid))} />)}
              </Row>
            ) : null}
            <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, overflow: 'hidden' }}>
              {contactResults.map((c) => {
                const on = contactIds.includes(c._id);
                return (
                  <Pressable
                    key={c._id}
                    onPress={() => {
                      setPicked((p) => ({ ...p, [c._id]: c }));
                      setContactIds((s) => toggleIn(s, c._id));
                    }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.soft, backgroundColor: pressed ? C.soft : '#fff' })}>
                    <Icon name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? C.brand600 : C.faint} />
                    <T style={{ flex: 1, color: C.text }} numberOfLines={1}>{c.name || 'Unknown'}</T>
                    <T v="tiny">{fmtPhone(c.phone)}</T>
                  </Pressable>
                );
              })}
              {!contactResults.length ? <T v="small" style={{ padding: S.md }}>No contacts found</T> : null}
            </View>
          </View>
        ) : null}
        <View style={{ backgroundColor: C.soft, borderRadius: R.sm, padding: S.sm }}>
          <T v="small" style={{ color: C.text2 }}>
            <T v="small" style={{ fontWeight: '700', color: C.text }}>{count ?? '…'}</T> contacts will receive this message (opted-out contacts excluded)
          </T>
        </View>
      </Card>

      {template && variables.length ? (
        <Card style={{ gap: S.md }}>
          <View>
            <T v="h3">3. Personalise variables</T>
            <T v="tiny" style={{ color: C.muted }}>Filled from the template&apos;s default variables. Change them here for this campaign only.</T>
          </View>
          <CampaignVariablesEditor value={variables} onChange={setVariables} />
        </Card>
      ) : null}

      <Card style={{ gap: S.md }}>
        <T v="h3">{step(4)}. When to send</T>
        <Row gap={S.sm}>
          <Chip label="Send now" active={when === 'now'} onPress={() => setWhen('now')} />
          <Chip label="Schedule" active={when === 'later'} onPress={() => setWhen('later')} />
        </Row>
        {when === 'later' ? <DateField value={scheduledAt} onChange={setScheduledAt} minimumDate={new Date()} placeholder="Pick date & time" /> : null}
      </Card>
    </Screen>
  );
}
