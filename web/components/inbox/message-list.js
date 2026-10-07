"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, Ban, Bot, Check, CheckCheck, ChevronDown, Clock, Copy, Download, EyeOff, FileText, List as ListIcon, MousePointerClick, Pencil, PencilLine, Reply, StickyNote, Trash2,
} from "lucide-react";
import { API_URL, fetchBlobUrl } from "@/lib/api";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { cx } from "@/components/ui";

// Must match OWN_DELETE_WINDOW_MS on the server
export const OWN_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const canDeleteOwn = (m) => m.status === "failed" || Date.now() - new Date(m.createdAt).getTime() <= OWN_DELETE_WINDOW_MS;

// WhatsApp-sent message deleted by the person who sent it (vs hidden by an admin)
const deletedBySender = (m) => m.deletedBy?._id && m.deletedBy._id === m.sentBy?._id;

function StatusIcon({ status }) {
  if (status === "queued") return <Clock className="h-3.5 w-3.5" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5" />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  return null;
}

function MediaContent({ message }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(false);
  const media = message.media || {};
  const localUrl = media.url ? `${API_URL}${media.url}` : null;
  const src = localUrl || blobUrl;

  const load = () => fetchBlobUrl(`/media/${message._id}`).then(setBlobUrl).catch(() => setError(true));

  if (!src) {
    return (
      <button onClick={load} className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-xs text-slate-600">
        <Download className="h-4 w-4" /> {error ? "Media unavailable" : `Load ${message.type}`}
      </button>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- media is served by the API, not optimisable by next/image
  if (message.type === "image") return <img src={src} alt={media.caption || "image"} className="max-h-72 rounded-md" />;
  if (message.type === "video") return <video src={src} controls className="max-h-72 rounded-md" />;
  if (message.type === "audio") return <audio src={src} controls />;
  return (
    <a href={src} target="_blank" rel="noreferrer" download={media.fileName} className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-xs text-slate-700">
      <FileText className="h-4 w-4" /> {media.fileName || "Document"}
    </a>
  );
}

// One-line summary of a message, used in quote previews
export function messageSnippet(m) {
  if (!m) return "";
  if (m.deletedAt) return "🚫 Message deleted";
  if (m.text) return m.text;
  if (m.type === "template") return `📋 ${m.template?.name || "Template"}`;
  if (m.media) return `📎 ${m.media.caption || m.media.fileName || m.type}`;
  return m.type;
}

export function authorOf(m, contactName) {
  if (!m) return "";
  if (m.direction === "inbound") return contactName || "Customer";
  if (m.isBot) return "🤖 Bot";
  if (m.automation?.kind) return m.automation.kind === "followup" ? "⏰ Follow-up" : `⚡ ${m.automation.name || "Drip"}`;
  return m.sentBy?.name || "You";
}

export function QuoteBlock({ message, contactName, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cx("block w-full rounded-md border-l-4 border-brand-500 bg-black/5 px-2.5 py-1.5 text-left", onClick && "hover:bg-black/10", className)}
    >
      <span className="block text-[11px] font-semibold text-brand-700">{authorOf(message, contactName)}</span>
      <span className="line-clamp-2 block text-xs break-words whitespace-pre-wrap text-slate-600">{messageSnippet(message)}</span>
    </button>
  );
}

const MENU_WIDTH = 176; // w-44
const MENU_ITEM_HEIGHT = 36; // py-2 + text-sm line
const VIEWPORT_GAP = 8;

/**
 * Where to put the menu so it is always fully visible.
 * Rendered with position:fixed in a portal, so the chat's scroll area can't clip it.
 * It stays inside the chat area (never covers the header or the message box) and opens above the arrow
 * when there isn't enough room below, e.g. for the last message.
 */
function menuPosition(anchor, itemCount, align) {
  const rect = anchor.getBoundingClientRect();
  const area = anchor.closest("[data-menu-boundary]")?.getBoundingClientRect();
  const boundTop = Math.max(VIEWPORT_GAP, (area?.top ?? 0) + VIEWPORT_GAP);
  const boundBottom = Math.min(window.innerHeight, area?.bottom ?? window.innerHeight) - VIEWPORT_GAP;
  const height = itemCount * MENU_ITEM_HEIGHT + 8;

  const spaceBelow = boundBottom - rect.bottom;
  const spaceAbove = rect.top - boundTop;
  const openUp = spaceBelow < height + 4 && spaceAbove > spaceBelow;
  const rawTop = openUp ? rect.top - height - 4 : rect.bottom + 4;
  // If the chat area is very short, keep the menu on screen at least
  const top = Math.min(Math.max(rawTop, boundTop), window.innerHeight - height - VIEWPORT_GAP);

  const preferredLeft = align === "right" ? rect.right - MENU_WIDTH : rect.left;
  const left = Math.min(Math.max(VIEWPORT_GAP, preferredLeft), window.innerWidth - MENU_WIDTH - VIEWPORT_GAP);
  return { top, left, openUp };
}

// Chatbot menu as the customer sees it: reply buttons or a list
function InteractiveOptions({ interactive }) {
  if (!interactive?.options?.length) return null;
  if (interactive.kind === "buttons") {
    return (
      <div className="mt-2 space-y-1">
        {interactive.options.map((o) => (
          <div key={o.id} className="rounded-md border border-black/5 bg-white/70 py-1.5 text-center text-xs font-medium text-sky-700">{o.title}</div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-black/5 bg-white/70 p-2 text-xs">
      <p className="mb-1 flex items-center gap-1 font-medium text-sky-700"><ListIcon className="h-3.5 w-3.5" /> {interactive.buttonLabel || "View options"}</p>
      <ol className="list-inside list-decimal space-y-0.5 text-slate-700">
        {interactive.options.map((o) => <li key={o.id}>{o.title}</li>)}
      </ol>
    </div>
  );
}

function ActionsMenu({ actions, align }) {
  const [position, setPosition] = useState(null); // null = closed
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const open = !!position;

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    // The menu is fixed to the screen, so close it when the chat scrolls or the window resizes
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!actions.length) return null;

  const toggle = () => setPosition(open ? null : menuPosition(buttonRef.current, actions.length, align));

  return (
    <div className="self-start">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className={cx(
          "rounded-full bg-white/90 p-1 text-slate-500 shadow-sm transition-opacity hover:text-slate-800",
          // Visible on hover for mouse users, always visible on touch screens
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        )}
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
            className={cx(
              "fixed z-[60] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg",
              position.openUp ? "origin-bottom" : "origin-top"
            )}
          >
            {actions.map(({ label, icon: Icon, onClick, danger }) => (
              <button
                key={label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setPosition(null);
                  onClick();
                }}
                className={cx("flex h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-slate-50", danger ? "text-red-600" : "text-slate-700")}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

export function MessageList({ messages, hasOlder, onLoadOlder, me, isAdmin, contactName, windowOpen, onReply, onCorrect, onEditNote, onDelete, onCopy }) {
  const endRef = useRef(null);
  const [highlightId, setHighlightId] = useState(null);
  const lastId = messages[messages.length - 1]?._id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  const jumpTo = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
  };

  const actionsFor = (m) => {
    if (m.deletedAt) return [];
    const note = m.direction === "internal";
    const own = m.sentBy?._id === me._id;
    const list = [];
    if (!note && m.waMessageId && m.status !== "failed") list.push({ label: "Reply", icon: Reply, onClick: () => onReply(m) });
    if (m.text || m.media?.caption) list.push({ label: "Copy text", icon: Copy, onClick: () => onCopy(m) });
    if (note && (own || isAdmin)) {
      list.push({ label: "Edit note", icon: Pencil, onClick: () => onEditNote(m) });
      list.push({ label: "Delete note", icon: Trash2, onClick: () => onDelete(m), danger: true });
    }
    if (!note && m.direction === "outbound" && own) {
      // WhatsApp can not edit a sent message, so "edit" = send a corrected copy that quotes the original
      if (m.type === "text" && m.waMessageId && m.status !== "failed" && windowOpen) {
        list.push({ label: "Send correction", icon: PencilLine, onClick: () => onCorrect(m) });
      }
      if (isAdmin || canDeleteOwn(m)) list.push({ label: "Delete", icon: Trash2, onClick: () => onDelete(m), danger: true });
    } else if (!note && isAdmin) {
      list.push({ label: "Hide from CRM", icon: EyeOff, onClick: () => onDelete(m), danger: true });
    }
    return list;
  };

  return (
    <div data-menu-boundary className="scroll-thin flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto bg-chat px-3 py-4 sm:px-6">
      {hasOlder && (
        <div className="flex justify-center pb-2">
          <button onClick={onLoadOlder} className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">Load older messages</button>
        </div>
      )}
      {messages.map((m, i) => {
        const showDay = i === 0 || new Date(m.createdAt).toDateString() !== new Date(messages[i - 1].createdAt).toDateString();
        const out = m.direction === "outbound";
        const note = m.direction === "internal";
        const hidden = !!m.deletedAt;
        const actions = actionsFor(m);
        const highlighted = highlightId === m._id;

        return (
          <div key={m._id} id={`msg-${m._id}`}>
            {showDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-slate-500 shadow-sm">
                  {new Date(m.createdAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </span>
              </div>
            )}

            {note ? (
              <div className="group mx-auto my-2 flex max-w-md items-start gap-1">
                <div className={cx("min-w-0 flex-1 rounded-md border px-3 py-2 text-sm transition-shadow", hidden ? "border-slate-200 bg-white/60 text-slate-400" : "border-amber-200 bg-amber-50 text-amber-900", highlighted && "ring-2 ring-brand-500")}>
                  <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <StickyNote className="h-3 w-3" /> {m.isBot ? "🤖 Auto update" : `Internal note · ${m.sentBy?.name || ""}`} · {fmtTime(m.createdAt)}
                    {m.editedAt && !hidden && <span className="font-normal text-amber-600/80" title={`Edited ${fmtDateTime(m.editedAt)}`}>· edited</span>}
                  </p>
                  {hidden ? (
                    <p className="flex items-center gap-1 italic"><Ban className="h-3.5 w-3.5" /> Note deleted by {m.deletedBy?.name || "a team member"}</p>
                  ) : (
                    <p className="break-words whitespace-pre-wrap">{m.text}</p>
                  )}
                </div>
                <ActionsMenu actions={actions} align="right" />
              </div>
            ) : (
              <div className={cx("group flex items-start gap-1", out ? "flex-row-reverse" : "flex-row", m.customerReaction?.emoji && "mb-3")}>
                <div
                  className={cx(
                    "relative max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm transition-shadow sm:max-w-[65%]",
                    out ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white",
                    hidden && "bg-white/70",
                    highlighted && "ring-2 ring-brand-500"
                  )}
                >
                  {hidden ? (
                    <p className="flex items-center gap-1.5 text-slate-400 italic">
                      <Ban className="h-3.5 w-3.5" />
                      {deletedBySender(m)
                        ? m.deletedBy._id === me._id ? "You deleted this message" : `Message deleted by ${m.deletedBy.name}`
                        : `Message hidden by ${m.deletedBy?.name || "admin"}`}
                    </p>
                  ) : (
                    <>
                      {m.replyTo && (
                        <QuoteBlock message={m.replyTo} contactName={contactName} onClick={() => jumpTo(m.replyTo._id)} className="mb-1.5" />
                      )}
                      {m.type === "template" && <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500"><FileText className="h-3 w-3" /> {m.template?.name}</p>}
                      {["image", "video", "audio", "document"].includes(m.type) && <MediaContent message={m} />}
                      {m.referral?.sourceId && (
                        <a
                          href={m.referral.sourceUrl || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-1.5 block rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900"
                        >
                          <span className="block font-semibold">📣 From ad: {m.referral.headline || m.referral.sourceId}</span>
                          {m.referral.body && <span className="line-clamp-2 block text-violet-800/80">{m.referral.body}</span>}
                        </a>
                      )}
                      {m.direction === "inbound" && m.interactive?.replyId && (
                        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500"><MousePointerClick className="h-3 w-3" /> Tapped option</p>
                      )}
                      {(m.text || m.media?.caption) && <p className="break-words whitespace-pre-wrap text-slate-800">{m.text || m.media?.caption}</p>}
                      {m.type === "interactive" && <InteractiveOptions interactive={m.interactive} />}
                    </>
                  )}
                  <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                    {out && m.isBot && <span className="mr-1 inline-flex items-center gap-0.5 font-medium text-violet-600"><Bot className="h-3 w-3" /> Bot ·</span>}
                    {out && m.automation?.kind && <span className="mr-1 font-medium text-amber-700">{m.automation.kind === "followup" ? "⏰ Follow-up" : `⚡ Drip: ${m.automation.name}`} ·</span>}
                    {out && !m.isBot && !m.automation?.kind && m.sentBy?.name && <span className="mr-1">{m.sentBy.name} ·</span>}
                    <span title={fmtDateTime(m.createdAt)}>{fmtTime(m.createdAt)}</span>
                    {out && !hidden && <StatusIcon status={m.status} />}
                  </div>
                  {!hidden && m.status === "failed" && m.error && <p className="mt-1 text-[11px] text-red-600">{m.error}</p>}
                  {!hidden && m.customerReaction?.emoji && (
                    <span
                      className={cx("absolute -bottom-3 rounded-full border border-slate-200 bg-white px-1.5 text-sm leading-5 shadow-sm", out ? "right-2" : "left-2")}
                      title={`${contactName || "Customer"} reacted ${fmtDateTime(m.customerReaction.at)}`}
                    >
                      {m.customerReaction.emoji}
                    </span>
                  )}
                </div>
                <ActionsMenu actions={actions} align={out ? "right" : "left"} />
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
