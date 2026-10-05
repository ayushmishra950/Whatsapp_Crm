"use client";

import Link from "next/link";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

export function SubscriptionBanner() {
  const { session } = useAuth();
  const tenant = session?.tenant;
  if (!tenant) return null;

  if (!tenant.subscriptionActive) {
    return (
      <div className="flex items-center gap-2 bg-red-50 px-4 py-2 text-sm text-red-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Your subscription ended on {fmtDate(tenant.subscription?.currentPeriodEnd)}. Sending messages is paused — contact your provider to renew.
      </div>
    );
  }
  if (tenant.whatsappMode !== "live") {
    return (
      <div className="flex items-center gap-2 bg-sky-50 px-4 py-2 text-xs text-sky-800">
        <FlaskConical className="h-4 w-4 shrink-0" />
        <span>
          Sandbox mode: messages are simulated, nothing is sent to real WhatsApp.
          {session.user.role === "admin" && (
            <> <Link href="/app/settings" className="font-medium underline">Connect your WhatsApp number</Link></>
          )}
        </span>
      </div>
    );
  }
  return null;
}
