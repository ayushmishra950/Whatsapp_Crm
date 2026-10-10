"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { useSocketEvent } from "@/lib/socket";
import { fmtPhone, displayName } from "@/lib/format";
import { cx } from "./ui";
import { useToast } from "./toast";

const PREF_KEY = "crm_notifications"; // "on" | "off" (per browser)

const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
};

// Short two-tone "ding" made with the Web Audio API (no sound file needed)
let audioCtx;
function ding() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    });
  } catch {
    // Browser blocked audio (no click on the page yet) - ignore
  }
}

/**
 * Plays a sound and shows a desktop notification when a customer sends a message,
 * unless that chat is already open on screen. Mounted once for the whole business panel.
 */
export function NewMessageNotifier() {
  const router = useRouter();
  const enabledRef = useRef(true);

  useEffect(() => {
    enabledRef.current = readPref();
    const onChange = () => (enabledRef.current = readPref());
    window.addEventListener("crm-notify-pref", onChange);
    return () => window.removeEventListener("crm-notify-pref", onChange);
  }, []);

  // New Facebook / Instagram comment from a customer: sound + pop-up (+ desktop alert when the tab is hidden)
  const toast = useToast();
  const seenComments = useRef(new Set());
  useSocketEvent("social:comment", (c) => {
    if (!c || c.fromBusiness || c.readAt || c.deletedAt || !enabledRef.current) return;
    if (Date.now() - new Date(c.createdAt).getTime() > 2 * 60 * 1000 || seenComments.current.has(c._id)) return; // only just-arrived ones, once
    seenComments.current.add(c._id);
    if (window.location.pathname.startsWith("/app/social/comments") && !document.hidden) return; // already looking at them
    const where = c.platform === "facebook" ? "Facebook" : "Instagram";
    const who = c.from?.name || (c.from?.username ? `@${c.from.username}` : "Someone");
    ding();
    toast.info(
      <>
        💬 New {where} comment from <b>{who}</b>: {String(c.text || "").slice(0, 80)}{" "}
        <Link href="/app/social/comments" className="font-medium text-brand-700 hover:underline">Open</Link>
      </>
    );
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`💬 ${where} comment · ${who}`, { body: c.text || "", tag: `comment-${c._id}` });
      n.onclick = () => {
        window.focus();
        router.push("/app/social/comments");
        n.close();
      };
    }
  });

  useSocketEvent("message:new", ({ message, conversation }) => {
    if (message.direction !== "inbound" || !enabledRef.current) return;
    const openChat = new URLSearchParams(window.location.search).get("c");
    const viewingThisChat = window.location.pathname.startsWith("/app/inbox") && openChat === conversation._id && !document.hidden;
    if (viewingThisChat) return;

    ding();
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const who = displayName(conversation.contactId) || "Customer";
      const n = new Notification(`💬 ${who}`, { body: message.text || "New message", tag: conversation._id });
      n.onclick = () => {
        window.focus();
        router.push(`/app/inbox?c=${conversation._id}`);
        n.close();
      };
    }
  });

  return null;
}

/** On/off button for message alerts (also asks the browser for desktop-notification permission) */
export function NotificationToggle({ className }) {
  const [on, setOn] = useState(readPref);
  const [permission, setPermission] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));

  const toggle = async () => {
    const next = !on;
    if (next && permission === "default") setPermission(await Notification.requestPermission());
    try {
      localStorage.setItem(PREF_KEY, next ? "on" : "off");
    } catch {}
    window.dispatchEvent(new Event("crm-notify-pref"));
    setOn(next);
    if (next) ding();
  };

  const askPermission = async () => setPermission(await Notification.requestPermission());

  return (
    <div className={cx("flex items-center gap-2 text-xs", className)}>
      <button
        type="button"
        onClick={toggle}
        className={cx("flex items-center gap-1.5 rounded-md px-2 py-1 font-medium", on ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500")}
        title={on ? "Sound + desktop alerts for new customer messages are ON" : "Message alerts are OFF"}
      >
        {on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />} Alerts {on ? "on" : "off"}
      </button>
      {on && permission === "default" && (
        <button type="button" onClick={askPermission} className="text-brand-700 underline">Allow desktop pop-ups</button>
      )}
      {on && permission === "denied" && <span className="text-slate-400" title="Allow notifications for this site in your browser settings">Pop-ups blocked by browser</span>}
    </div>
  );
}
