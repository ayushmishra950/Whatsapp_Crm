"use client";

import { LayoutDashboard, Building2, CreditCard, ScrollText } from "lucide-react";
import { Shell } from "@/components/shell";

const NAV = [
  { href: "/super-admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/super-admin/tenants", label: "Businesses", icon: Building2 },
  { href: "/super-admin/plans", label: "Plans", icon: CreditCard },
  { href: "/super-admin/audit-logs", label: "Audit logs", icon: ScrollText },
];
const ROLES = ["super_admin"];

export default function SuperAdminLayout({ children }) {
  return (
    <Shell roles={ROLES} nav={NAV}>
      {children}
    </Shell>
  );
}
