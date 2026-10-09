import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useIsCoaching } from '@/lib/auth';
import { C, R, S } from '@/theme';
import { TagInput, useContactFields } from './drips-shared';
import { Button, Chip, Field, IconButton, Input, Row, Select, Sheet, T, Toggle, type Option } from './ui';

export type MenuOption = { _id?: string; title: string; description: string; action: 'reply' | 'lead' | 'handoff' | 'courses'; replyText: string; tag: string };
export type LeadQuestion = { _id?: string; field: string; question: string; answerType?: string; errorText?: string };
export type KeywordRule = { _id?: string; keywords: string[]; match: 'contains' | 'exact'; replyText: string; handoff: boolean };

export const ACTIONS: [MenuOption['action'], string][] = [
  ['reply', 'Reply with a message'],
  ['lead', 'Ask lead questions, then connect to team'],
  ['handoff', 'Connect to team (human)'],
];
const COURSES_ACTION: [MenuOption['action'], string] = ['courses', '📚 Show course list (Courses page → fees → admission questions → booking)'];
const ANSWER_TYPES: [string, string][] = [
  ['any', 'Anything'],
  ['time', 'A time (5 baje, 5:30 PM)'],
  ['number', 'A number'],
  ['phone', 'Mobile number'],
  ['email', 'Email address'],
  ['date', 'A date (15/08/2002)'],
];
const ANSWER_HINTS: Record<string, string> = {
  time: 'Kripya time number mein likhiye, jaise: 5 baje, 5:30 PM ya kal subah 11 baje.',
  number: 'Kripya number mein likhiye, jaise: 2',
  phone: 'Kripya 10 digit ka mobile number likhiye.',
  email: 'Please send a valid email address.',
  date: 'Please send the date like 15/08/2002.',
};
export const actionLabel = (a: string) => [...ACTIONS, COURSES_ACTION].find(([v]) => v === a)?.[1] || a;
export const answerTypeLabel = (a?: string) => ANSWER_TYPES.find(([v]) => v === (a || 'any'))?.[1] || a || '';

export const move = <V,>(list: V[], i: number, d: number) => {
  const next = [...list];
  const j = i + d;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** A list item with edit / up / down / delete (tap opens the editor) */
export function ReorderRow({
  title,
  subtitle,
  badge,
  index,
  count,
  onEdit,
  onMove,
  onRemove,
  dim,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  index: number;
  count: number;
  onEdit: () => void;
  onMove?: (d: number) => void;
  onRemove: () => void;
  dim?: boolean;
}) {
  return (
    <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, backgroundColor: dim ? C.soft : '#fff', opacity: dim ? 0.75 : 1 }}>
      <Pressable onPress={onEdit} style={({ pressed }) => [{ padding: S.md, gap: 3 }, pressed && { backgroundColor: C.soft }]}>
        <Row gap={6} style={{ alignItems: 'flex-start' }}>
          <T style={{ flex: 1, color: C.text, fontWeight: '600' }} numberOfLines={2}>{title}</T>
          {badge}
        </Row>
        {subtitle ? <T v="small" numberOfLines={2}>{subtitle}</T> : null}
      </Pressable>
      <Row style={{ borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: S.sm, paddingVertical: 2, justifyContent: 'flex-end' }} gap={S.md}>
        <IconButton name="create-outline" size={19} label="Edit" onPress={onEdit} />
        {onMove ? (
          <>
            <IconButton name="arrow-up" size={19} color={index === 0 ? C.border : C.text2} label="Move up" onPress={() => index > 0 && onMove(-1)} />
            <IconButton name="arrow-down" size={19} color={index === count - 1 ? C.border : C.text2} label="Move down" onPress={() => index < count - 1 && onMove(1)} />
          </>
        ) : null}
        <IconButton name="trash-outline" size={19} color={C.red} label="Remove" onPress={onRemove} />
      </Row>
    </View>
  );
}

const footer = (onClose: () => void, onDone: () => void, disabled?: boolean) => (
  <>
    <Button title="Cancel" variant="secondary" onPress={onClose} />
    <Button title="Done" disabled={disabled} onPress={onDone} />
  </>
);

/** One menu option: title, description, action, reply text, tag */
export function MenuOptionSheet({ value, index, listMode, onClose, onSave }: { value: MenuOption; index: number; listMode: boolean; onClose: () => void; onSave: (o: MenuOption) => void }) {
  const coaching = useIsCoaching();
  const [o, setO] = useState<MenuOption>(value);
  const set = (patch: Partial<MenuOption>) => setO((x) => ({ ...x, ...patch }));
  const actions = coaching || o.action === 'courses' ? [...ACTIONS, COURSES_ACTION] : ACTIONS;
  return (
    <Sheet open full onClose={onClose} title={`Option ${index + 1}`} footer={footer(onClose, () => onSave(o), !o.title.trim())}>
      <Field label="Option title" hint={`${o.title.length}/24 characters`}>
        <Input maxLength={24} value={o.title} onChangeText={(title) => set({ title })} placeholder="e.g. Price / Plans" />
      </Field>
      <Field label="When chosen">
        <Select value={o.action} title="When chosen" options={actions.map(([value, label]) => ({ value, label }))} onChange={(v) => set({ action: v as MenuOption['action'] })} />
      </Field>
      {o.action === 'courses' && (
        <View style={{ backgroundColor: C.violet50, borderRadius: R.md, padding: S.md }}>
          <T v="small" style={{ color: C.violet }}>
            The bot shows your course areas and courses from the Courses page. A course opens with its greeting and Fees / Details / Free demo buttons; after the fees it asks “Are you interested?”, then the admission questions. Booking moves the lead to New – Call pending (or Hot if they start this month), creates a call task and alerts the counsellor.
          </T>
        </View>
      )}
      <Field label={o.action === 'reply' ? 'Reply message' : 'Message before that (optional)'}>
        <Input multiline maxLength={4096} value={o.replyText} onChangeText={(replyText) => set({ replyText })} />
      </Field>
      {listMode ? (
        <Field label="Short description (list only)" hint={`${(o.description || '').length}/72`}>
          <Input maxLength={72} value={o.description || ''} onChangeText={(description) => set({ description })} />
        </Field>
      ) : null}
      <Field label="Add tag to contact (optional)">
        <Input maxLength={40} autoCapitalize="none" value={o.tag || ''} onChangeText={(v) => set({ tag: v.toLowerCase() })} placeholder="e.g. sales" />
      </Field>
    </Sheet>
  );
}

/** Where a lead answer is saved: Name, Email, a custom field or a new field */
function LeadFieldSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { custom } = useContactFields();
  const known = value === 'name' || value === 'email' || custom.some((f) => `custom.${f.key}` === value);
  const typingNew = !known || value === 'custom.';
  const options: Option[] = [
    { value: 'name', label: 'Name' },
    { value: 'email', label: 'Email' },
    ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label })),
    { value: '__new', label: '+ New field…' },
  ];
  return (
    <View style={{ gap: S.sm }}>
      <Select value={typingNew ? '__new' : value} title="Save answer to" options={options} onChange={(v) => onChange(v === '__new' ? 'custom.' : v)} />
      {typingNew ? (
        <Input
          placeholder="Field name, e.g. city"
          autoCapitalize="none"
          value={value.replace(/^custom\./, '')}
          onChangeText={(v) => onChange(`custom.${v.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30)}`)}
        />
      ) : null}
    </View>
  );
}

export function LeadQuestionSheet({ value, index, onClose, onSave }: { value: LeadQuestion; index: number; onClose: () => void; onSave: (q: LeadQuestion) => void }) {
  const [q, setQ] = useState<LeadQuestion>(value);
  const set = (patch: Partial<LeadQuestion>) => setQ((x) => ({ ...x, ...patch }));
  const badField = !(q.field === 'name' || q.field === 'email' || /^custom\.[a-z0-9_]{1,30}$/.test(q.field));
  return (
    <Sheet open full onClose={onClose} title={`Question ${index + 1}`} footer={footer(onClose, () => onSave(q), !q.question.trim() || badField)}>
      <Field label="Question"><Input multiline value={q.question} onChangeText={(question) => set({ question })} placeholder="e.g. Which city are you from?" /></Field>
      <Field label="Save answer to" error={badField ? 'Write a field name (lowercase letters, numbers, _)' : undefined} hint="New fields are added to Settings → Contact fields when you save the chatbot.">
        <LeadFieldSelect value={q.field} onChange={(field) => set({ field })} />
      </Field>
      <Field label="Answer must be">
        <Select value={q.answerType || 'any'} title="Answer must be" options={ANSWER_TYPES.map(([value, label]) => ({ value, label }))} onChange={(answerType) => set({ answerType })} />
      </Field>
      {(q.answerType || 'any') !== 'any' && (
        <Field label="Message if the answer is wrong (optional)" hint="The same question is asked again after this.">
          <Input maxLength={300} value={q.errorText || ''} onChangeText={(errorText) => set({ errorText })} placeholder={ANSWER_HINTS[q.answerType || '']} />
        </Field>
      )}
    </Sheet>
  );
}

export function KeywordRuleSheet({ value, index, onClose, onSave }: { value: KeywordRule; index: number; onClose: () => void; onSave: (r: KeywordRule) => void }) {
  const [r, setR] = useState<KeywordRule>(value);
  const set = (patch: Partial<KeywordRule>) => setR((x) => ({ ...x, ...patch }));
  return (
    <Sheet open full onClose={onClose} title={`Keyword reply ${index + 1}`} footer={footer(onClose, () => onSave(r), !r.keywords.length)}>
      <Field label="Keywords" hint="Matched without caring about capital letters"><TagInput value={r.keywords} onChange={(keywords) => set({ keywords })} placeholder="Type keyword + Enter" /></Field>
      <Field label="Match">
        <Row gap={6}>
          <Chip label="Message contains" active={r.match === 'contains'} onPress={() => set({ match: 'contains' })} />
          <Chip label="Exact message" active={r.match === 'exact'} onPress={() => set({ match: 'exact' })} />
        </Row>
      </Field>
      <Field label="Reply"><Input multiline value={r.replyText} onChangeText={(replyText) => set({ replyText })} /></Field>
      <Toggle value={r.handoff} onChange={(handoff) => set({ handoff })} label="Then connect the customer to the team" />
    </Sheet>
  );
}
