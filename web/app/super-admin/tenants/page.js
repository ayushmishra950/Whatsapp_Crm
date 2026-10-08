"use client";
/* eslint-disable @next/next/no-img-element -- logos are small data URLs, next/image would not optimise them */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Building2, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { useSocketEvent } from "@/lib/socket";
import { BUSINESS_TYPES } from "@/lib/business";
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Pagination, PasswordInput, Select, StatusBadge, Table,
} from "@/components/ui";

const emptyForm = {
  name: "", email: "", phone: "", planId: "", subscriptionStatus: "trial", months: 1, businessType: "general", sampleCourses: false,
  admin: { existingLogin: false, name: "", email: "", password: "" },
};

export default function TenantsPage() {
  const toast = useToast();
  const { impersonate } = useAuth();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api("/superadmin/tenants", { query: { search, page } }).then(setData).catch(toast.error);
  }, [search, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api("/superadmin/plans").then((p) => setPlans(p.filter((x) => x.isActive)));
  }, []);
  // A business was renamed / edited (by its admin or another Super Admin screen): refresh the list
  useSocketEvent("tenant:updated", () => load());

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAdmin = (k, v) => setForm((f) => ({ ...f, admin: { ...f.admin, [k]: v } }));

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/superadmin/tenants", { method: "POST", body: { ...form, planId: form.planId || plans[0]?._id } });
      toast.success("Business created");
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "name",
      label: "Business",
      render: (t) => (
        <Link href={`/super-admin/tenants/${t._id}`} className="flex items-start gap-2 font-medium text-slate-900 hover:text-brand-700">
          {t.logo ? <img src={t.logo} alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded object-contain" /> : <span className="mt-0.5 h-7 w-7 shrink-0 rounded bg-slate-100" />}
          <span>
          {t.name}
          {t.businessType === "coaching" && <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Coaching</span>}
          <span className="block text-xs font-normal text-slate-500">{t.admin?.email}</span>
          </span>
        </Link>
      ),
    },
    { key: "plan", label: "Plan", render: (t) => t.plan?.name || "—" },
    { key: "sub", label: "Subscription", render: (t) => <StatusBadge status={t.subscription?.status} /> },
    { key: "end", label: "Valid till", render: (t) => fmtDate(t.subscription?.currentPeriodEnd) },
    { key: "usage", label: "Agents / Contacts", render: (t) => `${t.agentCount} / ${t.contactCount}` },
    { key: "wa", label: "WhatsApp", render: (t) => (t.whatsapp?.mode === "live" ? <Badge tone="green">Live</Badge> : <Badge tone="yellow">Sandbox</Badge>) },
    { key: "status", label: "Status", render: (t) => <StatusBadge status={t.status} /> },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (t) => (
        <Button variant="ghost" size="sm" onClick={() => impersonate(t._id).catch(toast.error)} title="Open this business as admin">
          <LogIn className="h-4 w-4" /> Login as
        </Button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Businesses"
        description="Every business has its own WhatsApp number, team, contacts and chats."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New business</Button>}
      />
      <Card>
        <div className="border-b border-slate-200 p-3">
          <div className="relative max-w-xs">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search businesses" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        {!data ? (
          <PageLoader />
        ) : (
          <>
            <Table columns={columns} rows={data.items} empty={<EmptyState icon={Building2} title="No businesses yet" description="Create the first business and its admin login." />} />
            <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New business"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" form="tenant-form" loading={saving}>Create business</Button>
          </>
        }
      >
        <form id="tenant-form" onSubmit={create} className="space-y-4">
          <Field label="Business name"><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          </div>
          <Field label="Business type" hint="Coaching institute = courses, Hinglish templates and the 19-status lead playbook, set up automatically">
            <Select value={form.businessType} onChange={(e) => set("businessType", e.target.value)}>
              {BUSINESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          {form.businessType === "coaching" && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={form.sampleCourses} onChange={(e) => set("sampleCourses", e.target.checked)} />
              <span>Also add the sample course catalog (51 IT &amp; skill courses: AI, coding, digital marketing, office, communication…). Leave off if the institute teaches other courses.</span>
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Plan">
              <Select value={form.planId || plans[0]?._id || ""} onChange={(e) => set("planId", e.target.value)}>
                {plans.map((p) => <option key={p._id} value={p._id}>{p.name} (₹{p.priceMonthly}/mo)</option>)}
              </Select>
            </Field>
            <Field label="Start as">
              <Select value={form.subscriptionStatus} onChange={(e) => set("subscriptionStatus", e.target.value)}>
                <option value="trial">Trial</option>
                <option value="active">Paid (active)</option>
              </Select>
            </Field>
            <Field label="Months">
              <Input type="number" min={1} max={36} value={form.months} onChange={(e) => set("months", e.target.value)} />
            </Field>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-medium text-slate-800">Admin login for this business</p>
            <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={form.admin.existingLogin} onChange={(e) => setAdmin("existingLogin", e.target.checked)} />
              <span>
                Admin already has a login (for another business)
                <span className="block text-xs text-slate-500">The client opens both businesses with the same email and password, and switches between them from the sidebar.</span>
              </span>
            </label>
            {form.admin.existingLogin ? (
              <Field label="Their login email" hint="This business is added to that login. Their password does not change."><Input required type="email" value={form.admin.email} onChange={(e) => setAdmin("email", e.target.value)} /></Field>
            ) : (
              <div className="space-y-3">
                <Field label="Admin name"><Input required value={form.admin.name} onChange={(e) => setAdmin("name", e.target.value)} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Admin email"><Input required type="email" value={form.admin.email} onChange={(e) => setAdmin("email", e.target.value)} /></Field>
                  <Field label="Password" hint="Min 8 characters"><PasswordInput required minLength={8} value={form.admin.password} onChange={(e) => setAdmin("password", e.target.value)} /></Field>
                </div>
              </div>
            )}
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
