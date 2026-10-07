"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Pencil, Send, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { CAMPAIGN_PREFILL_KEY } from "@/components/contacts/import-wizard";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Table, Toggle } from "@/components/ui";

/** Facebook / Instagram Click-to-WhatsApp ads: name them, tag their leads, message each ad's leads separately */
export default function AdsPage() {
  const toast = useToast();
  const router = useRouter();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [ads, setAds] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/ads").then(setAds).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/ads/${editing._id}`, { method: "PATCH", body: { name: editing.name, tag: editing.tag, applyToExisting: editing.applyToExisting } });
      toast.success(r.tagged ? `Saved. Tag added to ${r.tagged} existing lead(s).` : "Saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  // Open a new bulk campaign with this ad's leads as the audience
  const message = (ad) => {
    try {
      sessionStorage.setItem(CAMPAIGN_PREFILL_KEY, JSON.stringify({ audience: { type: "ads", adIds: [ad.sourceId] }, label: `Leads from ad "${ad.displayName}" (${ad.leads})` }));
    } catch {}
    router.push("/app/campaigns/new");
  };

  if (!ads) return <PageLoader />;
  const canBroadcast = isAdmin || session.tenant?.settings?.agentsCanBroadcast;

  return (
    <PageContainer>
      <PageHeader
        title="Facebook / Instagram ads"
        description="Every Click-to-WhatsApp ad that brought leads. Give each ad a name and a tag (e.g. php, mern, video-editing) so you can message each course's leads differently."
      />
      <Card>
        <Table
          columns={[
            {
              key: "ad",
              label: "Ad",
              render: (a) => (
                <div className="min-w-48">
                  <p className="font-medium text-slate-900">📣 {a.displayName}</p>
                  {a.name && a.headline && <p className="text-xs text-slate-500">Headline: {a.headline}</p>}
                  <p className="text-xs text-slate-400">ID {a.sourceId}{a.sourceUrl && <> · <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="underline">open</a></>}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Link href={`/app/contacts?source=ad&adId=${encodeURIComponent(a.sourceId)}`}><Button size="sm" variant="ghost" className="!h-7 !px-2"><Users className="h-3.5 w-3.5" /> Leads</Button></Link>
                    {canBroadcast && a.leads > 0 && <Button size="sm" variant="secondary" className="!h-7 !px-2" onClick={() => message(a)}><Send className="h-3.5 w-3.5" /> Message</Button>}
                    {isAdmin && <Button size="sm" variant="secondary" className="!h-7 !px-2" onClick={() => setEditing({ ...a, name: a.name || "", tag: a.tag || "", applyToExisting: true })}><Pencil className="h-3.5 w-3.5" /> Name &amp; tag</Button>}
                  </div>
                </div>
              ),
            },
            { key: "tag", label: "Auto tag", render: (a) => (a.tag ? <Badge tone="blue">{a.tag}</Badge> : <span className="text-xs text-slate-400">—</span>) },
            { key: "leads", label: "Leads", render: (a) => <span><b>{a.leads}</b> <span className="text-xs text-slate-500">({a.last30} in 30d)</span></span> },
            { key: "interested", label: "Interested", render: (a) => a.interested },
            { key: "converted", label: "Converted", render: (a) => <span>{a.converted} <span className="text-xs text-slate-500">({a.leads ? Math.round((a.converted / a.leads) * 100) : 0}%)</span></span> },
            { key: "last", label: "Last lead", className: "whitespace-nowrap", render: (a) => (a.lastLeadAt ? fmtDateTime(a.lastLeadAt) : "—") },
          ]}
          rows={ads}
          empty={<EmptyState icon={Megaphone} title="No ad leads yet" description="When someone messages you from a Click-to-WhatsApp ad on Facebook or Instagram, the ad shows up here automatically." />}
        />
      </Card>
      <p className="mt-3 text-xs text-slate-500">Tip: in Drips you can start a series for leads of one ad (“A new lead comes from a Facebook / Instagram ad”).</p>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Ad name & tag" size="sm"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Headline from Meta: {editing.headline || "—"}</p>
            <Field label="Name (only for you)"><Input maxLength={80} value={editing.name} placeholder="e.g. Video Editing – October" onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Tag for every lead from this ad" hint="Lowercase, e.g. video-editing. Use it in campaigns, drips and filters.">
              <Input maxLength={40} value={editing.tag} placeholder="e.g. video-editing" onChange={(e) => setEditing({ ...editing, tag: e.target.value.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/\s+/g, "-") })} />
            </Field>
            <Toggle checked={editing.applyToExisting} onChange={(v) => setEditing({ ...editing, applyToExisting: v })} label="Also tag the leads that already came" description={`${editing.leads} lead(s) so far`} />
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
