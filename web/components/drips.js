"use client";

import { Cake, Heart, UserPlus, Flame, Gift, Megaphone } from "lucide-react";

// Ready-made starting points (open the editor pre-filled)
export const IDEAS = [
  { id: "welcome", icon: UserPlus, title: "Welcome series", text: "New lead → welcome today, course details on day 2, offer on day 5. Stops when they reply." },
  { id: "ad", icon: Megaphone, title: "Ad lead nurture", text: "Lead from a Facebook/Instagram ad → messages for that course." },
  { id: "interested", icon: Flame, title: "Interested follow-up", text: "Status becomes Interested → reminder in 2 days, offer in 5. Stops on Converted / Not interested." },
  { id: "birthday", icon: Cake, title: "Birthday offer", text: "Every year on the student's birthday: wishes + a join-now fee offer." },
  { id: "anniversary", icon: Heart, title: "Anniversary wish", text: "Every year on the anniversary date." },
  { id: "refer", icon: Gift, title: "Refer & earn", text: "Old students (Converted): ask them to refer friends with their own code and link." },
];

export function triggerSummary(t, { statusLabel, fieldLabel }) {
  if (!t) return "";
  switch (t.type) {
    case "new_lead":
      return t.sources?.length ? `New lead from ${t.sources.join(" / ")}` : "Any new lead";
    case "ad_lead":
      return t.adIds?.length ? `New lead from ${t.adIds.length} selected ad(s)` : "New lead from any Facebook/Instagram ad";
    case "tag_added":
      return `Tag added: ${t.tags.join(", ")}`;
    case "status_changed":
      return `Status becomes ${t.statuses.map(statusLabel).join(" / ")}`;
    case "date": {
      const when = !t.offsetDays ? "on the day" : t.offsetDays < 0 ? `${-t.offsetDays} day(s) before` : `${t.offsetDays} day(s) after`;
      return `Every year ${when}: ${fieldLabel(t.field)}`;
    }
    default:
      return "People added by hand";
  }
}


export const newStep = (delayDays = 0, sendTime = "", kind = "message") => ({ kind, templateId: "", variables: [], templateIdHi: "", variablesHi: [], text: "", dueMinutes: 30, setStatus: "", delayDays, delayMinutes: 0, sendTime });
const step = newStep;

/** Pre-filled drip for an idea (templates are picked by the admin) */
export function draftFromIdea(id, { dateFields = [], statuses = [] } = {}) {
  const has = (k) => statuses.some((s) => s.key === k);
  const stop = ["converted", "lost"].filter(has);
  const bday = dateFields.find((f) => /birth|dob|bday/i.test(f.key + f.label)) || dateFields[0];
  const anniv = dateFields.find((f) => /anniv/i.test(f.key + f.label)) || dateFields[0];
  const base = { name: "", trigger: { type: "manual", sources: [], adIds: [], tags: [], statuses: [], field: "", offsetDays: 0 }, condition: {}, steps: [step()], stopOnReply: true, stopStatuses: stop, onComplete: { setStatus: "", addTag: "" } };
  switch (id) {
    case "welcome":
      return { ...base, name: "Welcome series", trigger: { ...base.trigger, type: "new_lead" }, steps: [step(0), step(2, "11:00"), step(3, "11:00")] };
    case "ad":
      return { ...base, name: "Ad lead nurture", trigger: { ...base.trigger, type: "ad_lead" }, steps: [step(0), step(1, "11:00")] };
    case "interested":
      return { ...base, name: "Interested follow-up", trigger: { ...base.trigger, type: "status_changed", statuses: has("qualified") ? ["qualified"] : [] }, steps: [step(2, "11:00"), step(3, "11:00")] };
    case "birthday":
      return { ...base, name: "Birthday offer", trigger: { ...base.trigger, type: "date", field: bday ? `custom.${bday.key}` : "" }, steps: [step(0, "10:00")], stopOnReply: false, stopStatuses: [] };
    case "anniversary":
      return { ...base, name: "Anniversary wish", trigger: { ...base.trigger, type: "date", field: anniv ? `custom.${anniv.key}` : "" }, steps: [step(0, "10:00")], stopOnReply: false, stopStatuses: [] };
    case "refer":
      return { ...base, name: "Refer & earn", trigger: { ...base.trigger, type: "manual" }, condition: has("converted") ? { statuses: ["converted"] } : {}, steps: [step(0, "11:00"), step(15, "11:00")], stopOnReply: false, stopStatuses: [] };
    default:
      return base;
  }
}

// Playbook groups (Drips & Automations playbook): drips are shown in these batches, in playbook order
export const DRIP_GROUPS = [
  { key: "first", label: "🤝 Get the first conversation", ids: [1, 2, 3, 4] },
  { key: "interest", label: "🔥 Move interest to action", ids: [5, 6] },
  { key: "blocker", label: "🧱 Remove the blocker", ids: [7, 8] },
  { key: "class", label: "🎓 Get them into a class", ids: [9, 10] },
  { key: "close", label: "✅ Close the admission", ids: [11, 12] },
  { key: "succeed", label: "🚀 Make them succeed", ids: [13, 14, 27] },
  { key: "grow", label: "🎁 Grow from happy students", ids: [15, 18, 19] },
  { key: "winback", label: "🔁 Win them back", ids: [16, 17, 28] },
  { key: "ops", label: "🏫 Run the institute (fees, classes, attendance)", ids: [20, 21, 22, 23, 24, 25, 26] },
];
/** Playbook number of a drip ("D12 Fee pending" -> 12), or null for your own drips */
export const dripNumber = (name = "") => {
  const m = /^D(\d{1,2})\b/.exec(name.trim());
  return m ? Number(m[1]) : null;
};
export const groupOf = (name) => {
  const n = dripNumber(name);
  return n ? DRIP_GROUPS.find((g) => g.ids.includes(n))?.key || "mine" : "mine";
};
