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

// Where a lead came from (same as the server). whatsapp / ad / import are set automatically.
export const LEAD_SOURCES = [
  ["whatsapp", "WhatsApp (direct)"],
  ["instagram", "Instagram (direct)"],
  ["ad", "Facebook / Insta ad"],
  ["import", "Sheet import"],
  ["manual", "Added by hand"],
  ["website", "Website enquiry"],
  ["walkin", "Walk-in"],
  ["referral", "Referral"],
  ["call", "Phone call"],
  ["other", "Other"],
];
export const MANUAL_SOURCES = LEAD_SOURCES.filter(([v]) => !["whatsapp", "instagram", "ad", "import"].includes(v));

// Template variables from the lead's course (Courses page), the counsellor and Settings → Message info
export const COURSE_FIELDS = [
  { value: "course.name", label: "Course name" },
  { value: "course.outcome", label: "Course outcome" },
  { value: "course.next_batch", label: "Next batch date" },
  { value: "course.per_day", label: "Fee per day" },
  { value: "course.fees", label: "Fees text (EN / Hinglish)" },
  { value: "course.greeting", label: "Course greeting (EN / Hinglish)" },
  { value: "course.duration", label: "Course duration" },
  { value: "course.internship", label: "Internship line" },
  { value: "course.proof_link", label: "Course proof link" },
  { value: "course.link", label: "Course website page" },
];
export const BUSINESS_FIELDS = [
  { value: "counsellor", label: "Counsellor name" },
  { value: "business.name", label: "Business name" },
  { value: "business.review_link", label: "Review link" },
  { value: "business.proof_link", label: "Proof / results link" },
  { value: "business.offer_end", label: "Offer end date" },
  { value: "business.address", label: "Address" },
  { value: "business.maps_link", label: "Google Maps link" },
  { value: "business.payment_details", label: "Payment details" },
  { value: "business.city", label: "City" },
  { value: "business.students_trained", label: "Students trained" },
  { value: "business.since_year", label: "Since (year)" },
  { value: "business.rating", label: "Rating" },
];

export function useContactFields() {
  const { session } = useAuth();
  const custom = (session?.tenant?.settings?.contactFields || []).map((f) => ({ ...f, type: f.type || "text" }));
  const options = [...BUILTIN_FIELDS, ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label, type: f.type })), ...REFERRAL_FIELDS, ...COURSE_FIELDS, ...BUSINESS_FIELDS];
  const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
  return {
    custom,
    dateFields: custom.filter((f) => f.type === "date"),
    // Fields for contact filters (no variables-only entries)
    contactOptions: [...BUILTIN_FIELDS, ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label, type: f.type }))],
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
