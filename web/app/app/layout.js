"use client";

import { usePathname } from "next/navigation";
import { LayoutDashboard, MessagesSquare, Contact, Megaphone, FileText, Users, Settings, Bot } from "lucide-react";
import { Shell } from "@/components/shell";
import { useAuth } from "@/lib/auth";
import { SubscriptionBanner } from "./subscription-banner";

const ROLES = ["admin", "agent"];

export default function TenantLayout({ children }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const canBroadcast = session?.user.role === "admin" || session?.tenant?.settings?.agentsCanBroadcast;
  const chatbotInPlan = session?.tenant?.plan?.modules?.chatbot !== false;

  const nav = [
    { href: "/app", label: "Dashboard", icon: LayoutDashboard },
    { href: "/app/inbox", label: "Inbox", icon: MessagesSquare },
    { href: "/app/contacts", label: "Contacts / Leads", icon: Contact },
    ...(canBroadcast ? [{ href: "/app/campaigns", label: "Bulk campaigns", icon: Megaphone }] : []),
    { href: "/app/templates", label: "Templates", icon: FileText },
    ...(chatbotInPlan ? [{ href: "/app/chatbot", label: "Chatbot", icon: Bot, roles: ["admin"] }] : []),
    { href: "/app/team", label: "Team", icon: Users, roles: ["admin"] },
    { href: "/app/settings", label: "Settings", icon: Settings },
  ];

  const fullHeight = pathname.startsWith("/app/inbox");
  return (
    <Shell roles={ROLES} nav={nav} fullHeight={fullHeight}>
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
