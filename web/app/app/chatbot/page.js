"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Plus, Trash2, ArrowUp, ArrowDown, Lock, Save, Clock, List as ListIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TagInput } from "@/components/shared";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, PageLoader, Select, Textarea, Toggle, cx } from "@/components/ui";

const ACTIONS = [
  ["reply", "Reply with a message"],
  ["lead", "Ask lead questions, then connect to team"],
  ["handoff", "Connect to team (human)"],
];
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const MAX_OPTIONS = 10;
const MAX_QUESTIONS = 10;

// Remove server-only fields before saving
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
function MenuPreview({ bot }) {
  const options = bot.menu.slice(0, MAX_OPTIONS);
  const asButtons = options.length > 0 && options.length <= 3 && options.every((o) => o.title.length <= 20);
  return (
    <div className="rounded-lg bg-chat p-4">
      <div className="max-w-xs">
        <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
          {bot.welcomeText || "Welcome message…"}
          {!asButtons && options.length > 0 && (
            <div className="mt-2 flex items-center justify-center gap-1.5 border-t border-slate-100 pt-2 text-sm font-medium text-sky-600">
              <ListIcon className="h-4 w-4" /> {bot.menuButtonLabel || "View options"}
            </div>
          )}
        </div>
        {asButtons && (
          <div className="mt-1 space-y-1">
            {options.map((o, i) => (
              <div key={o._id || i} className="rounded-lg bg-white py-2 text-center text-sm font-medium text-sky-600 shadow-sm">{o.title || "Option"}</div>
            ))}
          </div>
        )}
        {!asButtons && options.length > 0 && (
          <div className="mt-2 rounded-lg bg-white p-2 text-sm shadow-sm">
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
        {asButtons ? "Shown as reply buttons (max 3 options, titles up to 20 characters)." : "Shown as a list (up to 10 options)."} Customers can also type the option number, e.g. “2”.
      </p>
    </div>
  );
}

function LeadFieldSelect({ value, onChange }) {
  const kind = value === "name" || value === "email" ? value : "custom";
  const key = kind === "custom" ? value.replace(/^custom\./, "") : "";
  return (
    <div className="flex gap-2">
      <Select className="w-36 shrink-0" value={kind} onChange={(e) => onChange(e.target.value === "custom" ? "custom.field" : e.target.value)} aria-label="Save answer to">
        <option value="name">Name</option>
        <option value="email">Email</option>
        <option value="custom">Custom field</option>
      </Select>
      {kind === "custom" && (
        <Input
          placeholder="e.g. city"
          value={key}
          onChange={(e) => onChange(`custom.${e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30)}`)}
          aria-label="Custom field name"
        />
      )}
    </div>
  );
}

export default function ChatbotPage() {
  const toast = useToast();
  const [data, setData] = useState(null); // { planAllows, openNow, whatsappMode }
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
            <Field label="Welcome message">
              <Textarea rows={3} maxLength={1024} value={bot.welcomeText} onChange={(e) => set({ welcomeText: e.target.value })} />
            </Field>
            {bot.menu.length > 3 && (
              <Field label="List button text" hint="Shown on the button that opens the option list (max 20 characters)">
                <Input maxLength={20} value={bot.menuButtonLabel} onChange={(e) => set({ menuButtonLabel: e.target.value })} />
              </Field>
            )}
            {!bot.menu.length && <p className="text-sm text-slate-500">No menu options. The bot will only send the welcome message and keyword replies.</p>}
            {bot.menu.map((o, i) => (
              <div key={o._id || `new-${i}`} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Option {i + 1}</span>
                  <RowTools index={i} count={bot.menu.length} label="option" onMove={(idx, d) => setList("menu", (l) => move(l, idx, d))} onRemove={(idx) => setList("menu", (l) => l.filter((_, j) => j !== idx))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Option title" hint={`${o.title.length}/24 characters`}>
                    <Input maxLength={24} value={o.title} onChange={(e) => setItem("menu", i, { title: e.target.value })} placeholder="e.g. Price / Plans" />
                  </Field>
                  <Field label="When chosen">
                    <Select value={o.action} onChange={(e) => setItem("menu", i, { action: e.target.value })}>
                      {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label={o.action === "reply" ? "Reply message" : "Message before that (optional)"} className="mt-3">
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
              <div key={q._id || `q-${i}`} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_16rem_auto]">
                <Field label={`Question ${i + 1}`}>
                  <Input value={q.question} onChange={(e) => setItem("leadQuestions", i, { question: e.target.value })} placeholder="e.g. Which city are you from?" />
                </Field>
                <Field label="Save answer to">
                  <LeadFieldSelect value={q.field} onChange={(field) => setItem("leadQuestions", i, { field })} />
                </Field>
                <RowTools index={i} count={bot.leadQuestions.length} label="question" onMove={(idx, d) => setList("leadQuestions", (l) => move(l, idx, d))} onRemove={(idx) => setList("leadQuestions", (l) => l.filter((_, j) => j !== idx))} />
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
              <h2 className="mb-3 font-medium text-slate-900">Preview</h2>
              <MenuPreview bot={bot} />
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
