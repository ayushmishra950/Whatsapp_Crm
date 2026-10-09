import { useState } from 'react';
import { View } from 'react-native';
import { C, R, S } from '@/theme';
import { ReorderRow, move } from './chatbot-menu';
import { TagInput } from './drips-shared';
import { Badge, Button, Field, IconButton, Input, Row, Select, Sheet, T, Toggle } from './ui';

export type CourseQuestion = { key: string; field: string; enabled?: boolean; en: string; hi: string; options: { value: string; en: string; hi: string }[]; skipIfKnown?: boolean };
export type Faq = { key: string; title: string; enabled?: boolean; keywords: string[]; en: string; hi: string; action: string };

const FAQ_ACTIONS: [string, string][] = [
  ['answer', 'Send this answer'],
  ['fees', 'Show the course fees'],
  ['details', 'Show the course details'],
  ['book', 'Start booking (admission questions)'],
  ['courses', 'Show the course list'],
  ['handoff', 'Send this, then connect to the team'],
];
const PLACEHOLDERS =
  '{{name}} {{course}} {{duration}} {{batch_date}} {{internship}} {{business_name}} {{address}} {{maps_link}} {{city}} {{students_trained}} {{since_year}} {{rating}} {{review_link}} {{proof_link}} {{per_day}}';
const keyFrom = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

/** Admission questions of the course flow (asked after "Yes, interested" / "Free demo") */
export function CourseQuestionsEditor({ value, onChange, onReset }: { value: CourseQuestion[]; onChange: (v: CourseQuestion[]) => void; onReset?: () => void }) {
  const [editing, setEditing] = useState<{ index: number; q: CourseQuestion } | null>(null);
  return (
    <View style={{ gap: S.sm }}>
      {value.map((q, i) => (
        <ReorderRow
          key={q.key || i}
          index={i}
          count={value.length}
          dim={q.enabled === false}
          title={`${i + 1}. ${q.en || q.hi || '(no question)'}`}
          subtitle={`Saved in ${q.field} · ${q.options.length ? `${q.options.length} option(s)` : 'typed answer'}${q.skipIfKnown ? ' · skip if known' : ''}`}
          badge={q.enabled === false ? <Badge>off</Badge> : null}
          onEdit={() => setEditing({ index: i, q })}
          onMove={(d) => onChange(move(value, i, d))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}
      <Row wrap gap={S.sm}>
        <Button
          size="sm"
          variant="secondary"
          icon="add"
          title="Add question"
          disabled={value.length >= 15}
          onPress={() => {
            let n = value.length + 1;
            while (value.some((q) => q.key === `q${n}`)) n++;
            setEditing({ index: value.length, q: { key: `q${n}`, field: `custom.q${n}`, enabled: true, en: '', hi: '', options: [], skipIfKnown: false } });
          }}
        />
        {onReset ? <Button size="sm" variant="ghost" icon="refresh" title="Restore defaults" onPress={onReset} /> : null}
      </Row>
      {editing ? (
        <CourseQuestionSheet
          value={editing.q}
          index={editing.index}
          onClose={() => setEditing(null)}
          onSave={(q) => {
            const at = editing.index;
            onChange(at >= value.length ? [...value, q] : value.map((x, j) => (j === at ? q : x)));
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function CourseQuestionSheet({ value, index, onClose, onSave }: { value: CourseQuestion; index: number; onClose: () => void; onSave: (q: CourseQuestion) => void }) {
  const [q, setQ] = useState<CourseQuestion>(value);
  const set = (patch: Partial<CourseQuestion>) => setQ((x) => ({ ...x, ...patch }));
  const setOpt = (k: number, patch: Partial<CourseQuestion['options'][number]>) => set({ options: q.options.map((o, j) => (j === k ? { ...o, ...patch } : o)) });
  const problem = !q.en.trim() && !q.hi.trim() ? 'Write the question' : q.options.some((o) => !o.en.trim()) ? 'Every option needs its English text' : '';
  return (
    <Sheet
      open
      full
      onClose={onClose}
      title={`Admission question ${index + 1}`}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Done" disabled={!!problem} onPress={() => onSave(q)} />
        </>
      }>
      <T v="small">Saved in: {q.field}</T>
      <Toggle value={q.enabled !== false} onChange={(enabled) => set({ enabled })} label="Ask this question" />
      <Toggle value={!!q.skipIfKnown} onChange={(skipIfKnown) => set({ skipIfKnown })} label="Skip if known" description="Skip when the lead already has a value (e.g. name from WhatsApp)." />
      <Field label="Question (English)"><Input multiline maxLength={500} value={q.en} onChangeText={(en) => set({ en })} /></Field>
      <Field label="Question (Hinglish)"><Input multiline maxLength={500} value={q.hi} onChangeText={(hi) => set({ hi })} /></Field>
      <T v="label">Options</T>
      <T v="small">{q.options.length ? 'Buttons (3 short ones) or a list (more): the customer taps one' : 'No options: the customer types the answer'}</T>
      {q.options.map((o, k) => (
        <View key={k} style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.sm, gap: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="label">Option {k + 1}</T>
            <IconButton name="trash-outline" size={18} color={C.red} label="Remove option" onPress={() => set({ options: q.options.filter((_, j) => j !== k) })} />
          </Row>
          <Input maxLength={24} value={o.en} placeholder="Option (English)" onChangeText={(en) => setOpt(k, { en })} />
          <Input maxLength={24} value={o.hi} placeholder="Option (Hinglish)" onChangeText={(hi) => setOpt(k, { hi })} />
          <Input maxLength={100} value={o.value} placeholder="Saved as (on the lead)" onChangeText={(v) => setOpt(k, { value: v })} />
        </View>
      ))}
      <Button size="sm" variant="ghost" icon="add" title="Add option" disabled={q.options.length >= 10} style={{ alignSelf: 'flex-start' }} onPress={() => set({ options: [...q.options, { value: '', en: '', hi: '' }] })} />
      {problem ? <T v="small" style={{ color: C.red }}>{problem}</T> : null}
    </Sheet>
  );
}

/** Answers to questions students type ("emi hai?", "online hai kya", "address"), English + Hinglish */
export function FaqEditor({ value, onChange, onReset }: { value: Faq[]; onChange: (v: Faq[]) => void; onReset?: () => void }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ index: number; f: Faq } | null>(null);
  const term = q.trim().toLowerCase();
  const shown = value.map((f, i) => [f, i] as const).filter(([f]) => !term || [f.title, f.key, ...(f.keywords || [])].some((s) => String(s || '').toLowerCase().includes(term)));
  return (
    <View style={{ gap: S.sm }}>
      <T v="small">When a customer types a question, the bot finds the answer whose keywords are in the message (the longest match wins) and replies in their language. Placeholders: {PLACEHOLDERS}</T>
      <Input placeholder={`Search ${value.length} answers (e.g. emi, online, address)`} value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />
      {shown.map(([f, i]) => (
        <ReorderRow
          key={`${f.key}-${i}`}
          index={i}
          count={value.length}
          dim={f.enabled === false}
          title={f.title || f.key}
          subtitle={(f.keywords || []).slice(0, 8).join(', ') || 'No keywords'}
          badge={
            <Row gap={4}>
              {f.action !== 'answer' ? <Badge tone="blue">{f.action}</Badge> : null}
              {f.enabled === false ? <Badge>off</Badge> : null}
            </Row>
          }
          onEdit={() => setEditing({ index: i, f })}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}
      {!shown.length ? <T v="small" style={{ textAlign: 'center' }}>No answer matches “{q}”.</T> : null}
      <Row wrap gap={S.sm}>
        <Button
          size="sm"
          variant="secondary"
          icon="add"
          title="Add answer"
          disabled={value.length >= 80}
          onPress={() => {
            let n = value.length + 1;
            while (value.some((f) => f.key === keyFrom(`faq_${n}`))) n++;
            setQ('');
            setEditing({ index: value.length, f: { key: keyFrom(`faq_${n}`), title: 'New answer', enabled: true, keywords: [], en: '', hi: '', action: 'answer' } });
          }}
        />
        {onReset ? <Button size="sm" variant="ghost" icon="refresh" title="Restore defaults" onPress={onReset} /> : null}
      </Row>
      {editing ? (
        <FaqSheet
          value={editing.f}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            const at = editing.index;
            onChange(at >= value.length ? [...value, f] : value.map((x, j) => (j === at ? f : x)));
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function FaqSheet({ value, onClose, onSave }: { value: Faq; onClose: () => void; onSave: (f: Faq) => void }) {
  const [f, setF] = useState<Faq>(value);
  const set = (patch: Partial<Faq>) => setF((x) => ({ ...x, ...patch }));
  return (
    <Sheet
      open
      full
      onClose={onClose}
      title={f.title || f.key}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Done" onPress={() => onSave(f)} />
        </>
      }>
      <Toggle value={f.enabled !== false} onChange={(enabled) => set({ enabled })} label="On" />
      <Field label="Title"><Input maxLength={60} value={f.title} onChangeText={(title) => set({ title })} /></Field>
      <Field label="What the bot does">
        <Select value={f.action} title="What the bot does" options={FAQ_ACTIONS.map(([value, label]) => ({ value, label }))} onChange={(action) => set({ action })} />
      </Field>
      <Field label="When the message contains" hint="Words / phrases the way students type them: fees kitni hai, emi, online hai kya…">
        <TagInput lower value={f.keywords || []} onChange={(keywords) => set({ keywords })} placeholder="Add words (comma or Enter)" />
      </Field>
      {['answer', 'handoff'].includes(f.action) ? (
        <>
          <Field label="Answer (English)"><Input multiline maxLength={1000} value={f.en} onChangeText={(en) => set({ en })} /></Field>
          <Field label="Answer (Hinglish)"><Input multiline maxLength={1000} value={f.hi} onChangeText={(hi) => set({ hi })} /></Field>
        </>
      ) : null}
    </Sheet>
  );
}
