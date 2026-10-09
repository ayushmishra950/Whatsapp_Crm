import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { C, F, R } from '@/theme';
import { Icon, Input, Row, type Option } from './ui';

/** Same helpers as the web's components/drips.js + lib/contact-fields.js */

export type DripVar = { source: 'field' | 'static'; value: string };
export type DripStep = {
  _id?: string;
  kind: 'message' | 'task' | 'alert' | 'status';
  templateId: string;
  variables: DripVar[];
  templateIdHi: string;
  variablesHi: DripVar[];
  text: string;
  dueMinutes: number;
  setStatus: string;
  delayDays: number;
  delayMinutes: number;
  sendTime: string;
};
export type DripTrigger = { type: string; sources: string[]; adIds: string[]; tags: string[]; statuses: string[]; field: string; offsetDays: number };
export type DripForm = {
  name: string;
  trigger: DripTrigger;
  condition: Record<string, unknown>;
  steps: DripStep[];
  stopOnReply: boolean;
  stopStatuses: string[];
  stopOnStatusChange?: boolean;
  onComplete: { setStatus: string; addTag: string };
};
export type DripStats = { total?: number; active?: number; completed?: number; stopped?: number; replied?: number; sent?: number; failed?: number };
export type Drip = DripForm & { _id: string; status: 'draft' | 'active' | 'paused'; stats: DripStats; createdAt: string; steps: any[] };

export const TRIGGERS: [string, string][] = [
  ['new_lead', 'A new lead arrives'],
  ['ad_lead', 'A new lead comes from a Facebook / Instagram ad'],
  ['tag_added', 'A tag is added to a contact'],
  ['status_changed', 'Lead status changes to…'],
  ['date', 'Birthday / anniversary (every year)'],
  ['manual', 'I add people myself (from Contacts or a filter)'],
];
export const OFFSETS: [number, string][] = [[0, 'On the day'], [-1, '1 day before'], [-2, '2 days before'], [-3, '3 days before'], [-7, '7 days before'], [1, '1 day after']];
export const STEP_KINDS: [DripStep['kind'], string][] = [
  ['message', '💬 Send a WhatsApp template'],
  ['task', '📝 Create a task for the counsellor'],
  ['alert', '🔔 Alert the counsellor'],
  ['status', '🔀 Change the lead status'],
];
export const DELAY_MINUTES: [number, string][] = [[0, '+0'], [10, '+10 min'], [30, '+30 min'], [60, '+1 hour'], [120, '+2 hours'], [240, '+4 hours'], [360, '+6 hours'], [720, '+12 hours']];
export const STOP_REASONS: Record<string, string> = {
  replied: 'Replied',
  status: 'Status changed',
  status_changed: 'Moved to another status',
  other_drip: 'Started another drip',
  opted_out: 'Opted out',
  removed: 'Removed',
  contact_deleted: 'Contact deleted',
  drip_deleted: 'Drip deleted',
};

export const IDEAS = [
  { id: 'welcome', icon: '👋', title: 'Welcome series', text: 'New lead → welcome today, course details on day 2, offer on day 5. Stops when they reply.' },
  { id: 'ad', icon: '📣', title: 'Ad lead nurture', text: 'Lead from a Facebook/Instagram ad → messages for that course.' },
  { id: 'interested', icon: '🔥', title: 'Interested follow-up', text: 'Status becomes Interested → reminder in 2 days, offer in 5. Stops on Converted / Not interested.' },
  { id: 'birthday', icon: '🎂', title: 'Birthday offer', text: "Every year on the student's birthday: wishes + a join-now fee offer." },
  { id: 'anniversary', icon: '💞', title: 'Anniversary wish', text: 'Every year on the anniversary date.' },
  { id: 'refer', icon: '🎁', title: 'Refer & earn', text: 'Old students (Converted): ask them to refer friends with their own code and link.' },
];

// Playbook groups: drips are shown in these batches, in playbook order
export const DRIP_GROUPS = [
  { key: 'first', label: '🤝 Get the first conversation', ids: [1, 2, 3, 4] },
  { key: 'interest', label: '🔥 Move interest to action', ids: [5, 6] },
  { key: 'blocker', label: '🧱 Remove the blocker', ids: [7, 8] },
  { key: 'class', label: '🎓 Get them into a class', ids: [9, 10] },
  { key: 'close', label: '✅ Close the admission', ids: [11, 12] },
  { key: 'succeed', label: '🚀 Make them succeed', ids: [13, 14, 27] },
  { key: 'grow', label: '🎁 Grow from happy students', ids: [15, 18, 19] },
  { key: 'winback', label: '🔁 Win them back', ids: [16, 17, 28] },
  { key: 'ops', label: '🏫 Run the institute (fees, classes, attendance)', ids: [20, 21, 22, 23, 24, 25, 26] },
];
/** Playbook number of a drip ("D12 Fee pending" -> 12), or null for your own drips */
export const dripNumber = (name = '') => {
  const m = /^D(\d{1,2})\b/.exec(name.trim());
  return m ? Number(m[1]) : null;
};
export const groupOf = (name: string) => {
  const n = dripNumber(name);
  return n ? DRIP_GROUPS.find((g) => g.ids.includes(n))?.key || 'mine' : 'mine';
};

export const toggleIn = <V,>(list: V[] = [], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function triggerSummary(t: Partial<DripTrigger> | undefined, { statusLabel, fieldLabel }: { statusLabel: (k?: string) => string; fieldLabel: (v: string) => string }) {
  if (!t) return '';
  switch (t.type) {
    case 'new_lead':
      return t.sources?.length ? `New lead from ${t.sources.join(' / ')}` : 'Any new lead';
    case 'ad_lead':
      return t.adIds?.length ? `New lead from ${t.adIds.length} selected ad(s)` : 'New lead from any Facebook/Instagram ad';
    case 'tag_added':
      return `Tag added: ${(t.tags || []).join(', ')}`;
    case 'status_changed':
      return `Status becomes ${(t.statuses || []).map((s) => statusLabel(s)).join(' / ')}`;
    case 'date': {
      const off = t.offsetDays || 0;
      const when = !off ? 'on the day' : off < 0 ? `${-off} day(s) before` : `${off} day(s) after`;
      return `Every year ${when}: ${fieldLabel(t.field || '')}`;
    }
    default:
      return 'People added by hand';
  }
}

export const newStep = (delayDays = 0, sendTime = '', kind: DripStep['kind'] = 'message'): DripStep => ({
  kind,
  templateId: '',
  variables: [],
  templateIdHi: '',
  variablesHi: [],
  text: '',
  dueMinutes: 30,
  setStatus: '',
  delayDays,
  delayMinutes: 0,
  sendTime,
});

export const waitText = (s: Pick<DripStep, 'delayDays' | 'delayMinutes'>) =>
  [s.delayDays ? `${s.delayDays} day(s)` : '', s.delayMinutes ? (s.delayMinutes % 60 ? `${s.delayMinutes} min` : `${s.delayMinutes / 60} hour(s)`) : ''].filter(Boolean).join(' + ') || '0 days';

/** Pre-filled drip for an idea (templates are picked by the admin) */
export function draftFromIdea(id: string | undefined, { dateFields = [], statuses = [] }: { dateFields?: { key: string; label: string }[]; statuses?: { key: string }[] } = {}): DripForm {
  const has = (k: string) => statuses.some((s) => s.key === k);
  const stop = ['converted', 'lost'].filter(has);
  const bday = dateFields.find((f) => /birth|dob|bday/i.test(f.key + f.label)) || dateFields[0];
  const anniv = dateFields.find((f) => /anniv/i.test(f.key + f.label)) || dateFields[0];
  const base: DripForm = {
    name: '',
    trigger: { type: 'manual', sources: [], adIds: [], tags: [], statuses: [], field: '', offsetDays: 0 },
    condition: {},
    steps: [newStep()],
    stopOnReply: true,
    stopStatuses: stop,
    onComplete: { setStatus: '', addTag: '' },
  };
  switch (id) {
    case 'welcome':
      return { ...base, name: 'Welcome series', trigger: { ...base.trigger, type: 'new_lead' }, steps: [newStep(0), newStep(2, '11:00'), newStep(3, '11:00')] };
    case 'ad':
      return { ...base, name: 'Ad lead nurture', trigger: { ...base.trigger, type: 'ad_lead' }, steps: [newStep(0), newStep(1, '11:00')] };
    case 'interested':
      return { ...base, name: 'Interested follow-up', trigger: { ...base.trigger, type: 'status_changed', statuses: has('qualified') ? ['qualified'] : [] }, steps: [newStep(2, '11:00'), newStep(3, '11:00')] };
    case 'birthday':
      return { ...base, name: 'Birthday offer', trigger: { ...base.trigger, type: 'date', field: bday ? `custom.${bday.key}` : '' }, steps: [newStep(0, '10:00')], stopOnReply: false, stopStatuses: [] };
    case 'anniversary':
      return { ...base, name: 'Anniversary wish', trigger: { ...base.trigger, type: 'date', field: anniv ? `custom.${anniv.key}` : '' }, steps: [newStep(0, '10:00')], stopOnReply: false, stopStatuses: [] };
    case 'refer':
      return { ...base, name: 'Refer & earn', trigger: { ...base.trigger, type: 'manual' }, condition: has('converted') ? { statuses: ['converted'] } : {}, steps: [newStep(0, '11:00'), newStep(15, '11:00')], stopOnReply: false, stopStatuses: [] };
    default:
      return base;
  }
}

// ---------- contact fields (template variables, date triggers) ----------
const BUILTIN_FIELDS = [
  { value: 'name', label: 'Contact name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];
const REFERRAL_FIELDS = [
  { value: 'referral_code', label: 'Referral code' },
  { value: 'referral_link', label: 'Referral link (WhatsApp)' },
];
const COURSE_FIELDS = [
  { value: 'course.name', label: 'Course name' },
  { value: 'course.outcome', label: 'Course outcome' },
  { value: 'course.next_batch', label: 'Next batch date' },
  { value: 'course.per_day', label: 'Fee per day' },
  { value: 'course.fees', label: 'Fees text (EN / Hinglish)' },
  { value: 'course.greeting', label: 'Course greeting (EN / Hinglish)' },
  { value: 'course.duration', label: 'Course duration' },
  { value: 'course.internship', label: 'Internship line' },
  { value: 'course.proof_link', label: 'Course proof link' },
  { value: 'course.link', label: 'Course website page' },
];
const BUSINESS_FIELDS = [
  { value: 'counsellor', label: 'Counsellor name' },
  { value: 'business.name', label: 'Business name' },
  { value: 'business.review_link', label: 'Review link' },
  { value: 'business.proof_link', label: 'Proof / results link' },
  { value: 'business.offer_end', label: 'Offer end date' },
  { value: 'business.address', label: 'Address' },
  { value: 'business.maps_link', label: 'Google Maps link' },
  { value: 'business.payment_details', label: 'Payment details' },
  { value: 'business.city', label: 'City' },
  { value: 'business.students_trained', label: 'Students trained' },
  { value: 'business.since_year', label: 'Since (year)' },
  { value: 'business.rating', label: 'Rating' },
];

export type CustomField = { key: string; label: string; type: string; options?: string[] };

/** Contact fields of the business (Settings → Contact fields) for dropdowns */
export function useContactFields() {
  const { session } = useAuth();
  const coaching = useIsCoaching();
  const custom: CustomField[] = (session?.tenant?.settings?.contactFields || []).map((f: any) => ({ ...f, type: f.type || 'text' }));
  const all = [...BUILTIN_FIELDS, ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label })), ...REFERRAL_FIELDS, ...COURSE_FIELDS, ...BUSINESS_FIELDS];
  const byValue = Object.fromEntries(all.map((o) => [o.value, o.label]));
  const label = (value: string) => byValue[value] || (value?.startsWith('custom.') ? value.slice(7).replace(/_/g, ' ') : value);
  // Variable sources, grouped (hint = group)
  const variableOptions: Option[] = [
    ...BUILTIN_FIELDS.map((o) => ({ ...o, hint: 'Built-in' })),
    ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label, hint: 'Custom field' })),
    ...REFERRAL_FIELDS.map((o) => ({ ...o, hint: 'Refer & earn' })),
    ...(coaching ? COURSE_FIELDS.map((o) => ({ ...o, hint: "Lead's course" })) : []),
    ...BUSINESS_FIELDS.map((o) => ({ ...o, hint: 'Counsellor & business' })),
  ];
  return { custom, dateFields: custom.filter((f) => f.type === 'date'), label, variableOptions };
}

// ---------- small inputs ----------
/** Chip that can be switched on / off (multi-select lists) */
export const PickChip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable
    onPress={onPress}
    style={{ borderWidth: 1, borderRadius: R.full, paddingHorizontal: 10, paddingVertical: 5, borderColor: on ? C.brand500 : C.borderStrong, backgroundColor: on ? C.brand50 : '#fff' }}>
    <Text style={{ fontSize: F.sm, color: on ? C.brand700 : C.text2, fontWeight: on ? '600' : '400' }}>{label}</Text>
  </Pressable>
);

/** Words / tags: chips + a box (comma or Enter adds) */
export function TagInput({ value, onChange, placeholder = 'Type + Enter', lower }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; lower?: boolean }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (lower ? s.toLowerCase() : s));
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    if (parts.length) onChange(next);
    setText('');
  };
  return (
    <View style={{ gap: 6 }}>
      {value.length ? (
        <Row wrap gap={6}>
          {value.map((w) => (
            <Pressable key={w} onPress={() => onChange(value.filter((x) => x !== w))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.soft, borderRadius: R.full, paddingHorizontal: 10, paddingVertical: 4 }} accessibilityLabel={`Remove ${w}`}>
              <Text style={{ fontSize: F.sm, color: C.text2 }}>{w}</Text>
              <Icon name="close" size={13} color={C.muted} />
            </Pressable>
          ))}
        </Row>
      ) : null}
      <Input
        value={text}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
        onChangeText={(t) => (t.includes(',') ? add(t) : setText(t))}
        onSubmitEditing={() => add(text)}
        onBlur={() => text.trim() && add(text)}
      />
    </View>
  );
}

/** "HH:MM" text box (empty allowed) */
export function TimeInput({ value, onChange, placeholder = 'HH:MM' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const bad = !!value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return (
    <Input
      value={value}
      placeholder={placeholder}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      style={bad ? { borderColor: C.red } : undefined}
      onChangeText={(t) => {
        let v = t.replace(/[^\d:]/g, '');
        if (/^\d{3,4}$/.test(v)) v = `${v.slice(0, v.length - 2)}:${v.slice(-2)}`;
        if (/^\d:\d\d$/.test(v)) v = `0${v}`;
        onChange(v);
      }}
    />
  );
}

export const validTime = (v: string) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

