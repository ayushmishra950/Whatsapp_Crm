"use client";

import { useEffect } from "react";

export const ROLE_LABELS = { super_admin: "Super Admin", admin: "Admin", agent: "Agent" };

// Longest prefix wins, so "/app/campaigns/new" beats "/app/campaigns"
const PAGE_NAMES = [
  ["/super-admin/tenants/", "Business details"],
  ["/super-admin/tenants", "Businesses"],
  ["/super-admin/plans", "Plans"],
  ["/super-admin/audit-logs", "Audit logs"],
  ["/super-admin", "Dashboard"],
  ["/app/inbox", "Inbox"],
  ["/app/contacts", "Contacts / Leads"],
  ["/app/campaigns/new", "New campaign"],
  ["/app/campaigns/", "Campaign report"],
  ["/app/campaigns", "Bulk campaigns"],
  ["/app/templates", "Templates"],
  ["/app/team", "Team"],
  ["/app/chatbot", "Chatbot"],
  ["/app/settings", "Settings"],
  ["/app", "Dashboard"],
];

export function pageNameFor(pathname) {
  const match = PAGE_NAMES.filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] || "WhatsApp CRM";
}

// Sets the browser tab title, e.g. "Settings · Admin"
export function useDocumentTitle(title) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
