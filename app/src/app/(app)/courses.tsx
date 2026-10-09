import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { DateField } from '@/components/date-field';
import { CoursesImportSheet } from '@/components/courses-import';
import { LeadsSheet } from '@/components/courses-leads';
import { TagInput } from '@/components/drips-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ChipBar, EmptyState, Field, IconButton, Input, Loader, Row, Sheet, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin, useIsCoaching } from '@/lib/auth';
import { loadCourses } from '@/lib/courses';
import { money, prettyDay } from '@/lib/format';
import { C, S } from '@/theme';

type CourseRow = {
  _id?: string;
  code: string;
  name: string;
  category: string;
  triggerWords: string[];
  outcome: string;
  who: string;
  learn: string;
  internshipLine: string;
  greetingEn: string;
  greetingHi: string;
  feesEn: string;
  feesHi: string;
  feeAmount: number | string;
  durationDays: number | string;
  nextBatchDate: string;
  proofLink: string;
  pageUrl: string;
  packageCode: string;
  active: boolean;
  leads?: number;
  perDay?: string;
};

const EMPTY: CourseRow = {
  code: '', name: '', category: '', triggerWords: [], outcome: '', who: '', learn: '', internshipLine: '', greetingEn: '', greetingHi: '',
  feesEn: '', feesHi: '', feeAmount: 0, durationDays: 0, nextBatchDate: '', proofLink: '', pageUrl: '', packageCode: '', active: true,
};
const FIELDS = Object.keys(EMPTY) as (keyof CourseRow)[];

const toDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const fromDate = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');

/** Course catalog (coaching): used by the chatbot, course variables in drips / templates, ad → course and reports */
export default function CoursesScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const coaching = useIsCoaching();
  const tenantId = session?.tenant?._id || '';
  const [items, setItems] = useState<CourseRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [editing, setEditing] = useState<CourseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [leadsOf, setLeadsOf] = useState<CourseRow | null>(null);
  const [importing, setImporting] = useState(false);

  // Reloads the shared course cache too (course pickers elsewhere get the change)
  const load = useCallback(
    () =>
      loadCourses(tenantId, true)
        .then((l) => setItems(l as unknown as CourseRow[]))
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [tenantId, toast]
  );
  useEffect(() => {
    if (coaching && tenantId) load();
  }, [load, epoch, coaching, tenantId]);

  const header = <Stack.Screen options={{ title: 'Courses', headerRight: isAdmin && coaching ? () => (
    <Row gap={S.md}>
      <IconButton name="cloud-upload-outline" color={C.brand700} label="Import courses from Excel" onPress={() => setImporting(true)} />
      <IconButton name="add" color={C.brand700} label="Add course" onPress={() => setEditing({ ...EMPTY })} />
    </Row>
  ) : undefined }} />;
  if (!coaching) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="school-outline" title="Courses are for coaching institutes" text="Ask your platform admin to set your business type to “Coaching institute”." />
      </View>
    );
  }
  if (!items) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }

  const set = (patch: Partial<CourseRow>) => setEditing((c) => (c ? { ...c, ...patch } : c));

  const save = async () => {
    if (!editing) return;
    if (!editing.code || !editing.name.trim()) {
      toast.error('Code and course name are required');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, editing[k]]));
      body.feeAmount = Number(body.feeAmount) || 0;
      body.durationDays = Number(body.durationDays) || 0;
      await api(editing._id ? `/courses/${editing._id}` : '/courses', { method: editing._id ? 'PATCH' : 'POST', body });
      toast.success('Course saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CourseRow) => {
    const ok = await confirm('Delete course?', c.leads ? `${c.leads} lead(s) have ${c.name}; their course will be cleared. You can mark it inactive instead.` : `Delete ${c.name}?`, { ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/courses/${c._id}`, { method: 'DELETE', query: c.leads ? { force: 1 } : undefined });
      toast.success('Course deleted');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const term = q.trim().toLowerCase();
  const shown = items
    .filter((c) => (show === 'all' ? true : show === 'active' ? c.active !== false : c.active === false))
    .filter((c) => !term || [c.name, c.code, c.category, ...(c.triggerWords || [])].some((s) => String(s || '').toLowerCase().includes(term)));
  const activeCount = items.filter((c) => c.active !== false).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <FlatList
        data={shown}
        keyExtractor={(c) => c._id || c.code}
        contentContainerStyle={{ padding: S.lg, gap: S.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListHeaderComponent={
          <View style={{ gap: S.sm }}>
            <T v="small">Leads get a course from the ad they clicked or the words they write (trigger words); drips and templates can then use its name, fees, next batch and more.</T>
            <Input placeholder="Search courses, codes, words" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />
            <ChipBar options={[['all', `All (${items.length})`], ['active', `Active (${activeCount})`], ['inactive', `Inactive (${items.length - activeCount})`]]} value={show} onChange={setShow} />
          </View>
        }
        ListEmptyComponent={
          items.length ? (
            <T v="small" style={{ textAlign: 'center' }}>No course matches.</T>
          ) : (
            <EmptyState
              icon="school-outline"
              title="No courses yet"
              text={isAdmin ? 'Add your courses one by one or import them from Excel (download the sample first).' : 'Your admin adds the courses.'}
              action={
                isAdmin ? (
                  <Row gap={S.sm}>
                    <Button icon="add" title="Add course" onPress={() => setEditing({ ...EMPTY })} />
                    <Button icon="cloud-upload-outline" variant="secondary" title="Import Excel" onPress={() => setImporting(true)} />
                  </Row>
                ) : undefined
              }
            />
          )
        }
        renderItem={({ item: c }) => (
          <Card onPress={isAdmin ? () => setEditing({ ...EMPTY, ...c, triggerWords: c.triggerWords || [] }) : undefined} style={{ gap: 6, opacity: c.active === false ? 0.7 : 1 }}>
            <Row style={{ alignItems: 'flex-start' }}>
              <T style={{ flex: 1, color: C.text, fontWeight: '600' }}>{c.name}</T>
              <Badge tone="purple">{c.code}</Badge>
              {c.active === false ? <Badge>inactive</Badge> : null}
            </Row>
            {c.category ? <T v="tiny">{c.category}</T> : null}
            {c.outcome ? <T v="small">{c.outcome}</T> : null}
            {c.triggerWords?.length ? <T v="tiny">Words: {c.triggerWords.join(', ')}</T> : null}
            <Row wrap gap={S.md}>
              <T v="small">💰 {Number(c.feeAmount) ? money(Number(c.feeAmount)) : '—'}{c.perDay ? ` (${c.perDay}/day)` : ''}</T>
              <T v="small">⏱ {Number(c.durationDays) ? `${c.durationDays} days` : '—'}</T>
              <T v="small">📅 {c.nextBatchDate ? prettyDay(c.nextBatchDate) : '—'}</T>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Button size="sm" variant="ghost" icon="people-outline" title={`${c.leads || 0} lead(s)`} onPress={() => setLeadsOf(c)} />
              {isAdmin ? <IconButton name="trash-outline" color={C.red} label="Delete course" onPress={() => remove(c)} /> : null}
            </Row>
          </Card>
        )}
      />

      <Sheet
        open={!!editing}
        full
        onClose={() => setEditing(null)}
        title={editing?._id ? `Edit ${editing.name}` : 'Add course'}
        footer={
          <>
            {editing?._id ? <Button variant="ghost" icon="trash-outline" title="Delete" onPress={() => editing && remove(editing)} /> : null}
            <View style={{ flex: 1 }} />
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            <Button title="Save" loading={busy} onPress={save} />
          </>
        }>
        {editing ? (
          <>
            <Row style={{ alignItems: 'flex-start' }}>
              <Field label="Code" hint="Short, e.g. DM" style={{ width: 110 }}>
                <Input maxLength={20} autoCapitalize="characters" value={editing.code} onChangeText={(v) => set({ code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} />
              </Field>
              <Field label="Course name" style={{ flex: 1 }}><Input maxLength={100} value={editing.name} onChangeText={(name) => set({ name })} /></Field>
            </Row>
            <Field label="Category"><Input maxLength={60} value={editing.category} onChangeText={(category) => set({ category })} /></Field>
            <Field label="Trigger words" hint="When a lead writes one of these, this becomes their course (e.g. digital marketing, seo)">
              <TagInput lower value={editing.triggerWords} onChange={(triggerWords) => set({ triggerWords })} placeholder="Add words (comma or Enter)" />
            </Field>
            <Row style={{ alignItems: 'flex-start' }}>
              <Field label="Fee (₹)" style={{ flex: 1 }}>
                <Input keyboardType="number-pad" value={String(editing.feeAmount ?? '')} onChangeText={(v) => set({ feeAmount: v.replace(/[^\d]/g, '') })} />
              </Field>
              <Field label="Duration (days)" style={{ flex: 1 }}>
                <Input keyboardType="number-pad" value={String(editing.durationDays ?? '')} onChangeText={(v) => set({ durationDays: v.replace(/\D/g, '') })} />
              </Field>
            </Row>
            <Field label="Next batch"><DateField mode="date" clearable value={toDate(editing.nextBatchDate)} onChange={(d) => set({ nextBatchDate: fromDate(d) })} placeholder="Pick a date" /></Field>
            <Field label="Bigger package code" hint="Suggest instead"><Input maxLength={20} autoCapitalize="characters" value={editing.packageCode} onChangeText={(v) => set({ packageCode: v.toUpperCase() })} /></Field>
            <Field label="Outcome (one line)" hint="What they will be able to do, e.g. run ads and get your first client"><Input maxLength={300} value={editing.outcome} onChangeText={(outcome) => set({ outcome })} /></Field>
            <Field label="Who it is for"><Input multiline value={editing.who} onChangeText={(who) => set({ who })} /></Field>
            <Field label="What they learn"><Input multiline value={editing.learn} onChangeText={(learn) => set({ learn })} /></Field>
            <Field label="Greeting (English)"><Input multiline value={editing.greetingEn} onChangeText={(greetingEn) => set({ greetingEn })} /></Field>
            <Field label="Greeting (Hinglish)"><Input multiline value={editing.greetingHi} onChangeText={(greetingHi) => set({ greetingHi })} /></Field>
            <Field label="Fees text (English)"><Input value={editing.feesEn} onChangeText={(feesEn) => set({ feesEn })} placeholder="₹27,000 (EMI available)" /></Field>
            <Field label="Fees text (Hinglish)"><Input value={editing.feesHi} onChangeText={(feesHi) => set({ feesHi })} placeholder="₹27,000 (EMI bhi hai)" /></Field>
            <Field label="Internship line"><Input value={editing.internshipLine} onChangeText={(internshipLine) => set({ internshipLine })} /></Field>
            <Field label="Proof link" hint="Student work / placements"><Input maxLength={300} autoCapitalize="none" keyboardType="url" value={editing.proofLink} onChangeText={(proofLink) => set({ proofLink })} /></Field>
            <Field label="Website page" hint="The chatbot sends it with the course details / fees">
              <Input maxLength={300} autoCapitalize="none" keyboardType="url" value={editing.pageUrl} placeholder="https://yourwebsite.com/course-page" onChangeText={(pageUrl) => set({ pageUrl })} />
            </Field>
            <Toggle value={editing.active} onChange={(active) => set({ active })} label="Active" description="Inactive courses are not detected in messages and not offered in dropdowns." />
          </>
        ) : null}
      </Sheet>
      {isAdmin ? <CoursesImportSheet open={importing} onClose={() => setImporting(false)} onImported={load} /> : null}
      {leadsOf ? <LeadsSheet title={`Leads · ${leadsOf.name}`} query={{ course: leadsOf.code }} onClose={() => setLeadsOf(null)} /> : null}
    </View>
  );
}
