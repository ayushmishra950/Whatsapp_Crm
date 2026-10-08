"use client";

import { useAuth } from "./auth";

// Business types (same as the server). "coaching" gets the coaching-institute format (courses, Infonic playbook).
export const BUSINESS_TYPES = [
  ["general", "General business"],
  ["coaching", "Coaching institute"],
];

/** Is the logged-in business a coaching institute? */
export function useIsCoaching() {
  const { session } = useAuth();
  return session?.tenant?.businessType === "coaching";
}
