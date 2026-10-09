import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, RefreshControl, View } from 'react-native';
import { LeadsSheet } from '@/components/courses-leads';
import { CourseSelect } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Field, Input, Loader, Row, Sheet, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin, useIsCoaching } from '@/lib/auth';
import { useCourses } from '@/lib/courses';
import { fmtDateTime } from '@/lib/format';
import { C, S } from '@/theme';

type Ad = {
  _id: string;
  sourceId: string;
  displayName: string;
  name?: string;
  headline?: string;
  sourceUrl?: string;
  tag?: string;
  courseCode?: string;
  leads: number;
  last30: number;
  interested: number;
  converted: number;
  lastLeadAt?: string;
};
type Editing = Ad & { name: string; tag: string; courseCode: string; applyToExisting: boolean };

/** Facebook / Instagram Click-to-WhatsApp ads: name them, tag their leads, see each ad's leads */
export default function AdsScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const coaching = useIsCoaching();
  const courses = useCourses();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [leadsOf, setLeadsOf] = useState<Ad | null>(null);

  const load = useCallback(
    () =>
      api<Ad[]>('/ads')
        .then(setAds)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await api(`/ads/${editing._id}`, {
        method: 'PATCH',
        body: { name: editing.name, tag: editing.tag, ...(coaching && { courseCode: editing.courseCode || '' }), applyToExisting: editing.applyToExisting },
      });
      toast.success([r.tagged && `Tag added to ${r.tagged} lead(s)`, r.coursed && `course set on ${r.coursed} lead(s)`].filter(Boolean).join(', ') || 'Saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const header = <Stack.Screen options={{ title: 'Ads' }} />;
  if (!ads) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <FlatList
        data={ads}
        keyExtractor={(a) => a._id}
        contentContainerStyle={{ padding: S.lg, gap: S.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListHeaderComponent={<T v="small">Every Click-to-WhatsApp ad that brought leads. Give each ad a name and a tag (e.g. php, mern, video-editing) so you can message each course&apos;s leads differently.</T>}
        ListEmptyComponent={<EmptyState icon="megaphone-outline" title="No ad leads yet" text="When someone messages you from a Click-to-WhatsApp ad on Facebook or Instagram, the ad shows up here automatically." />}
        ListFooterComponent={ads.length ? <T v="tiny">Tip: in Drips you can start a series for leads of one ad (“A new lead comes from a Facebook / Instagram ad”).</T> : null}
        renderItem={({ item: a }) => (
          <Card onPress={() => setLeadsOf(a)} style={{ gap: 6 }}>
            <T style={{ color: C.text, fontWeight: '600' }}>📣 {a.displayName}</T>
            {a.name && a.headline ? <T v="tiny">Headline: {a.headline}</T> : null}
            <T v="tiny">ID {a.sourceId}</T>
            <Row wrap gap={6}>
              {a.tag ? <Badge tone="blue">{a.tag}</Badge> : null}
              {coaching && a.courseCode ? <Badge tone="purple">{courses.label(a.courseCode)}</Badge> : null}
            </Row>
            <Row wrap gap={S.md}>
              <T v="small"><T style={{ fontWeight: '700', color: C.text }}>{a.leads}</T> leads ({a.last30} in 30d)</T>
              <T v="small">{a.interested} interested</T>
              <T v="small">{a.converted} converted ({a.leads ? Math.round((a.converted / a.leads) * 100) : 0}%)</T>
            </Row>
            <T v="tiny">Last lead: {a.lastLeadAt ? fmtDateTime(a.lastLeadAt) : '—'}</T>
            <Row wrap gap={6} style={{ marginTop: 2 }}>
              <Button size="sm" variant="secondary" icon="people-outline" title="Leads" onPress={() => setLeadsOf(a)} />
              {isAdmin ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="create-outline"
                  title={coaching ? 'Name, tag & course' : 'Name & tag'}
                  onPress={() => setEditing({ ...a, name: a.name || '', tag: a.tag || '', courseCode: a.courseCode || '', applyToExisting: true })}
                />
              ) : null}
              {a.sourceUrl ? <Button size="sm" variant="ghost" icon="open-outline" title="Open ad" onPress={() => Linking.openURL(a.sourceUrl!)} /> : null}
            </Row>
          </Card>
        )}
      />

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={coaching ? 'Ad name, tag & course' : 'Ad name & tag'}
        footer={
          <>
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            <Button title="Save" loading={busy} onPress={save} />
          </>
        }>
        {editing ? (
          <>
            <T v="small">Headline from Meta: {editing.headline || '—'}</T>
            <Field label="Name (only for you)"><Input maxLength={80} value={editing.name} placeholder="e.g. Video Editing – October" onChangeText={(name) => setEditing({ ...editing, name })} /></Field>
            <Field label="Tag for every lead from this ad" hint="Lowercase, e.g. video-editing. Use it in campaigns, drips and filters.">
              <Input
                maxLength={40}
                autoCapitalize="none"
                autoCorrect={false}
                value={editing.tag}
                placeholder="e.g. video-editing"
                onChangeText={(v) => setEditing({ ...editing, tag: v.toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-') })}
              />
            </Field>
            {coaching ? (
              <Field label="Course this ad is for" hint="Leads from this ad get this course (used by drips and course variables)">
                <CourseSelect value={editing.courseCode} onChange={(courseCode) => setEditing({ ...editing, courseCode })} />
              </Field>
            ) : null}
            <Toggle value={editing.applyToExisting} onChange={(applyToExisting) => setEditing({ ...editing, applyToExisting })} label="Also apply to the leads that already came" description={`${editing.leads} lead(s) so far`} />
          </>
        ) : null}
      </Sheet>
      {leadsOf ? <LeadsSheet title={`Leads · ${leadsOf.displayName}`} query={{ source: 'ad', adId: leadsOf.sourceId }} onClose={() => setLeadsOf(null)} /> : null}
    </View>
  );
}
