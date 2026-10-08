"use client";

import { useAuth } from "./auth";

// Same defaults as the server (server/src/services/leadStatuses.js), used until the session loads
export const DEFAULT_LEAD_STATUSES = [
  { key: "new", label: "New", color: "purple" },
  { key: "contacted", label: "Contacted", color: "blue" },
  { key: "qualified", label: "Interested", color: "yellow" },
  { key: "converted", label: "Converted", color: "green" },
  { key: "lost", label: "Not interested", color: "red" },
];
export const STATUS_COLORS = ["gray", "blue", "green", "yellow", "red", "purple"];

// The 7 stages of a lead (same as the server); every status can belong to one
export const STAGES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "demo", label: "Demo" },
  { key: "admission", label: "Admission" },
  { key: "converted", label: "Converted" },
  { key: "closed", label: "Nurture & Lost" },
];

/** The business's own lead statuses + helpers */
export function useLeadStatuses() {
  const { session } = useAuth();
  const list = session?.tenant?.settings?.leadStatuses?.length ? session.tenant.settings.leadStatuses : DEFAULT_LEAD_STATUSES;
  const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
  return {
    list,
    label: (key) => byKey[key]?.label || key || "—",
    color: (key) => byKey[key]?.color || "gray",
    // Stages used by this business, with their status keys (for stage tabs)
    stages: STAGES.map((st) => ({ ...st, keys: list.filter((s) => s.stage === st.key).map((s) => s.key) })).filter((st) => st.keys.length),
  };
}
