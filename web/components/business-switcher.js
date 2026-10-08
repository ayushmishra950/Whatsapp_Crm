"use client";
/* eslint-disable @next/next/no-img-element -- logos are small data URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Link2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "./toast";
import { Button, Field, Input, Modal, PasswordInput, cx } from "./ui";

const ROLE = { admin: "Admin", agent: "Counsellor", super_admin: "Super Admin" };

function Logo({ b, className }) {
  return b.logo ? (
    <img src={b.logo} alt="" className={cx("shrink-0 rounded-md border border-slate-100 bg-white object-contain", className)} />
  ) : (
    <span className={cx("flex shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-semibold text-brand-800", className)}>{((b.name || "").match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase()}</span>
  );
}

/**
 * One login, several businesses: the business name in the sidebar opens this list.
 * Tap a business to open it (no logout). Shows unread chats / tasks due in each, and a dot when
 * another business has something waiting.
 */
export function BusinessSwitcher({ children }) {
  const { session, switchBusiness } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");
  const [linking, setLinking] = useState(false);
  const boxRef = useRef(null);
  const many = (session?.businessCount || 1) > 1;

  const load = useCallback(() => api("/auth/businesses").then(setList).catch(() => {}), []);
  // Other businesses' waiting work, every 2 minutes (only when there is more than one)
  useEffect(() => {
    if (!many) return;
    load();
    const t = setInterval(load, 120 * 1000);
    return () => clearInterval(t);
  }, [many, load]);
  useEffect(() => {
    if (!open) return;
    load();
    const away = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, load]);

  const others = (list?.items || []).filter((b) => String(b.userId) !== String(list?.current));
  const waitingElsewhere = others.some((b) => b.unread > 0 || b.tasksDue > 0);

  const pick = async (b) => {
    if (String(b.userId) === String(list?.current) || b.suspended) return;
    setBusy(String(b.userId));
    try {
      await switchBusiness(b.userId);
    } catch (err) {
      toast.error(err);
      setBusy("");
    }
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full min-w-0 items-center gap-1 rounded-md text-left hover:bg-slate-50" title={many ? "Switch business" : "Your login"} aria-label="Switch business">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="relative shrink-0">
          <ChevronsUpDown className="h-4 w-4 text-slate-400" />
          {waitingElsewhere && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" title="Something is waiting in another business" />}
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{many ? "Your businesses" : "Your login"}</p>
          {!list ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
          ) : (
            list.items.map((b) => {
              const current = String(b.userId) === String(list.current);
              return (
                <button key={b.userId} type="button" disabled={b.suspended || !!busy} onClick={() => pick(b)}
                  className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", current ? "bg-brand-50" : "hover:bg-slate-50", b.suspended && "opacity-50")}>
                  <Logo b={b} className="h-7 w-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{b.name}</span>
                    <span className="block text-xs text-slate-500">{ROLE[b.role] || b.role}{b.suspended ? " · suspended" : ""}</span>
                  </span>
                  {busy === String(b.userId) ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : current ? <Check className="h-4 w-4 text-brand-600" /> : (
                    <span className="flex gap-1">
                      {b.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] leading-5 font-semibold text-white" title="Unread chats">{b.unread}</span>}
                      {b.tasksDue > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[11px] leading-5 font-semibold text-white" title="Tasks due">{b.tasksDue}</span>}
                    </span>
                  )}
                </button>
              );
            })
          )}
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button type="button" onClick={() => { setOpen(false); setLinking(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50">
              <Link2 className="h-3.5 w-3.5" /> I have another business with a different login
            </button>
          </div>
        </div>
      )}
      {linking && <LinkLoginModal onClose={() => setLinking(false)} onLinked={load} />}
    </div>
  );
}

/** Prove you own another login (its email + password): its businesses join this login */
function LinkLoginModal({ onClose, onLinked }) {
  const toast = useToast();
  const { session, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const link = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api("/auth/link", { method: "POST", body: { email, password } });
      toast.success(`Linked: ${r.businesses.join(", ")}. Open it from the business list. Log in with ${session.user.email} from now on.`);
      await refresh();
      onLinked?.();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Add your other business" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!email || !password} onClick={link}><Link2 className="h-4 w-4" /> Link</Button></>}>
      <form onSubmit={link} className="space-y-3" autoComplete="off">
        <p className="text-sm text-slate-600">Enter the email and password you use for your <b>other</b> business. After linking, one login opens both and you switch from the business name in the sidebar.</p>
        {/* No browser autofill here: it would put the CURRENT login's saved password in, not the other one */}
        <Field label="Other login email"><Input type="email" name="other-login-email" autoComplete="off" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@otherbusiness.com" /></Field>
        <Field label="Its password" hint="Type it yourself: the browser may fill in the password of the login you are using now."><PasswordInput name="other-login-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">From now on log in with <b>{session.user.email}</b> and your current password. The other email stops working as a login; that business&apos;s own email and WhatsApp number do not change.</p>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
