import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { ChatbotPreview } from '@/components/chatbot-preview';
import { CourseQuestionsEditor, FaqEditor, type CourseQuestion, type Faq } from '@/components/chatbot-course';
import {
  KeywordRuleSheet,
  LeadQuestionSheet,
  MenuOptionSheet,
  ReorderRow,
  actionLabel,
  answerTypeLabel,
  move,
  type KeywordRule,
  type LeadQuestion,
  type MenuOption,
} from '@/components/chatbot-menu';
import { TagInput, TimeInput, validTime } from '@/components/drips-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Chip, EmptyState, Field, Input, Loader, Row, Screen, Select, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin, useIsCoaching } from '@/lib/auth';
import { C, R, S } from '@/theme';

type Day = { open: boolean; start: string; end: string };
type Bot = {
  enabled: boolean;
  welcomeText: string;
  menuButtonLabel: string;
  menuAfterReplyText?: string;
  showNumberedOptions?: boolean;
  afterReplyStyle?: 'button' | 'full';
  mainMenuButtonLabel?: string;
  afterReplyHint?: string;
  menuHintText?: string;
  menu: MenuOption[];
  keywordRules: KeywordRule[];
  leadQuestions: LeadQuestion[];
  courseQuestions?: CourseQuestion[];
  faqs?: Faq[];
  leadCompleteText: string;
  leadTag: string;
  fallbackText: string;
  maxFallbacks: number;
  handoffText: string;
  handoffKeywords: string[];
  menuKeywords: string[];
  restartOnResolved: boolean;
  typingIndicator?: boolean;
  restartAfterHours?: number;
  businessHours: { enabled: boolean; timezone: string; days: Record<string, Day>; awayText: string };
  [k: string]: any;
};
type Data = { planAllows: boolean; openNow: boolean; whatsappMode: string; defaults: { courseQuestions: CourseQuestion[]; faqs: Faq[] } | null };

const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const DEFAULT_MENU_HINT = '👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)';
const MAX_OPTIONS = 10;
const MAX_QUESTIONS = 10;

/** Remove server-only fields before saving (the whole config is sent, like the web) */
function toPayload(bot: Bot) {
  const { _id, tenantId, createdAt, updatedAt, __v, ...rest } = bot;
  return rest;
}

type Editing =
  | { kind: 'menu'; index: number; value: MenuOption }
  | { kind: 'question'; index: number; value: LeadQuestion }
  | { kind: 'keyword'; index: number; value: KeywordRule }
  | null;

/** WhatsApp chatbot (admin): menu, lead questions, keyword replies, handoff, hours, course flow */
export default function ChatbotScreen() {
  const toast = useToast();
  const { epoch, refresh } = useAuth();
  const isAdmin = useIsAdmin();
  const coaching = useIsCoaching();
  const [data, setData] = useState<Data | null>(null);
  const [bot, setBot] = useState<Bot | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(
    () =>
      api('/chatbot')
        .then((res) => {
          setData(res);
          setBot(res.bot);
          setDirty(false);
        })
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    if (isAdmin) load();
  }, [load, epoch, isAdmin]);

  const header = <Stack.Screen options={{ title: 'Chatbot' }} />;
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="lock-closed-outline" title="Only admins set up the chatbot" />
      </View>
    );
  }
  if (!bot || !data) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }
  if (!data.planAllows) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="lock-closed-outline" title="Chatbot is not included in your plan" text="Ask your provider to upgrade your plan to use the WhatsApp chatbot." />
      </View>
    );
  }

  const set = (patch: Partial<Bot>) => {
    setBot((b) => (b ? { ...b, ...patch } : b));
    setDirty(true);
  };
  const setList = <K extends 'menu' | 'keywordRules' | 'leadQuestions'>(key: K, fn: (l: Bot[K]) => Bot[K]) => {
    setBot((b) => (b ? { ...b, [key]: fn(b[key]) } : b));
    setDirty(true);
  };
  const setHours = (patch: Partial<Bot['businessHours']>) => set({ businessHours: { ...bot.businessHours, ...patch } });
  const setDay = (d: string, patch: Partial<Day>) => setHours({ days: { ...bot.businessHours.days, [d]: { ...bot.businessHours.days[d], ...patch } } });

  const badHours = bot.businessHours.enabled && DAYS.some(([d]) => {
    const day = bot.businessHours.days[d];
    return day?.open && (!validTime(day.start) || !validTime(day.end) || !day.start || !day.end);
  });

  const save = async (override?: Partial<Bot>) => {
    if (badHours) {
      toast.error('Business hours: times must be HH:MM, e.g. 10:00');
      return;
    }
    setSaving(true);
    try {
      const res = await api('/chatbot', { method: 'PUT', body: toPayload({ ...bot, ...override }) });
      setBot(res.bot);
      setData((d) => (d ? { ...d, openNow: res.openNow } : d));
      setDirty(false);
      refresh(); // new custom fields from lead questions now appear in Settings / templates
      toast.success(override?.enabled === true ? 'Chatbot is ON' : override?.enabled === false ? 'Chatbot is OFF' : 'Chatbot saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const questionsUsed = bot.menu.some((o) => o.action === 'lead');
  const listMode = bot.menu.length > 3;
  const afterStyle = bot.afterReplyStyle || 'button';

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
      footer={
        <>
          <Button style={{ flex: 1 }} variant={bot.enabled ? 'secondary' : 'primary'} icon="hardware-chip-outline" title={bot.enabled ? 'Turn off' : 'Save & turn on'} loading={saving} onPress={() => save({ enabled: !bot.enabled })} />
          <Button style={{ flex: 1 }} variant={bot.enabled ? 'primary' : 'secondary'} icon="save-outline" title={dirty ? 'Save' : 'Saved'} loading={saving} disabled={!dirty} onPress={() => save()} />
        </>
      }>
      {header}
      <Card style={{ gap: S.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">Chatbot</T>
          {bot.enabled ? <Badge tone="green">ON</Badge> : <Badge>OFF</Badge>}
        </Row>
        <T v="small">Replies to new WhatsApp chats automatically, collects lead details and hands the chat to your team. The moment anyone from your team replies, the bot stops for that chat.</T>
        {data.whatsappMode !== 'live' ? <T v="small" style={{ color: C.blue }}>Test it from Settings → Sandbox with a new phone number, then watch the chat in the Inbox.</T> : null}
      </Card>

      {/* 1. Welcome & menu */}
      <Card style={{ gap: S.md }}>
        <T v="h3">1. Welcome message & menu</T>
        <Field label="Welcome message" hint="The first thing a new customer sees. Tip: write the first line as *Your Business* to show it in bold.">
          <Input multiline maxLength={1024} value={bot.welcomeText} onChangeText={(welcomeText) => set({ welcomeText })} />
        </Field>
        <Toggle value={bot.showNumberedOptions !== false} onChange={(showNumberedOptions) => set({ showNumberedOptions })} label="Write the options with numbers in the message" description="Adds 1️⃣ 2️⃣ … and a “how to choose” line." />
        {bot.showNumberedOptions !== false ? (
          <Field label="How-to-choose line" hint="{button} is replaced with the list button text. *text* shows in bold.">
            <Input maxLength={300} value={bot.menuHintText ?? DEFAULT_MENU_HINT} onChangeText={(menuHintText) => set({ menuHintText })} />
          </Field>
        ) : null}
        {listMode ? (
          <Field label="List button text" hint="Opens the option list (max 20 characters)">
            <Input maxLength={20} value={bot.menuButtonLabel} onChangeText={(menuButtonLabel) => set({ menuButtonLabel })} />
          </Field>
        ) : null}
        <Field label="After the bot answers an option">
          <Row wrap gap={6}>
            <Chip label="“Main Menu” button (recommended)" active={afterStyle === 'button'} onPress={() => set({ afterReplyStyle: 'button' })} />
            <Chip label="Full menu again" active={afterStyle === 'full'} onPress={() => set({ afterReplyStyle: 'full' })} />
          </Row>
        </Field>
        {afterStyle === 'button' ? (
          <>
            <Field label="Button text" hint={`${(bot.mainMenuButtonLabel ?? '📋 Main Menu').length}/20 characters`}>
              <Input maxLength={20} value={bot.mainMenuButtonLabel ?? '📋 Main Menu'} onChangeText={(mainMenuButtonLabel) => set({ mainMenuButtonLabel })} />
            </Field>
            <Field label="Line under the answer (optional)">
              <Input maxLength={300} value={bot.afterReplyHint ?? ''} onChangeText={(afterReplyHint) => set({ afterReplyHint })} placeholder="👉 Kuch aur jaanna hai? Neeche *Main Menu* dabaiye" />
            </Field>
          </>
        ) : (
          <Field label="Line sent with the full menu after every answer">
            <Input maxLength={1024} value={bot.menuAfterReplyText ?? ''} onChangeText={(menuAfterReplyText) => set({ menuAfterReplyText })} placeholder="Aur kisi cheez me madad chahiye? 👇" />
          </Field>
        )}
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="label">Menu options ({bot.menu.length}/{MAX_OPTIONS})</T>
          <Button size="sm" variant="secondary" icon="add" title="Add option" disabled={bot.menu.length >= MAX_OPTIONS} onPress={() => setEditing({ kind: 'menu', index: bot.menu.length, value: { title: '', description: '', action: 'reply', replyText: '', tag: '' } })} />
        </Row>
        <T v="tiny">{bot.menu.length && !listMode && bot.menu.every((o) => o.title.length <= 20) ? 'Shown as reply buttons (max 3 options, titles up to 20 characters).' : 'Shown as a list (up to 10 options).'} Customers can also type the option number.</T>
        {!bot.menu.length ? <T v="small">No menu options. The bot will only send the welcome message and keyword replies.</T> : null}
        {bot.menu.map((o, i) => (
          <ReorderRow
            key={o._id || `new-${i}`}
            index={i}
            count={bot.menu.length}
            title={`${i + 1}. ${o.title || '(no title)'}`}
            subtitle={[actionLabel(o.action), o.tag && `tag: ${o.tag}`, o.replyText].filter(Boolean).join(' · ')}
            onEdit={() => setEditing({ kind: 'menu', index: i, value: o })}
            onMove={(d) => setList('menu', (l) => move(l, i, d))}
            onRemove={() => setList('menu', (l) => l.filter((_, j) => j !== i))}
          />
        ))}
      </Card>

      <ChatbotPreview bot={bot} />

      {/* Coaching: course flow */}
      {coaching && data.defaults ? (
        <>
          <Card style={{ gap: S.md }}>
            <T v="h3">Course flow: admission questions</T>
            <T v="small">Asked one by one after a student taps “Yes, interested” or “Free demo” on a course (menu option set to “Show course list”). Answers are saved on the lead; then booking creates a call task.</T>
            <CourseQuestionsEditor
              value={bot.courseQuestions?.length ? bot.courseQuestions : data.defaults.courseQuestions}
              onChange={(courseQuestions) => set({ courseQuestions })}
              onReset={() => set({ courseQuestions: data.defaults?.courseQuestions || [] })}
            />
          </Card>
          <Card style={{ gap: S.md }}>
            <T v="h3">Answers to typed questions (FAQ)</T>
            <T v="small">Students type short questions anytime — “fees kitni hai”, “emi hai?”, “online hai kya”, “address”. The bot answers from here, then continues where the student was.</T>
            <FaqEditor value={bot.faqs?.length ? bot.faqs : data.defaults.faqs} onChange={(faqs) => set({ faqs })} onReset={() => set({ faqs: data.defaults?.faqs || [] })} />
          </Card>
        </>
      ) : null}

      {/* 2. Lead questions */}
      <Card style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">2. Lead questions</T>
          <Button size="sm" variant="secondary" icon="add" title="Add" disabled={bot.leadQuestions.length >= MAX_QUESTIONS} onPress={() => setEditing({ kind: 'question', index: bot.leadQuestions.length, value: { field: 'custom.field', question: '', answerType: 'any', errorText: '' } })} />
        </Row>
        <T v="small">{questionsUsed ? 'Asked one by one when a customer picks an option set to “Ask lead questions”.' : 'Set a menu option to “Ask lead questions” to use these.'}</T>
        {bot.leadQuestions.map((q, i) => (
          <ReorderRow
            key={q._id || `q-${i}`}
            index={i}
            count={bot.leadQuestions.length}
            title={`${i + 1}. ${q.question || '(no question)'}`}
            subtitle={`Saved in ${q.field} · ${answerTypeLabel(q.answerType)}`}
            onEdit={() => setEditing({ kind: 'question', index: i, value: q })}
            onMove={(d) => setList('leadQuestions', (l) => move(l, i, d))}
            onRemove={() => setList('leadQuestions', (l) => l.filter((_, j) => j !== i))}
          />
        ))}
        <Field label="Message after the last answer"><Input multiline value={bot.leadCompleteText} onChangeText={(leadCompleteText) => set({ leadCompleteText })} /></Field>
        <Field label="Tag added to the lead"><Input autoCapitalize="none" value={bot.leadTag} onChangeText={(v) => set({ leadTag: v.toLowerCase() })} /></Field>
      </Card>

      {/* 3. Keyword replies */}
      <Card style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">3. Keyword replies</T>
          <Button size="sm" variant="secondary" icon="add" title="Add" disabled={bot.keywordRules.length >= 50} onPress={() => setEditing({ kind: 'keyword', index: bot.keywordRules.length, value: { keywords: [], match: 'contains', replyText: '', handoff: false } })} />
        </Row>
        <T v="small">If the customer&apos;s message contains (or exactly matches) a keyword, the bot sends this reply.</T>
        {!bot.keywordRules.length ? <T v="small">No keyword replies yet.</T> : null}
        {bot.keywordRules.map((r, i) => (
          <ReorderRow
            key={r._id || `k-${i}`}
            index={i}
            count={bot.keywordRules.length}
            title={r.keywords.join(', ') || '(no keywords)'}
            subtitle={[r.match === 'exact' ? 'Exact message' : 'Message contains', r.handoff && 'then team', r.replyText].filter(Boolean).join(' · ')}
            onEdit={() => setEditing({ kind: 'keyword', index: i, value: r })}
            onMove={(d) => setList('keywordRules', (l) => move(l, i, d))}
            onRemove={() => setList('keywordRules', (l) => l.filter((_, j) => j !== i))}
          />
        ))}
      </Card>

      {/* 4. Handoff */}
      <Card style={{ gap: S.md }}>
        <T v="h3">4. Handing over to your team</T>
        <T v="small">When the bot steps back, the chat is auto-assigned to an agent (Settings → Auto-assign).</T>
        <Field label="Handoff message"><Input multiline value={bot.handoffText} onChangeText={(handoffText) => set({ handoffText })} /></Field>
        <Field label="Words that connect to a person" hint="Customer types one of these (exact) at any time → handoff">
          <TagInput value={bot.handoffKeywords} onChange={(handoffKeywords) => set({ handoffKeywords })} placeholder="Type word + Enter" />
        </Field>
        <Field label="Words that show the menu again" hint="Exact match">
          <TagInput value={bot.menuKeywords} onChange={(menuKeywords) => set({ menuKeywords })} placeholder="Type word + Enter" />
        </Field>
        <Field label="When the bot doesn't understand"><Input multiline value={bot.fallbackText} onChangeText={(fallbackText) => set({ fallbackText })} /></Field>
        <Field label="Hand off after (misunderstood messages)">
          <Select value={String(bot.maxFallbacks)} title="Hand off after" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => set({ maxFallbacks: Number(v) })} />
        </Field>
        <Toggle value={bot.typingIndicator !== false} onChange={(typingIndicator) => set({ typingIndicator })} label="Show “typing…” while the bot answers" description="The customer sees typing… on WhatsApp until the bot replies (their message is also marked as read)." />
        <Toggle value={bot.restartOnResolved} onChange={(restartOnResolved) => set({ restartOnResolved })} label="Greet again when a resolved chat gets a new message" description="Off = returning customers go straight to their previous agent." />
        <Field label="Greet again after (hours of silence)" hint="For chats nobody marked as resolved. 0 = off.">
          <Input keyboardType="number-pad" value={String(bot.restartAfterHours ?? 24)} onChangeText={(v) => set({ restartAfterHours: Math.max(0, Math.min(720, Number(v.replace(/\D/g, '')) || 0)) })} />
        </Field>
      </Card>

      {/* 5. Business hours */}
      <Card style={{ gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">5. Business hours</T>
          {bot.businessHours.enabled ? <Badge tone={data.openNow ? 'green' : 'yellow'}>{data.openNow ? 'Open now' : 'Closed now'}</Badge> : null}
        </Row>
        <T v="small">Outside these hours the bot still answers, but tells the customer your team is offline.</T>
        <Toggle value={bot.businessHours.enabled} onChange={(enabled) => setHours({ enabled })} label="Use business hours" />
        {bot.businessHours.enabled ? (
          <>
            <Field label="Time zone" hint="e.g. Asia/Kolkata, Asia/Dubai, Europe/London">
              <Input autoCapitalize="none" autoCorrect={false} value={bot.businessHours.timezone} onChangeText={(timezone) => setHours({ timezone })} />
            </Field>
            {DAYS.map(([d, label]) => {
              const day = bot.businessHours.days[d] || { open: false, start: '10:00', end: '19:00' };
              return (
                <View key={d} style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.sm, gap: S.sm }}>
                  <Toggle value={day.open} onChange={(open) => setDay(d, { open })} label={label} description={day.open ? undefined : 'Closed'} />
                  {day.open ? (
                    <Row>
                      <View style={{ flex: 1 }}><TimeInput value={day.start} onChange={(start) => setDay(d, { start })} /></View>
                      <T v="small">to</T>
                      <View style={{ flex: 1 }}><TimeInput value={day.end} onChange={(end) => setDay(d, { end })} /></View>
                    </Row>
                  ) : null}
                </View>
              );
            })}
            <Field label="Offline message"><Input multiline value={bot.businessHours.awayText} onChangeText={(awayText) => setHours({ awayText })} /></Field>
          </>
        ) : null}
      </Card>

      {editing?.kind === 'menu' ? (
        <MenuOptionSheet
          value={editing.value}
          index={editing.index}
          listMode={editing.index >= bot.menu.length ? bot.menu.length + 1 > 3 : listMode}
          onClose={() => setEditing(null)}
          onSave={(o) => {
            const at = editing.index;
            setList('menu', (l) => (at >= l.length ? [...l, o] : l.map((x, j) => (j === at ? o : x))));
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === 'question' ? (
        <LeadQuestionSheet
          value={editing.value}
          index={editing.index}
          onClose={() => setEditing(null)}
          onSave={(q) => {
            const at = editing.index;
            setList('leadQuestions', (l) => (at >= l.length ? [...l, q] : l.map((x, j) => (j === at ? q : x))));
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === 'keyword' ? (
        <KeywordRuleSheet
          value={editing.value}
          index={editing.index}
          onClose={() => setEditing(null)}
          onSave={(r) => {
            const at = editing.index;
            setList('keywordRules', (l) => (at >= l.length ? [...l, r] : l.map((x, j) => (j === at ? r : x))));
            setEditing(null);
          }}
        />
      ) : null}
    </Screen>
  );
}
