import { cx } from "./ui";
import { fmtPhone } from "@/lib/format";

/** "whatsapp" | "instagram" for a chat (chats made before Instagram have no value = WhatsApp) */
export const channelOf = (conversation) => (conversation?.channel === "instagram" ? "instagram" : "whatsapp");

const LOOK = {
  whatsapp: { label: "WhatsApp", short: "WA", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  instagram: { label: "Instagram", short: "IG", cls: "bg-pink-50 text-pink-700 ring-pink-200" },
  facebook: { label: "Facebook", short: "FB", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
};

/** Small pill that says which app the chat is on */
export function ChannelBadge({ channel = "whatsapp", full, className }) {
  const l = LOOK[channel] || LOOK.whatsapp;
  return (
    <span title={l.label} className={cx("inline-flex shrink-0 items-center rounded px-1 text-[10px] leading-4 font-semibold ring-1 ring-inset", l.cls, className)}>
      {full ? l.label : l.short}
    </span>
  );
}

/** Second line under a lead's name: the WhatsApp number, else the Instagram @username */
export const contactHandle = (c) => (c?.phone ? fmtPhone(c.phone) : c?.instagram?.username ? `@${c.instagram.username}` : "");

/** Link to the customer's Instagram profile */
export const instagramUrl = (c) => (c?.instagram?.username ? `https://instagram.com/${c.instagram.username}` : "");
