"use client";

import { useAuth } from "./auth";

// Fixed fields every contact has (same as server/src/services/contactFields.js)
export const BUILTIN_FIELDS = [
  { value: "name", label: "Contact name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

/**
 * Contact fields for dropdowns: built-in + the business's custom fields (Settings → Contact fields).
 * Custom fields are used as "custom.<key>" (stored on the contact as customFields.<key>).
 */
// Only for template variables: the contact's refer & earn code and share link
export const REFERRAL_FIELDS = [
  { value: "referral_code", label: "Referral code" },
  { value: "referral_link", label: "Referral link (WhatsApp)" },
];

export function useContactFields() {
  const { session } = useAuth();
  const custom = (session?.tenant?.settings?.contactFields || []).map((f) => ({ ...f, type: f.type || "text" }));
  const options = [...BUILTIN_FIELDS, ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label, type: f.type })), ...REFERRAL_FIELDS];
  const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
  return {
    custom,
    dateFields: custom.filter((f) => f.type === "date"),
    options,
    // Label for a field value; unknown custom keys (e.g. a deleted field) show their key
    label: (value) => byValue[value] || (value?.startsWith("custom.") ? value.slice(7).replace(/_/g, " ") : value),
  };
}

// Value of a field on a contact ("name", "email", "custom.course" ...)
export const contactFieldValue = (contact, field) => {
  if (!contact || !field) return "";
  if (field.startsWith("custom.")) return contact.customFields?.[field.slice(7)] || "";
  return contact[field] || "";
};

// "2002-08-15" -> "15 Aug 2002", "0000-08-15" -> "15 Aug"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtFieldDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] !== "0000" ? ` ${m[1]}` : ""}` : v || "";
};
