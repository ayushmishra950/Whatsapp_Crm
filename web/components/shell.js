"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, MessageCircle, X, ShieldAlert } from "lucide-react";
import { useAuth, homeFor } from "@/lib/auth";
import { Avatar, PageLoader, cx } from "./ui";
import { ROLE_LABELS, pageNameFor, useDocumentTitle } from "@/lib/page-title";

/**
 * App frame with sidebar. `roles` guards the section; `nav` items can be
 * limited with `roles: [...]`. `banner` renders above the content.
 */
export function Shell({ roles, nav, children, fullHeight }) {
  const { session, loading, logout, stopImpersonating } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const allowed = session && roles.includes(session.user.role);
  const pageName = pageNameFor(pathname);
  const roleLabel = session ? ROLE_LABELS[session.user.role] : "";
  useDocumentTitle(allowed ? `${pageName} · ${roleLabel}` : "WhatsApp CRM");

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!roles.includes(session.user.role)) router.replace(homeFor(session.user.role));
  }, [loading, session, roles, router]);

  if (loading || !allowed) return <PageLoader />;

  const { user, tenant, impersonating } = session;
  const items = nav.filter((n) => !n.roles || n.roles.includes(user.role));
  const isActive = (href) => (href === "/app" || href === "/super-admin" ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <MessageCircle className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{tenant?.name || "WhatsApp CRM"}</p>
          <p className="text-xs text-slate-500">{roleLabel}</p>
        </div>
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setMenuOpen(false)}
            className={cx(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive(href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <Icon className="h-4.5 w-4.5" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <Avatar name={user.name} className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button onClick={logout} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Logout" aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button onClick={() => setMenuOpen(false)} className="absolute top-3.5 right-3 rounded p-1 text-slate-400" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {impersonating && (
          <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            <ShieldAlert className="h-4 w-4" />
            <span>You are viewing <b>{tenant?.name}</b> as super admin. All actions are logged.</span>
            <button onClick={stopImpersonating} className="rounded bg-amber-900 px-2 py-0.5 text-xs font-medium text-white">
              Exit
            </button>
          </div>
        )}
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-slate-900">{tenant?.name || "WhatsApp CRM"}</span>
        </header>
        <main className={cx("min-h-0 flex-1", fullHeight ? "overflow-hidden" : "scroll-thin overflow-y-auto")}>
          {children}
        </main>
      </div>
    </div>
  );
}

export const PageContainer = ({ children }) => <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</div>;
