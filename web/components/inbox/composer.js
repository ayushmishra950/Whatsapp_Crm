"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, FileText, Lock, Paperclip, Reply, Send, StickyNote, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { TemplatePreview, paramsForContact } from "@/components/shared";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "@/components/ui";
import { QuoteBlock } from "./message-list";

// ---------------- Composer ----------------

export function Composer({ conversation, templates, contact, onSent, replyTo, onCancelReply, initialText = "" }) {
  const toast = useToast();
  const [selectedMode, setMode] = useState("reply"); // reply | note
  // Quoting a message always means replying to the customer
  const mode = replyTo ? "reply" : selectedMode;
  const textRef = useRef(null);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  // Cancelling a "Send correction" also drops its untouched pre-filled text
  const cancelReply = () => {
    if (initialText && text === initialText) setText("");
    onCancelReply();
  };
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const fileRef = useRef(null);
  const windowOpen = conversation.windowOpen;
  const canReply = mode === "note" || windowOpen;

  const send = async () => {
    if (sending || (!text.trim() && !file)) return;
    setSending(true);
    try {
      let message;
      if (file && mode === "reply") {
        const form = new FormData();
        form.append("file", file);
        form.append("caption", text.trim());
        if (replyTo) form.append("replyToId", replyTo._id);
        message = await api(`/conversations/${conversation._id}/messages`, { method: "POST", form });
      } else if (mode === "note") {
        message = await api(`/conversations/${conversation._id}/messages`, { method: "POST", body: { type: "note", text: text.trim() } });
      } else {
        message = await api(`/conversations/${conversation._id}/messages`, { method: "POST", body: { type: "text", text: text.trim(), replyToId: replyTo?._id } });
      }
      onSent(message);
      setText("");
      setFile(null);
      if (mode === "reply") onCancelReply();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-1 text-xs">
        <button onClick={() => setMode("reply")} className={cx("rounded-md px-2.5 py-1 font-medium", mode === "reply" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100")}>Reply</button>
        <button onClick={() => { setMode("note"); cancelReply(); }} className={cx("flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", mode === "note" ? "bg-amber-50 text-amber-700" : "text-slate-500 hover:bg-slate-100")}>
          <StickyNote className="h-3 w-3" /> Internal note
        </button>
        {mode === "reply" && (
          <span className={cx("ml-auto flex items-center gap-1", windowOpen ? "text-slate-400" : "text-amber-700")}>
            {windowOpen ? <><Clock className="h-3 w-3" /> 24h reply window open</> : <><Lock className="h-3 w-3" /> Window closed — send a template</>}
          </span>
        )}
      </div>

      {replyTo && (
        <div className="mb-2 flex items-start gap-2">
          <Reply className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
          <QuoteBlock message={replyTo} contactName={contact?.name || fmtPhone(contact?.phone)} className="flex-1" />
          <button onClick={cancelReply} className="mt-1.5 rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cancel reply"><X className="h-4 w-4" /></button>
        </div>
      )}

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-700">
          <Paperclip className="h-3.5 w-3.5" /> <span className="flex-1 truncate">{file.name}</span>
          <button onClick={() => setFile(null)} aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {mode === "reply" && (
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
            <Button size="icon" variant="ghost" disabled={!windowOpen} onClick={() => fileRef.current?.click()} title="Attach file" aria-label="Attach file"><Paperclip className="h-4.5 w-4.5" /></Button>
            <Button size="icon" variant={windowOpen ? "ghost" : "primary"} onClick={() => setTemplateOpen(true)} title="Send template" aria-label="Send template"><FileText className="h-4.5 w-4.5" /></Button>
          </>
        )}
        <Textarea
          ref={textRef}
          rows={1}
          className={cx("max-h-40 min-h-9 flex-1 resize-none", mode === "note" && "border-amber-300 bg-amber-50/50")}
          placeholder={mode === "note" ? "Write a private note for your team…" : windowOpen ? "Type a message…" : "Free-form replies are locked. Use a template."}
          disabled={!canReply}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && replyTo) cancelReply();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="icon" className="h-9 w-9 justify-center" onClick={send} loading={sending} disabled={!canReply || (!text.trim() && !file)} aria-label="Send">
          {!sending && <Send className="h-4 w-4" />}
        </Button>
      </div>

      <TemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        templates={templates}
        contact={contact}
        conversationId={conversation._id}
        replyTo={replyTo}
        onSent={(m) => { onSent(m); setTemplateOpen(false); onCancelReply(); }}
      />
    </div>
  );
}

export function TemplateModal({ open, onClose, templates, contact, conversationId, replyTo, onSent }) {
  const toast = useToast();
  const [templateId, setTemplateId] = useState("");
  const [params, setParams] = useState([]);
  const [sending, setSending] = useState(false);
  const template = useMemo(() => templates.find((t) => t._id === templateId), [templates, templateId]);

  const chooseTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => x._id === id);
    setParams(t ? paramsForContact(t, contact) : []); // template defaults: contact fields + fixed text
  };

  const send = async () => {
    setSending(true);
    try {
      const m = await api(`/conversations/${conversationId}/messages`, { method: "POST", body: { type: "template", templateId, params, replyToId: replyTo?._id } });
      onSent(m);
      setTemplateId("");
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send a template message"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} loading={sending} disabled={!template || params.some((p) => !p.trim())}>Send</Button></>}>
      {!templates.length ? (
        <p className="text-sm text-slate-500">No approved templates. Ask your admin to create one in Templates.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Template">
            <Select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
              <option value="">Select…</option>
              {templates.map((t) => <option key={t._id} value={t._id}>{t.name} ({t.language})</option>)}
            </Select>
          </Field>
          {template && params.map((p, i) => (
            <Field key={i} label={`Value for {{${i + 1}}}`}>
              <Input value={p} onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
          {template && <TemplatePreview {...template} params={params} />}
        </div>
      )}
    </Modal>
  );
}
