"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";
import { api } from "@/lib/api";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Textarea, Toggle } from "@/components/ui";

const emptyPlan = { name: "", description: "", priceMonthly: 0, limits: { agents: 3, contacts: 1000, monthlyMessages: 5000 }, modules: { chatbot: true, instagram: true, social: true }, features: [], isActive: true };

export default function PlansPage() {
  const toast = useToast();
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => api("/superadmin/plans").then(setPlans).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setEditing((p) => ({ ...p, [k]: v }));
  const setLimit = (k, v) => setEditing((p) => ({ ...p, limits: { ...p.limits, [k]: v } }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { _id, tenantCount, createdAt, updatedAt, __v, ...body } = editing;
    body.features = typeof body.features === "string" ? body.features.split("\n").map((f) => f.trim()).filter(Boolean) : body.features;
    try {
      await api(_id ? `/superadmin/plans/${_id}` : "/superadmin/plans", { method: _id ? "PATCH" : "POST", body });
      toast.success("Plan saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/superadmin/plans/${deleting._id}`, { method: "DELETE" });
      toast.success("Plan deleted");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err);
      setDeleting(null);
    }
  };

  if (!plans) return <PageLoader />;

  return (
    <PageContainer>
      <PageHeader
        title="Plans"
        description="Monthly subscription plans and their limits"
        actions={<Button onClick={() => setEditing({ ...emptyPlan })}><Plus className="h-4 w-4" /> New plan</Button>}
      />
      {!plans.length && <Card><EmptyState icon={CreditCard} title="No plans yet" /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p._id} className="flex flex-col p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{fmtMoney(p.priceMonthly, p.currency)}<span className="text-sm font-normal text-slate-500">/month</span></p>
              </div>
              {p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            </div>
            {p.description && <p className="mt-2 text-sm text-slate-500">{p.description}</p>}
            <ul className="mt-4 space-y-1 text-sm text-slate-700">
              <li>👥 {fmtNum(p.limits.agents)} agents</li>
              <li>📇 {fmtNum(p.limits.contacts)} contacts</li>
              <li>✉️ {fmtNum(p.limits.monthlyMessages)} messages / month</li>
              <li>{p.modules?.chatbot !== false ? "🤖 Chatbot included" : <span className="text-slate-400">🤖 No chatbot</span>}</li>
              <li>{p.modules?.instagram !== false ? "📸 Instagram DMs included" : <span className="text-slate-400">📸 No Instagram</span>}</li>
              <li>{p.modules?.social !== false ? "📣 Facebook / Instagram posts & comments" : <span className="text-slate-400">📣 No posts & comments</span>}</li>
              {p.features.map((f) => <li key={f} className="text-slate-500">• {f}</li>)}
            </ul>
            <div className="mt-auto flex items-center justify-between pt-4 text-xs text-slate-500">
              <span>{p.tenantCount} businesses</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setEditing({ ...p, features: p.features.join("\n") })} aria-label="Edit plan"><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleting(p)} aria-label="Delete plan"><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? "Edit plan" : "New plan"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="plan-form" loading={saving}>Save</Button></>}
      >
        {editing && (
          <form id="plan-form" onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input required value={editing.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Price per month (₹)"><Input type="number" min={0} required value={editing.priceMonthly} onChange={(e) => set("priceMonthly", e.target.value)} /></Field>
            </div>
            <Field label="Description"><Input value={editing.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Agents"><Input type="number" min={0} value={editing.limits.agents} onChange={(e) => setLimit("agents", e.target.value)} /></Field>
              <Field label="Contacts"><Input type="number" min={0} value={editing.limits.contacts} onChange={(e) => setLimit("contacts", e.target.value)} /></Field>
              <Field label="Messages / month"><Input type="number" min={0} value={editing.limits.monthlyMessages} onChange={(e) => setLimit("monthlyMessages", e.target.value)} /></Field>
            </div>
            <Field label="Features" hint="One per line">
              <Textarea rows={3} value={Array.isArray(editing.features) ? editing.features.join("\n") : editing.features} onChange={(e) => set("features", e.target.value)} />
            </Field>
            <Toggle checked={editing.modules?.chatbot !== false} onChange={(v) => set("modules", { ...(editing.modules || {}), chatbot: v })} label="Chatbot module" description="Businesses on this plan can use the WhatsApp chatbot" />
            <Toggle checked={editing.modules?.instagram !== false} onChange={(v) => set("modules", { ...(editing.modules || {}), instagram: v })} label="Instagram module" description="Businesses on this plan can connect Instagram and answer Instagram DMs in the inbox" />
            <Toggle checked={editing.modules?.social !== false} onChange={(v) => set("modules", { ...(editing.modules || {}), social: v })} label="Posts & comments module" description="Businesses on this plan can post on their Facebook Page / Instagram and reply to comments from the CRM" />
            <Toggle checked={editing.isActive} onChange={(v) => set("isActive", v)} label="Active" description="Inactive plans can not be chosen for new businesses" />
          </form>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete plan?" confirmText="Delete"
        message={`"${deleting?.name}" will be deleted. Plans used by a business can not be deleted — deactivate them instead.`} />
    </PageContainer>
  );
}
