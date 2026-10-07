"use client";

import { LayoutDashboard, Building2, CreditCard, ScrollText } from "lucide-react";
import { Shell } from "@/components/shell";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";

const NAV = [
  { href: "/super-admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/super-admin/tenants", label: "Businesses", icon: Building2 },
  { href: "/super-admin/plans", label: "Plans", icon: CreditCard },
  { href: "/super-admin/audit-logs", label: "Audit logs", icon: ScrollText },
];
const ROLES = ["super_admin"];

const FIELD_LABELS = { name: "name", email: "email", phone: "phone" };

/** Live notifications for the platform owner, e.g. a business admin renamed their business */
function SuperAdminNotifier() {
  const toast = useToast();
  useSocketEvent("tenant:updated", (u) => {
    if (u.by?.role === "super_admin") return; // your own edit, already confirmed on screen
    const who = `${u.by?.name || "Admin"}${u.by?.viaSuperAdmin ? " (via Super Admin login)" : ""}`;
    if (u.changes?.name) {
      toast.info(`🏢 Business renamed: "${u.changes.name.from}" → "${u.changes.name.to}" by ${who}`);
    } else if (u.changes) {
      const fields = Object.keys(u.changes).map((k) => FIELD_LABELS[k] || k).join(", ");
      toast.info(`🏢 "${u.name}" updated its ${fields} (by ${who})`);
    }
  });
  return null;
}

export default function SuperAdminLayout({ children }) {
  return (
    <Shell roles={ROLES} nav={NAV}>
      <SuperAdminNotifier />
      {children}
    </Shell>
  );
}
