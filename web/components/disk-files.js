"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { api, API_URL } from "@/lib/api";
import { fmtDateTime, fmtPhone, displayName } from "@/lib/format";
import { useToast } from "./toast";
import { Badge, Button, ConfirmModal, cx } from "./ui";

const size = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Chat files kept on this server because the Cloudinary upload failed.
 * They upload again by themselves; the admin can open, retry now or delete them.
 */
export function DiskFiles() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // ids
  const load = useCallback(() => api("/settings/disk-files").then(setData).catch(toast.error), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  // Opened from a storage alert (…/settings#disk-files): scroll here once the list is in
  useEffect(() => {
    if (data && window.location.hash === "#disk-files") document.getElementById("disk-files")?.scrollIntoView({ behavior: "smooth" });
  }, [data]);

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { items, usage, storage, limits } = data;
  const allPicked = items.length > 0 && picked.length === items.length;
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const retry = async (ids) => {
    setBusy("retry");
    try {
      const r = await api("/settings/disk-files/retry", { method: "POST", body: ids ? { ids } : {} });
      toast.success(r.done ? `${r.done} file(s) saved to Cloudinary and removed from the disk` : "Tried again — still waiting (see the reason on each file)");
      setPicked([]);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      const r = await api("/settings/disk-files", { method: "DELETE", body: { ids: confirmDelete } });
      toast.success(`${r.deleted} file(s) deleted from the server`);
      setPicked([]);
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const over = usage.files >= limits.files || usage.bytes >= limits.mb * 1024 * 1024;
  return (
    <div className="space-y-3">
      <div className={cx("rounded-md px-3 py-2 text-sm", over ? "bg-red-50 text-red-800" : usage.files ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-800")}>
        {storage.wanted !== "cloudinary" ? (
          <>Files are stored on this server (STORAGE_DRIVER=local). Set STORAGE_DRIVER=cloudinary and the CLOUDINARY_* keys in .env to keep them in the cloud.</>
        ) : usage.files ? (
          <>
            <b>{usage.files}</b> file(s) · <b>{size(usage.bytes)}</b> waiting on the server disk{usage.failed ? ` · ${usage.failed} need your decision` : ""}. They upload to Cloudinary by themselves every few minutes and are then removed from the disk.
            {storage.active !== "cloudinary" && <> <b>Cloudinary keys are missing in .env</b> — nothing can upload until they are set.</>}
            {over && <> Over the alert limit ({limits.files} files / {limits.mb} MB).</>}
          </>
        ) : (
          <>✓ All files are saved on Cloudinary. Nothing is waiting on the server disk.</>
        )}
      </div>

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : items.map((f) => f._id))} /> Select all
            </label>
            <Button size="sm" variant="secondary" loading={busy === "retry"} onClick={() => retry(picked.length ? picked : undefined)}>
              <RefreshCw className="h-3.5 w-3.5" /> {picked.length ? `Retry ${picked.length}` : "Retry all now"}
            </Button>
            <Button size="sm" variant="danger" disabled={!picked.length} onClick={() => setConfirmDelete(picked)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete {picked.length || ""}
            </Button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {items.map((f) => (
              <li key={f._id} className="flex items-start gap-2 px-3 py-2 text-sm">
                <input type="checkbox" className="mt-1" checked={picked.includes(f._id)} onChange={() => toggle(f._id)} aria-label={`Select ${f.fileName}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a href={`${API_URL}${f.url}`} target="_blank" rel="noreferrer" className="truncate font-medium text-slate-800 hover:text-brand-700 hover:underline" title="Open the file">
                      {f.fileName || "file"} <ExternalLink className="inline h-3 w-3" />
                    </a>
                    <Badge tone={f.status === "failed" ? "red" : "yellow"}>{f.status === "failed" ? "needs you" : "waiting"}</Badge>
                    <span className="text-xs text-slate-500">{size(f.size)} · {f.direction === "received" ? "from customer" : "sent"}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {f.contactId ? <Link href={`/app/contacts/${f.contactId._id}`} className="hover:underline">{displayName(f.contactId)}</Link> : "—"} · {fmtDateTime(f.createdAt)}
                    {f.status === "pending" && ` · next try ${fmtDateTime(f.nextTryAt)}`}
                  </p>
                  {f.lastError && <p className="text-xs text-red-600">{f.lastError}{f.attempts ? ` (${f.attempts} tries)` : ""}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" className="!h-7 !px-2" onClick={() => retry([f._id])} title="Try again now"><RefreshCw className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="!h-7 !px-2" onClick={() => setConfirmDelete([f._id])} title="Delete from the server"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        danger
        loading={busy === "delete"}
        title={`Delete ${confirmDelete?.length || 0} file(s) from the server?`}
        confirmText="Delete"
        message="They are removed from this server's disk for good and the chat shows “file removed”. Files already delivered stay on the customer's WhatsApp."
      />
    </div>
  );
}
