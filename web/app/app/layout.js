"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, MessagesSquare, Contact, Megaphone, FileText, Users, Settings, Bot, Workflow, Gift, Target, GraduationCap, ClipboardList, Zap, IndianRupee } from "lucide-react";
import { api } from "@/lib/api";
import { NotificationBell } from "@/components/leads";
import { Shell } from "@/components/shell";
import { QuickAddButton } from "@/components/quick-add";
import { useAuth } from "@/lib/auth";
import { SubscriptionBanner } from "./subscription-banner";
import { NewMessageNotifier } from "@/components/notifications";
import { useSocketEvent } from "@/lib/socket";

const ROLES = ["admin", "agent"];

/** Business renamed (by its admin elsewhere or by the Super Admin): reload the session so the new name shows */
function TenantProfileSync() {
  const { refresh } = useAuth();
  useSocketEvent("tenant:profile", () => refresh());
  return null;
}

/** Sidebar badges: unread chats, tasks due, new leads to call, fees due (refreshed live + every minute) */
function useActionCounts(enabled) {
  const [counts, setCounts] = useState({});
  const load = useCallback(() => {
    if (!enabled) return;
    api("/dashboard/counts", { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).then(setCounts).catch(() => {});
  }, [enabled]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60 * 1000);
    return () => clearInterval(t);
  }, [load]);
  // Anything that changes the numbers
  useSocketEvent("task:update", load);
  useSocketEvent("notification:new", load);
  useSocketEvent("message:new", load);
  useSocketEvent("conversation:updated", load);
  return counts;
}

export default function TenantLayout({ children }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const canBroadcast = session?.user.role === "admin" || session?.tenant?.settings?.agentsCanBroadcast;
  const chatbotInPlan = session?.tenant?.plan?.modules?.chatbot !== false;
  const coaching = session?.tenant?.businessType === "coaching";
  const counts = useActionCounts(!!session?.tenant);
  const todayBadge = (counts.newLeads || 0) + (counts.tasksDue || 0) + (counts.feesDue || 0);

  const nav = [
    { href: "/app/today", label: "Today", icon: Zap, badge: todayBadge, badgeTone: "red" },
    { href: "/app", label: "Dashboard", icon: LayoutDashboard },
    { href: "/app/inbox", label: "Inbox", icon: MessagesSquare, badge: counts.unreadChats },
    { href: "/app/contacts", label: "Contacts / Leads", icon: Contact, badge: counts.newLeads, badgeTone: "amber" },
    { href: "/app/tasks", label: "Tasks", icon: ClipboardList, badge: counts.tasksDue, badgeTone: "red" },
    ...(coaching ? [{ href: "/app/fees", label: "Fees", icon: IndianRupee, badge: counts.feesDue, badgeTone: "amber" }] : []),
    ...(canBroadcast ? [{ href: "/app/campaigns", label: "Bulk campaigns", icon: Megaphone }] : []),
    { href: "/app/drips", label: "Drips & automations", icon: Workflow, roles: ["admin"] },
    { href: "/app/ads", label: "Ads", icon: Target },
    { href: "/app/referrals", label: "Refer & earn", icon: Gift, roles: ["admin"] },
    ...(coaching ? [{ href: "/app/courses", label: "Courses", icon: GraduationCap }] : []),
    { href: "/app/templates", label: "Templates", icon: FileText },
    ...(chatbotInPlan ? [{ href: "/app/chatbot", label: "Chatbot", icon: Bot, roles: ["admin"] }] : []),
    { href: "/app/team", label: "Team", icon: Users, roles: ["admin"] },
    { href: "/app/settings", label: "Settings", icon: Settings },
  ];

  const fullHeight = pathname.startsWith("/app/inbox");
  return (
    <Shell roles={ROLES} nav={nav} fullHeight={fullHeight} headerExtra={<NotificationBell />} sidebarAction={session?.tenant && <QuickAddButton className="w-full justify-center" />}>
      <NewMessageNotifier />
      <TenantProfileSync />
      {fullHeight ? (
        // Inbox fills the remaining height below the banner (its panes scroll on their own)
        <div className="flex h-full flex-col">
          <SubscriptionBanner />
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      ) : (
        <>
          <SubscriptionBanner />
          {children}
        </>
      )}
    </Shell>
  );
}
