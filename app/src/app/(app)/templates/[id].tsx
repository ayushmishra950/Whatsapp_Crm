import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { ButtonsEditor, cleanButtons, VariableDefaultsEditor, type TplButton } from '@/components/templates-editor';
import { StateBadge, TemplatePreview, variableExample, type Tpl } from '@/components/templates-preview';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, InfoLine, Input, Loader, Row, Screen, SectionTitle, Select, Sheet, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { FIELD_LABELS, fitVariableDefaults, type VariableDefault } from '@/lib/templates';
import { C, R, S } from '@/theme';

type Draft = {
  _id?: string;
  status?: string;
  name: string;
  language: string;
  category: string;
  header: string;
  body: string;
  footer: string;
  variableDefaults: VariableDefault[];
  buttons: TplButton[];
  editLimits?: Tpl['editLimits'];
};

const EMPTY: Draft = { name: '', language: 'en', category: 'MARKETING', header: '', body: '', footer: '', variableDefaults: [], buttons: [] };
const LANGS: [string, string][] = [['en', 'English'], ['en_US', 'English (US)'], ['hi', 'Hindi'], ['gu', 'Gujarati'], ['mr', 'Marathi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['bn', 'Bengali']];
const CATEGORIES: [string, string][] = [['MARKETING', 'Marketing'], ['UTILITY', 'Utility'], ['AUTHENTICATION', 'Authentication']];

const toDraft = (t: Tpl): Draft => ({
  _id: t._id,
  status: t.status,
  name: t.name,
  language: t.language,
  category: t.category,
  header: t.header || '',
  body: t.body || '',
  footer: t.footer || '',
  variableDefaults: t.variableDefaults || [],
  buttons: (t.buttons || []).map((b) => ({ type: b.type, text: b.text, url: b.url || '', phone: b.phone || '' })),
  editLimits: t.editLimits,
});
const exampleParams = (d: { variableDefaults?: VariableDefault[]; body?: string }) => fitVariableDefaults(d.variableDefaults, d.body).map(variableExample);

/** One template: preview, status, and (admins) edit / variables / submit / delete. id "new" = create. */
export default function TemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const [t, setT] = useState<Tpl | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (isNew) return Promise.resolve();
    // No single-template endpoint: the list is small
    return api<Tpl[]>('/templates')
      .then((list) => {
        const found = list.find((x) => x._id === id);
        if (!found) {
          toast.error('Template not found');
          router.back();
          return;
        }
        setT(found);
      })
      .catch(toast.error)
      .finally(() => setRefreshing(false));
  }, [id, isNew, toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent<Tpl>('template:update', (u) => u._id === id && setT((prev) => (prev ? { ...prev, ...u } : prev)), epoch);

  // ----- save (same three modes as the web) -----
  const save = async (d: Draft) => {
    const original = d._id ? t : null;
    const approvedEdit = d.status === 'approved';
    const buttons = cleanButtons(d.buttons);
    const onlyVariables = !!original && ['approved', 'pending'].includes(d.status || '') && !isTextChanged(d, original);
    const variableDefaults = fitVariableDefaults(d.variableDefaults, d.body);
    const { name, language, category, header, body, footer } = d;
    if (!onlyVariables && !body.trim()) return toast.error('Write the message body');
    if (!d._id && !name.trim()) return toast.error('Give the template a name');
    if (approvedEdit && !onlyVariables) {
      const ok = await confirm('Submit edit to WhatsApp?', 'WhatsApp reviews the edit again. Until it is approved the template can not be used in chats or campaigns. Limit: 1 edit per 24 hours, 10 per 30 days.', { ok: 'Submit edit' });
      if (!ok) return;
    }
    setBusy('save');
    try {
      let saved: Tpl;
      if (onlyVariables) {
        // Variables are CRM-only: saved straight away, no WhatsApp review
        saved = await api<Tpl>(`/templates/${d._id}/variables`, { method: 'PUT', body: { variableDefaults } });
        toast.success('Variables saved. New campaigns and chats will use them.');
      } else if (approvedEdit) {
        saved = await api<Tpl>(`/templates/${d._id}/edit-approved`, { method: 'POST', body: { header, body, footer, variableDefaults, buttons } });
        toast.success('Edit sent to WhatsApp for review. The template can be used again once it is approved.');
      } else {
        saved = await api<Tpl>(d._id ? `/templates/${d._id}` : '/templates', { method: d._id ? 'PATCH' : 'POST', body: { name, language, category, header, body, footer, variableDefaults, buttons } });
        toast.success('Template saved as draft. Submit it for WhatsApp approval.');
      }
      if (isNew) {
        router.replace(`/templates/${saved._id}`);
      } else {
        setEditing(null);
        load();
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    if (!t) return;
    const ok = await confirm(
      `Submit “${t.name}” to WhatsApp?`,
      `WhatsApp reviews it (usually minutes to a few hours) as a ${t.category?.toLowerCase()} template. After approval only the header, body, footer and buttons can be edited (max 1 edit a day, 10 a month), and every edit goes back to review — so check the text and variables first.`,
      { ok: 'Submit for approval' }
    );
    if (!ok) return;
    setBusy('submit');
    try {
      await api(`/templates/${t._id}/submit`, { method: 'POST' });
      toast.success('Submitted to WhatsApp for approval');
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!t) return;
    if (!(await confirm('Delete template?', `"${t.name}" will also be deleted from WhatsApp.`, { ok: 'Delete', danger: true }))) return;
    setBusy('delete');
    try {
      await api(`/templates/${t._id}`, { method: 'DELETE' });
      toast.success('Template deleted');
      router.back();
    } catch (err) {
      toast.error(err);
      setBusy('');
    }
  };

  // ----- create -----
  if (isNew) {
    if (!isAdmin) {
      return (
        <Screen>
          <Stack.Screen options={{ title: 'New template' }} />
          <T v="small">Only admins can create templates.</T>
        </Screen>
      );
    }
    return (
      <Screen
        footer={
          <>
            <Button title="Cancel" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
            <Button title="Save draft" loading={busy === 'save'} onPress={() => save(newDraft)} style={{ flex: 1 }} />
          </>
        }>
        <Stack.Screen options={{ title: 'New template' }} />
        <TemplateForm draft={newDraft} original={null} onChange={setNewDraft} />
      </Screen>
    );
  }

  if (!t) return <Loader />;
  const vars = fitVariableDefaults(t.variableDefaults, t.body);
  const nextEdit = t.editLimits?.nextAllowedAt;

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <Stack.Screen options={{ title: t.name }} />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <T v="h3" style={{ flex: 1 }} selectable>{t.name}</T>
          <StateBadge status={t.status} />
        </Row>
        <T v="small">{t.category} · {LANGS.find(([v]) => v === t.language)?.[1] || t.language}</T>
        {t.status === 'rejected' && t.rejectionReason ? (
          <View style={{ backgroundColor: C.red50, borderRadius: R.sm, padding: S.sm, marginTop: 6 }}>
            <T v="small" style={{ color: C.red }}>Rejected: {t.rejectionReason}</T>
          </View>
        ) : null}
        {t.status === 'pending' && t.previousVersion?.body ? (
          <T v="small" style={{ color: C.amber, marginTop: 6 }}>✏️ Your edit is in WhatsApp review. The template can be used again once it is approved.</T>
        ) : t.status === 'pending' ? (
          <T v="small" style={{ color: C.amber, marginTop: 6 }}>WhatsApp is reviewing this template (usually minutes to a few hours).</T>
        ) : null}
        {t.status === 'approved' && (t.editLimits?.usedLast30Days || 0) > 0 ? (
          <T v="tiny" style={{ marginTop: 6 }}>
            Edited {t.editLimits?.usedLast30Days}× in the last 30 days · {t.editLimits?.remaining} edit(s) left{nextEdit ? ` · next edit after ${fmtDateTime(nextEdit)}` : ''}
          </T>
        ) : null}
      </Card>

      <SectionTitle>Preview</SectionTitle>
      <TemplatePreview t={t} params={exampleParams(t)} />

      {vars.length ? (
        <>
          <SectionTitle hint="What each {{n}} is filled with by default">Variables</SectionTitle>
          <Card style={{ paddingVertical: S.sm }}>
            {vars.map((v, i) => (
              <InfoLine key={i} label={`{{${i + 1}}}`} value={v.source === 'field' ? `Contact: ${FIELD_LABELS[v.value] || (v.value.startsWith('custom.') ? v.value.slice(7).replace(/_/g, ' ') : v.value)}` : v.value ? `“${v.value}”` : 'Filled in each campaign'} />
            ))}
          </Card>
        </>
      ) : null}

      {isAdmin ? (
        <View style={{ gap: S.sm, marginTop: S.sm }}>
          {['draft', 'rejected'].includes(t.status) ? (
            <>
              <Button icon="send" title="Submit to WhatsApp" loading={busy === 'submit'} onPress={submit} />
              <Button icon="create-outline" variant="secondary" title="Edit" onPress={() => setEditing(toDraft(t))} />
            </>
          ) : null}
          {t.status === 'approved' ? (
            <>
              <Button icon="create-outline" variant="secondary" title="Edit" onPress={() => setEditing(toDraft(t))} />
              <T v="tiny" style={{ textAlign: 'center' }}>
                {nextEdit ? `Text: WhatsApp allows 1 edit per 24 hours (next after ${fmtDateTime(nextEdit)}). Variables can be changed any time.` : 'Change the text (WhatsApp reviews it again) or the variables (no review).'}
              </T>
            </>
          ) : null}
          {t.status === 'pending' && vars.length ? <Button icon="code-slash" variant="secondary" title="Variables" onPress={() => setEditing(toDraft(t))} /> : null}
          <Button icon="trash-outline" variant="ghost" title="Delete template" loading={busy === 'delete'} onPress={remove} style={{ borderColor: 'transparent' }} />
        </View>
      ) : null}

      {editing ? (
        <Sheet
          open
          full
          onClose={() => setEditing(null)}
          title={editing.status === 'pending' ? 'Template variables' : editing.status === 'approved' ? 'Edit approved template' : 'Edit template'}
          footer={
            <>
              <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} />
              <Button title={saveLabel(editing, t)} loading={busy === 'save'} onPress={() => save(editing)} />
            </>
          }>
          <TemplateForm draft={editing} original={t} onChange={setEditing} />
        </Sheet>
      ) : null}
    </Screen>
  );
}

function isTextChanged(d: Draft, original: Tpl | null) {
  if (!original) return false;
  return (['header', 'body', 'footer'] as const).some((k) => (d[k] || '') !== (original[k] || '')) || JSON.stringify(cleanButtons(d.buttons)) !== JSON.stringify(cleanButtons(original.buttons));
}
function saveLabel(d: Draft, original: Tpl | null) {
  const onlyVariables = !!original && ['approved', 'pending'].includes(d.status || '') && !isTextChanged(d, original);
  return onlyVariables ? 'Save variables' : d.status === 'approved' ? 'Submit edit' : 'Save draft';
}

/** Fields of a template (create / edit draft / edit approved / variables only) */
function TemplateForm({ draft, original, onChange }: { draft: Draft; original: Tpl | null; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const approvedEdit = draft.status === 'approved';
  const pending = draft.status === 'pending';
  // Text can't change while WhatsApp reviews it, or when the approved-edit limit is used up; variables always can
  const textLocked = pending || (approvedEdit && !!original?.editLimits?.nextAllowedAt);
  const lockedMeta = !!draft._id;
  return (
    <>
      {approvedEdit ? (
        <View style={{ backgroundColor: C.amber50, borderWidth: 1, borderColor: '#fde68a', borderRadius: R.md, padding: S.md, gap: 3 }}>
          <T v="small" style={{ color: C.amber900, fontWeight: '600' }}>How editing an approved template works</T>
          <T v="tiny" style={{ color: C.amber900 }}>• Only Header, Body, Footer and buttons can be changed. Name, category and language are locked by WhatsApp.</T>
          <T v="tiny" style={{ color: C.amber900 }}>• WhatsApp reviews the edit again (usually minutes to a few hours). Until then the template can not be used in chats or campaigns.</T>
          <T v="tiny" style={{ color: C.amber900 }}>• Limit: 1 edit per 24 hours, 10 per 30 days. Edits left: {draft.editLimits?.remaining ?? 10}.</T>
          <T v="tiny" style={{ color: C.amber900 }}>• Variables (below) are saved only in this CRM: change them any time, no review and no limit.</T>
          {textLocked && original?.editLimits?.nextAllowedAt ? <T v="tiny" style={{ color: C.amber900, fontWeight: '600' }}>• Text is locked until {fmtDateTime(original.editLimits.nextAllowedAt)}. You can still change the variables.</T> : null}
        </View>
      ) : null}
      {pending ? (
        <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.md }}>
          <T v="small" style={{ color: C.amber900 }}>WhatsApp is reviewing this template, so its text can not change now. You can still set the variables (saved only in this CRM).</T>
        </View>
      ) : null}
      <Field label={lockedMeta ? 'Name 🔒' : 'Name'} hint={lockedMeta ? 'Can not be changed' : 'lowercase_with_underscores'}>
        <Input
          value={draft.name}
          editable={!lockedMeta}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. diwali_offer"
          onChangeText={(v) => set({ name: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
        />
      </Field>
      <Row gap={S.md} style={{ alignItems: 'flex-start' }}>
        <Field label={approvedEdit ? 'Category 🔒' : 'Category'} style={{ flex: 1 }}>
          <Select value={draft.category} disabled={approvedEdit || pending} title="Category" onChange={(category) => set({ category })} options={CATEGORIES.map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label={lockedMeta ? 'Language 🔒' : 'Language'} style={{ flex: 1 }}>
          <Select value={draft.language} disabled={lockedMeta} title="Language" onChange={(language) => set({ language })} options={LANGS.map(([value, label]) => ({ value, label }))} />
        </Field>
      </Row>
      <Field label="Header (optional)">
        <Input maxLength={60} editable={!textLocked} value={draft.header} onChangeText={(header) => set({ header })} />
      </Field>
      <Field label="Body" hint="Use {{1}}, {{2}} for personalised values, e.g. Hi {{1}}. Max 1024 characters.">
        <Input multiline maxLength={1024} editable={!textLocked} value={draft.body} onChangeText={(body) => set({ body })} style={{ minHeight: 130 }} placeholder="Hi {{1}}, …" />
      </Field>
      <Field label="Footer (optional)">
        <Input maxLength={60} editable={!textLocked} value={draft.footer} onChangeText={(footer) => set({ footer })} placeholder="Reply STOP to unsubscribe" />
      </Field>
      <ButtonsEditor value={draft.buttons} disabled={textLocked} onChange={(buttons) => set({ buttons })} />
      <VariableDefaultsEditor value={draft.variableDefaults} body={draft.body} onChange={(variableDefaults) => set({ variableDefaults })} />
      <T v="label">Preview</T>
      <TemplatePreview t={draft} params={exampleParams(draft)} />
      <Row gap={6} style={{ alignItems: 'flex-start' }}>
        <Badge tone="blue">Tip</Badge>
        <T v="tiny" style={{ flex: 1, color: C.muted }}>Marketing templates are charged higher by WhatsApp than Utility ones. Add an opt-out line in the footer for marketing messages.</T>
      </Row>
    </>
  );
}
