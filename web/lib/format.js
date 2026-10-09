export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

export function fmtRelative(d) {
  if (!d) return "";
  const date = new Date(d);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (new Date().toDateString() === date.toDateString()) return fmtTime(d);
  if (diff < 7 * 86400) return date.toLocaleDateString("en-IN", { weekday: "short" });
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export const fmtMoney = (n, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);

export const fmtNum = (n) => new Intl.NumberFormat("en-IN").format(n || 0);

export const fmtPhone = (p = "") => (p ? `+${p}` : "");

// A lead's name, else its WhatsApp number, else its Instagram @username (Instagram leads may have no phone)
export const displayName = (c) => (c ? String(c.name || "").trim() || (c.phone ? `+${c.phone}` : c.instagram?.username ? `@${c.instagram.username}` : "Instagram user") : "");

export const initials = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

// Date -> value for <input type="datetime-local"> in the viewer's own time zone
export const toLocalInput = (d) => {
  if (!d) return "";
  const date = new Date(d);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
