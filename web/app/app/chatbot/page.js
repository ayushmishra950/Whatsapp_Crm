"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Plus, Trash2, ArrowUp, ArrowDown, Lock, Save, Clock, List as ListIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TagInput } from "@/components/shared";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, PageLoader, Select, Textarea, Toggle, cx } from "@/components/ui";
import { useContactFields } from "@/lib/contact-fields";
import { useIsCoaching } from "@/lib/business";
import { CourseQuestionsEditor, FaqEditor } from "@/components/chatbot-course";
import { useAuth } from "@/lib/auth";

const ACTIONS = [
  ["reply", "Reply with a message"],
  ["lead", "Ask lead questions, then connect to team"],
  ["handoff", "Connect to team (human)"],
];
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const MAX_OPTIONS = 10;
const MAX_QUESTIONS = 10;

// Remove server-only fields before saving
// Kind of answer a lead question accepts (same list as server/src/services/answerTypes.js)
const ANSWER_TYPES = [
  ["any", "Anything"],
  ["time", "A time (5 baje, 5:30 PM)"],
  ["number", "A number"],
  ["phone", "Mobile number"],
  ["email", "Email address"],
  ["date", "A date (15/08/2002)"],
];
const ANSWER_HINTS = {
  time: "Kripya time number mein likhiye, jaise: 5 baje, 5:30 PM ya kal subah 11 baje.",
  number: "Kripya number mein likhiye, jaise: 2",
  phone: "Kripya 10 digit ka mobile number likhiye.",
  email: "Please send a valid email address.",
  date: "Please send the date like 15/08/2002.",
};

function toPayload(bot) {
  const { _id, tenantId, createdAt, updatedAt, __v, ...rest } = bot;
  return rest;
}

const move = (list, i, dir) => {
  const next = [...list];
  const j = i + dir;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Section({ title, description, children, actions }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function RowTools({ index, count, onMove, onRemove, label }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${label} up`}><ArrowUp className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${label} down`}><ArrowDown className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => onRemove(index)} aria-label={`Remove ${label}`}><Trash2 className="h-4 w-4 text-red-500" /></Button>
    </div>
  );
}

// WhatsApp-style preview of the welcome menu (same buttons/list rule as the server)
const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const DEFAULT_MENU_HINT = "👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)";

// Small numbered badge: the same number on a settings box and on the part of the preview it controls
function Marker({ n }) {
  return <span className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 align-[-2px] text-[10px] font-semibold text-white not-italic">{n}</span>;
}
const Label = ({ n, children }) => <span className="inline-flex items-center"><Marker n={n} />{children}</span>;

// How-to-choose line as the server sends it (keep in sync with menuBody in server/src/services/chatbot.js)
const hintText = (bot, asButtons) => {
  const raw = bot.menuHintText?.trim() || DEFAULT_MENU_HINT;
  return asButtons
    ? raw.replaceAll("*{button}*", "diye button").replaceAll("{button}", "diye button")
    : raw.replaceAll("{button}", bot.menuButtonLabel || "View options");
};
const plain = (t) => String(t || "").replace(/\*/g, "");

function PreviewTitle({ step, title, sub }) {
  return (
    <p className="mb-2 text-xs font-medium text-slate-600">
      <span className="mr-1 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">Message {step}</span>
      {title} {sub && <span className="font-normal text-slate-500">{sub}</span>}
    </p>
  );
}

function MenuPreview({ bot }) {
  const options = bot.menu.slice(0, MAX_OPTIONS);
  const asButtons = options.length > 0 && options.length <= 3 && options.every((o) => o.title.length <= 20);
  const numbered = bot.showNumberedOptions !== false && options.length > 0;
  return (
    <div className="rounded-lg bg-chat p-4">
      <PreviewTitle step={1} title="Welcome" sub="(first message to a new customer)" />
      <div className="max-w-xs">
        <div className="space-y-2 rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
          <p><Marker n={1} />{plain(bot.welcomeText) || "Welcome message…"}</p>
          {numbered && (
            <div>
              {options.map((o, i) => (
                <p key={o._id || i} className={i ? "pl-5" : ""}>{i === 0 && <Marker n={2} />}{NUMBER_EMOJI[i]} {o.title || "Option"}</p>
              ))}
            </div>
          )}
          {numbered && <p><Marker n={3} />{plain(hintText(bot, asButtons))}</p>}
          {!asButtons && options.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 pt-2 text-sm font-medium text-sky-600">
              <Marker n={4} /><ListIcon className="h-4 w-4" /> {bot.menuButtonLabel || "View options"}
            </div>
          )}
        </div>
        {asButtons && (
          <div className="mt-1 space-y-1">
            {options.map((o, i) => (
              <div key={o._id || i} className="flex items-center justify-center rounded-lg bg-white py-2 text-sm font-medium text-sky-600 shadow-sm">
                {i === 0 && <Marker n={2} />}{o.title || "Option"}
              </div>
            ))}
          </div>
        )}
        {!asButtons && options.length > 0 && (
          <div className="mt-2 rounded-lg bg-white p-2 text-sm shadow-sm">
            <p className="px-1 pb-1 text-[11px] text-slate-400">List that opens from button <Marker n={4} /></p>
            {options.map((o, i) => (
              <div key={o._id || i} className="border-b border-slate-100 px-1 py-1.5 last:border-0">
                <p className="text-slate-800">{o.title || "Option"}</p>
                {o.description && <p className="text-xs text-slate-500">{o.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {asButtons ? "Shown as reply buttons (max 3 options, titles up to 20 characters)." : "Shown as a list (up to 10 options)."} Customers can also type the option number (e.g. “2”) or part of its name (e.g. “admission”).
      </p>
    </div>
  );
}

// What the customer sees after the bot answers an option, using the first reply option as the sample
function AfterAnswerPreview({ bot }) {
  if (!bot.menu.length) return null;
  const sample = bot.menu.find((o) => o.action === "reply" && o.replyText) || bot.menu[0];
  const full = bot.afterReplyStyle === "full";
  return (
    <div className="mt-3 rounded-lg bg-chat p-4">
      <PreviewTitle step={2} title="After an answer" sub={`(e.g. customer chose “${sample.title || "Option"}”)`} />
      <div className="max-w-xs">
        <div className="space-y-2 rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
          <p><Marker n={5} />{plain(sample.replyText) || "Answer…"}</p>
          {!full && bot.afterReplyHint?.trim() && <p><Marker n={6} />{plain(bot.afterReplyHint)}</p>}
        </div>
        {full ? (
          <div className="mt-1 rounded-lg bg-white px-3 py-2 text-sm text-slate-800 shadow-sm">
            <p><Marker n={6} />{plain(bot.menuAfterReplyText) || "Aur kisi cheez me madad chahiye? 👇"}</p>
            <p className="mt-1 text-xs text-slate-400">+ the full menu again (options <Marker n={2} />)</p>
          </div>
        ) : (
          <div className="mt-1 flex items-center justify-center rounded-lg bg-white py-2 text-sm font-medium text-sky-600 shadow-sm">
            <Marker n={7} />{bot.mainMenuButtonLabel || "📋 Main Menu"}
          </div>
        )}
      </div>
    </div>
  );
}

// Where a lead answer is saved: Name, Email or a custom field (Settings → Contact fields), or a new field
function LeadFieldSelect({ value, onChange }) {
  const { custom } = useContactFields();
  const known = value === "name" || value === "email" || custom.some((f) => `custom.${f.key}` === value);
  // Typing a new field name (not saved yet); after saving, the field is in the list and shows as a normal option
  const typingNew = !known || value === "custom.";
  const selectValue = typingNew ? "__new" : value;
  return (
    <div className="flex gap-2">
      <Select
        className="w-44 shrink-0"
        value={selectValue}
        onChange={(e) => {
          onChange(e.target.value === "__new" ? "custom." : e.target.value);
        }}
        aria-label="Save answer to"
      >
        <option value="name">Name</option>
        <option value="email">Email</option>
        {custom.map((f) => <option key={f.key} value={`custom.${f.key}`}>{f.label}</option>)}
        <option value="__new">+ New field…</option>
      </Select>
      {typingNew && (
        <Input
          placeholder="Field name, e.g. city"
          value={value.replace(/^custom\./, "")}
          onChange={(e) => onChange(`custom.${e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30)}`)}
          aria-label="New field name"
          title="Saved to Settings → Contact fields when you save the chatbot"
        />
      )}
    </div>
  );
}

export default function ChatbotPage() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [data, setData] = useState(null); // { planAllows, openNow, whatsappMode }
  const coaching = useIsCoaching();
  const [bot, setBot] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/chatbot")
      .then((res) => {
        setData(res);
        setBot(res.bot);
      })
      .catch(toast.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bot) return <PageLoader />;

  if (!data.planAllows) {
    return (
      <PageContainer>
        <PageHeader title="Chatbot" />
        <Card>
          <EmptyState icon={Lock} title="Chatbot is not included in your plan" description="Ask your provider to upgrade your plan to use the WhatsApp chatbot." />
        </Card>
      </PageContainer>
    );
  }

  const set = (patch) => setBot((b) => ({ ...b, ...patch }));
  const setList = (key, updater) => setBot((b) => ({ ...b, [key]: updater(b[key]) }));
  const setItem = (key, i, patch) => setList(key, (list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setHours = (patch) => setBot((b) => ({ ...b, businessHours: { ...b.businessHours, ...patch } }));
  const setDay = (d, patch) => setHours({ days: { ...bot.businessHours.days, [d]: { ...bot.businessHours.days[d], ...patch } } });

  const save = async (override) => {
    setSaving(true);
    try {
      const res = await api("/chatbot", { method: "PUT", body: toPayload({ ...bot, ...override }) });
      setBot(res.bot);
      setData((d) => ({ ...d, openNow: res.openNow }));
      refresh(); // new custom fields from lead questions now appear in Settings / templates
      toast.success(override?.enabled === true ? "Chatbot is ON" : override?.enabled === false ? "Chatbot is OFF" : "Chatbot saved");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const questionsUsed = bot.menu.some((o) => o.action === "lead");

  return (
    <PageContainer>
      <PageHeader
        title={<span className="flex items-center gap-3">Chatbot {bot.enabled ? <Badge tone="green">ON</Badge> : <Badge>OFF</Badge>}</span>}
        description="Replies to new WhatsApp chats automatically, collects lead details and hands the chat to your team."
        actions={
          <>
            <Button variant={bot.enabled ? "secondary" : "primary"} onClick={() => save({ enabled: !bot.enabled })} loading={saving}>
              <Bot className="h-4 w-4" /> {bot.enabled ? "Turn off" : "Save & turn on"}
            </Button>
            <Button variant={bot.enabled ? "primary" : "secondary"} onClick={() => save()} loading={saving}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </>
        }
      />

      <Card className="mb-6 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">How it works</p>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>A customer messages you for the first time (or comes back to a resolved chat) → the bot sends your welcome menu.</li>
          <li>The bot answers menu choices and keywords, and can ask lead questions (saved on the contact).</li>
          <li>When the customer asks for a person, finishes the questions, or the bot doesn&apos;t understand {bot.maxFallbacks} times → the chat goes to an agent (auto-assign).</li>
          <li>The moment anyone from your team replies, the bot stops for that chat.</li>
        </ol>
        {data.whatsappMode !== "live" && (
          <p className="mt-3 rounded-md bg-sky-50 px-3 py-2 text-sky-800">
            Test it from <Link href="/app/settings" className="font-medium underline">Settings → Sandbox</Link> with a new phone number, then watch the chat in the Inbox. Type the option number (e.g. “1”) to pick a menu option.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section
            title="1. Welcome message & menu"
            description="The first thing a new customer sees."
            actions={
              <Button size="sm" variant="secondary" disabled={bot.menu.length >= MAX_OPTIONS} onClick={() => setList("menu", (l) => [...l, { title: "", description: "", action: "reply", replyText: "", tag: "" }])}>
                <Plus className="h-4 w-4" /> Add option
              </Button>
            }
          >
            <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900">
              The numbers <Marker n={1} /> <Marker n={2} /> … on these boxes match the numbers in the <b>Preview</b>, so you can see where each text appears.
            </p>
            <h3 className="border-b border-slate-100 pb-1 text-sm font-semibold text-slate-800">Message 1 · Welcome (first message)</h3>
            <Field label={<Label n={1}>Welcome message</Label>} hint="The main text at the top. Tip: write the first line as *Infonic Training* to show it in bold like a heading.">
              <Textarea rows={3} maxLength={1024} value={bot.welcomeText} onChange={(e) => set({ welcomeText: e.target.value })} />
            </Field>
            <Toggle
              checked={bot.showNumberedOptions !== false}
              onChange={(v) => set({ showNumberedOptions: v })}
              label={<Label n={2}>Write the options with numbers in the message</Label>}
              description="Adds 1️⃣ Courses & Fees, 2️⃣ Admission… and a “how to choose” line, so customers know what each number means without opening the list."
            />
            {bot.showNumberedOptions !== false && (
              <Field label={<Label n={3}>How-to-choose line</Label>} hint="Last line of the welcome message. {button} is replaced with the list button text. WhatsApp shows *text* in bold.">
                <Input maxLength={300} value={bot.menuHintText ?? DEFAULT_MENU_HINT} onChange={(e) => set({ menuHintText: e.target.value })} />
              </Field>
            )}
            {bot.menu.length > 3 && (
              <Field label={<Label n={4}>List button text</Label>} hint="Button under the welcome message that opens the option list (max 20 characters)">
                <Input maxLength={20} value={bot.menuButtonLabel} onChange={(e) => set({ menuButtonLabel: e.target.value })} />
              </Field>
            )}
            <h3 className="border-b border-slate-100 pt-2 pb-1 text-sm font-semibold text-slate-800">Message 2 · After the bot answers an option</h3>
            <Field label="What to show under the answer" hint="A Main Menu button keeps the chat short. The full menu repeats all options under every answer.">
              <Select value={bot.afterReplyStyle || "button"} onChange={(e) => set({ afterReplyStyle: e.target.value })}>
                <option value="button">Show one “Main Menu” button under the answer (recommended)</option>
                <option value="full">Show the full menu again</option>
              </Select>
            </Field>
            {(bot.afterReplyStyle || "button") === "button" ? (
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <Field label={<Label n={7}>Button text</Label>} hint={`${(bot.mainMenuButtonLabel ?? "📋 Main Menu").length}/20 characters`}>
                  <Input maxLength={20} value={bot.mainMenuButtonLabel ?? "📋 Main Menu"} onChange={(e) => set({ mainMenuButtonLabel: e.target.value })} />
                </Field>
                <Field label={<Label n={6}>Line under the answer (optional)</Label>}>
                  <Input maxLength={300} value={bot.afterReplyHint ?? ""} onChange={(e) => set({ afterReplyHint: e.target.value })} placeholder="👉 Kuch aur jaanna hai? Neeche *Main Menu* dabaiye" />
                </Field>
              </div>
            ) : (
              <Field label={<Label n={6}>Line sent with the full menu after every answer</Label>}>
                <Input maxLength={1024} value={bot.menuAfterReplyText ?? ""} onChange={(e) => set({ menuAfterReplyText: e.target.value })} placeholder="Aur kisi cheez me madad chahiye? 👇" />
              </Field>
            )}
            <h3 className="border-b border-slate-100 pt-2 pb-1 text-sm font-semibold text-slate-800">
              Menu options <span className="font-normal text-slate-500">· title <Marker n={2} /> shows in Message 1, reply <Marker n={5} /> in Message 2</span>
            </h3>
            {!bot.menu.length && <p className="text-sm text-slate-500">No menu options. The bot will only send the welcome message and keyword replies.</p>}
            {bot.menu.map((o, i) => (
              <div key={o._id || `new-${i}`} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Option {i + 1}</span>
                  <RowTools index={i} count={bot.menu.length} label="option" onMove={(idx, d) => setList("menu", (l) => move(l, idx, d))} onRemove={(idx) => setList("menu", (l) => l.filter((_, j) => j !== idx))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={<Label n={2}>Option title</Label>} hint={`${o.title.length}/24 characters`}>
                    <Input maxLength={24} value={o.title} onChange={(e) => setItem("menu", i, { title: e.target.value })} placeholder="e.g. Price / Plans" />
                  </Field>
                  <Field label="When chosen">
                    <Select value={o.action} onChange={(e) => setItem("menu", i, { action: e.target.value })}>
                      {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      {(coaching || o.action === "courses") && <option value="courses">📚 Show course list (Courses page → fees → admission questions → booking)</option>}
                    </Select>
                  </Field>
                </div>
                {o.action === "courses" && (
                  <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900">
                    The bot shows your course areas and courses from the <b>Courses</b> page. A course opens with its greeting and Fees / Details / Free demo buttons; after the fees it asks “Are you interested?”, then the admission questions (what they do, goal, classroom or online, when to start, name, city, call time). Booking moves the lead to <b>New – Call pending</b> (or <b>Hot</b> if they start this month), creates a call task and alerts the counsellor. Leads from an ad or who write a course name go straight to that course.
                  </p>
                )}
                <Field label={o.action === "reply" ? <Label n={5}>Reply message</Label> : "Message before that (optional)"} className="mt-3">
                  <Textarea rows={2} maxLength={4096} value={o.replyText} onChange={(e) => setItem("menu", i, { replyText: e.target.value })} />
                </Field>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {bot.menu.length > 3 && (
                    <Field label="Short description (list only)">
                      <Input maxLength={72} value={o.description || ""} onChange={(e) => setItem("menu", i, { description: e.target.value })} />
                    </Field>
                  )}
                  <Field label="Add tag to contact (optional)">
                    <Input maxLength={40} value={o.tag || ""} onChange={(e) => setItem("menu", i, { tag: e.target.value.toLowerCase() })} placeholder="e.g. sales" />
                  </Field>
                </div>
              </div>
            ))}
          </Section>

          {coaching && data.defaults && (
            <>
              <Section
                title="Course flow: admission questions"
                description="Asked one by one after a student taps “Yes, interested” or “Free demo” on a course (menu option set to “Show course list”). Answers are saved on the lead; then the booking moves the lead to New – Call pending (Hot if they start this month) and creates a call task."
              >
                <CourseQuestionsEditor
                  value={bot.courseQuestions?.length ? bot.courseQuestions : data.defaults.courseQuestions}
                  onChange={(courseQuestions) => setBot((b) => ({ ...b, courseQuestions }))}
                  onReset={() => setBot((b) => ({ ...b, courseQuestions: data.defaults.courseQuestions }))}
                />
              </Section>
              <Section
                title="Answers to typed questions (FAQ)"
                description="Students type short questions anytime — “fees kitni hai”, “emi hai?”, “online hai kya”, “address”, “placement milegi?”. The bot answers from here (with the course’s own details), then continues where the student was."
              >
                <FaqEditor
                  value={bot.faqs?.length ? bot.faqs : data.defaults.faqs}
                  onChange={(faqs) => setBot((b) => ({ ...b, faqs }))}
                  onReset={() => setBot((b) => ({ ...b, faqs: data.defaults.faqs }))}
                />
              </Section>
            </>
          )}

          <Section
            title="2. Lead questions"
            description={questionsUsed ? "Asked one by one when a customer picks an option set to “Ask lead questions”." : "Set a menu option to “Ask lead questions” to use these."}
            actions={
              <Button size="sm" variant="secondary" disabled={bot.leadQuestions.length >= MAX_QUESTIONS} onClick={() => setList("leadQuestions", (l) => [...l, { field: "custom.field", question: "" }])}>
                <Plus className="h-4 w-4" /> Add question
              </Button>
            }
          >
            {bot.leadQuestions.map((q, i) => (
              <div key={q._id || `q-${i}`} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="grid items-end gap-2 sm:grid-cols-[1fr_16rem_auto]">
                  <Field label={`Question ${i + 1}`}>
                    <Input value={q.question} onChange={(e) => setItem("leadQuestions", i, { question: e.target.value })} placeholder="e.g. Which city are you from?" />
                  </Field>
                  <Field label="Save answer to">
                    <LeadFieldSelect value={q.field} onChange={(field) => setItem("leadQuestions", i, { field })} />
                  </Field>
                  <RowTools index={i} count={bot.leadQuestions.length} label="question" onMove={(idx, d) => setList("leadQuestions", (l) => move(l, idx, d))} onRemove={(idx) => setList("leadQuestions", (l) => l.filter((_, j) => j !== idx))} />
                </div>
                <div className="grid items-end gap-2 sm:grid-cols-[13rem_1fr]">
                  <Field label="Answer must be">
                    <Select value={q.answerType || "any"} onChange={(e) => setItem("leadQuestions", i, { answerType: e.target.value })}>
                      {ANSWER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                  {(q.answerType || "any") !== "any" && (
                    <Field label="Message if the answer is wrong (optional)" hint="The same question is asked again after this.">
                      <Input maxLength={300} value={q.errorText || ""} onChange={(e) => setItem("leadQuestions", i, { errorText: e.target.value })} placeholder={ANSWER_HINTS[q.answerType]} />
                    </Field>
                  )}
                </div>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Field label="Message after the last answer">
                <Input value={bot.leadCompleteText} onChange={(e) => set({ leadCompleteText: e.target.value })} />
              </Field>
              <Field label="Tag added to the lead">
                <Input value={bot.leadTag} onChange={(e) => set({ leadTag: e.target.value.toLowerCase() })} />
              </Field>
            </div>
          </Section>

          <Section
            title="3. Keyword replies"
            description="If the customer's message contains (or exactly matches) a keyword, the bot sends this reply."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setList("keywordRules", (l) => [...l, { keywords: [], match: "contains", replyText: "", handoff: false }])}>
                <Plus className="h-4 w-4" /> Add keyword reply
              </Button>
            }
          >
            {!bot.keywordRules.length && <p className="text-sm text-slate-500">No keyword replies yet.</p>}
            {bot.keywordRules.map((r, i) => (
              <div key={r._id || `k-${i}`} className="space-y-3 rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Rule {i + 1}</span>
                  <RowTools index={i} count={bot.keywordRules.length} label="keyword reply" onMove={(idx, d) => setList("keywordRules", (l) => move(l, idx, d))} onRemove={(idx) => setList("keywordRules", (l) => l.filter((_, j) => j !== idx))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <Field label="Keywords">
                    <TagInput value={r.keywords} onChange={(keywords) => setItem("keywordRules", i, { keywords })} placeholder="Type keyword + Enter" />
                  </Field>
                  <Field label="Match">
                    <Select value={r.match} onChange={(e) => setItem("keywordRules", i, { match: e.target.value })}>
                      <option value="contains">Message contains</option>
                      <option value="exact">Exact message</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Reply">
                  <Textarea rows={2} value={r.replyText} onChange={(e) => setItem("keywordRules", i, { replyText: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={r.handoff} onChange={(e) => setItem("keywordRules", i, { handoff: e.target.checked })} />
                  Then connect the customer to the team
                </label>
              </div>
            ))}
          </Section>

          <Section title="4. Handing over to your team" description="When the bot steps back, the chat is auto-assigned to an agent (Settings → Auto-assign).">
            <Field label="Handoff message">
              <Input value={bot.handoffText} onChange={(e) => set({ handoffText: e.target.value })} />
            </Field>
            <Field label="Words that connect to a person" hint="Customer types one of these (exact) at any time → handoff">
              <TagInput value={bot.handoffKeywords} onChange={(handoffKeywords) => set({ handoffKeywords })} placeholder="Type word + Enter" />
            </Field>
            <Field label="Words that show the menu again" hint="Exact match">
              <TagInput value={bot.menuKeywords} onChange={(menuKeywords) => set({ menuKeywords })} placeholder="Type word + Enter" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <Field label="When the bot doesn't understand">
                <Input value={bot.fallbackText} onChange={(e) => set({ fallbackText: e.target.value })} />
              </Field>
              <Field label="Hand off after" hint="misunderstood messages">
                <Select value={bot.maxFallbacks} onChange={(e) => set({ maxFallbacks: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
            </div>
            <Toggle checked={bot.restartOnResolved} onChange={(v) => set({ restartOnResolved: v })} label="Greet again when a resolved chat gets a new message" description="Off = returning customers go straight to their previous agent." />
            <Field
              label="Greet again when the customer returns after (hours of silence)"
              hint="For chats nobody marked as resolved. 0 = off. Also: if the bot handed a chat to the team and nobody has replied yet, “hi” / “menu” brings the menu back."
              className="max-w-md"
            >
              <Input type="number" min={0} max={720} value={bot.restartAfterHours ?? 24} onChange={(e) => set({ restartAfterHours: Math.max(0, Math.min(720, Number(e.target.value) || 0)) })} />
            </Field>
          </Section>

          <Section
            title="5. Business hours"
            description="Outside these hours the bot still answers, but tells the customer your team is offline instead of “someone will reply shortly”."
            actions={bot.businessHours.enabled && <Badge tone={data.openNow ? "green" : "yellow"}><Clock className="mr-1 h-3 w-3" />{data.openNow ? "Open now" : "Closed now"}</Badge>}
          >
            <Toggle checked={bot.businessHours.enabled} onChange={(v) => setHours({ enabled: v })} label="Use business hours" />
            {bot.businessHours.enabled && (
              <>
                <Field label="Time zone" hint="e.g. Asia/Kolkata, Asia/Dubai, Europe/London">
                  <Input value={bot.businessHours.timezone} onChange={(e) => setHours({ timezone: e.target.value })} />
                </Field>
                <div className="space-y-2">
                  {DAYS.map(([d, label]) => {
                    const day = bot.businessHours.days[d];
                    return (
                      <div key={d} className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex w-20 items-center gap-2">
                          <input type="checkbox" checked={day.open} onChange={(e) => setDay(d, { open: e.target.checked })} /> {label}
                        </label>
                        {day.open ? (
                          <>
                            <Input type="time" className="w-32" value={day.start} onChange={(e) => setDay(d, { start: e.target.value })} aria-label={`${label} opens`} />
                            <span className="text-slate-400">to</span>
                            <Input type="time" className="w-32" value={day.end} onChange={(e) => setDay(d, { end: e.target.value })} aria-label={`${label} closes`} />
                          </>
                        ) : (
                          <span className="text-slate-400">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Field label="Offline message">
                  <Textarea rows={2} value={bot.businessHours.awayText} onChange={(e) => setHours({ awayText: e.target.value })} />
                </Field>
              </>
            )}
          </Section>
        </div>

        <div>
          <div className="space-y-4 lg:sticky lg:top-4">
            <Card className="p-5">
              <h2 className="font-medium text-slate-900">Preview</h2>
              <p className="mb-3 text-xs text-slate-500">What the customer sees on WhatsApp. Numbers match the boxes on the left.</p>
              <MenuPreview bot={bot} />
              <AfterAnswerPreview bot={bot} />
            </Card>
            <Button className={cx("w-full justify-center")} onClick={() => save()} loading={saving}>
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
