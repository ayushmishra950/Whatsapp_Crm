"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn, RefreshCw, Ban, CheckCircle2, KeyRound, Trash2, Pencil } from "lucide-react";
import { useSocketEvent } from "@/lib/socket";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtNum, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { BUSINESS_TYPES } from "@/lib/business";
import { LogoUpload } from "@/components/logo-upload";
import {
  Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, PageLoader, PasswordInput, Select, StatusBadge, Table,
} from "@/components/ui";

export default function TenantDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { impersonate } = useAuth();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [modal, setModal] = useState(null); // renew | password | delete | suspend | edit
  const [edit, setEdit] = useState(null); // { name, email, phone, adminName, adminEmail }
  const [months, setMonths] = useState(1);
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/superadmin/tenants/${id}`).then(setData).catch(toast.error), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    api("/superadmin/plans").then(setPlans);
  }, [load]);
  // The business admin (or another Super Admin screen) changed this business: show the new details
  useSocketEvent("tenant:updated", (u) => u.tenantId === id && load());

  if (!data) return <PageLoader />;
  const { tenant, users, counts } = data;

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    const admin = data.users.find((u) => u.role === "admin");
    setEdit({ name: tenant.name, email: tenant.email || "", phone: tenant.phone || "", adminName: admin?.name || "", adminEmail: admin?.email || "", adminPassword: "", adminPassword2: "", hasAdmin: !!admin });
    setModal("edit");
  };
  const saveEdit = () =>
    run(async () => {
      const admin = data.users.find((u) => u.role === "admin");
      await api(`/superadmin/tenants/${id}`, { method: "PATCH", body: { name: edit.name.trim(), email: edit.email.trim(), phone: edit.phone.trim() } });
      if (admin && (edit.adminName.trim() !== admin.name || edit.adminEmail.trim().toLowerCase() !== admin.email)) {
        await api(`/superadmin/tenants/${id}/admin`, { method: "PATCH", body: { name: edit.adminName.trim(), email: edit.adminEmail.trim() } });
      }
      // Optional: new login password for the admin (emergency, e.g. admin is locked out)
      if (admin && edit.adminPassword) {
        await api(`/superadmin/tenants/${id}/reset-admin-password`, { method: "POST", body: { password: edit.adminPassword } });
      }
    }, edit?.adminPassword ? "Business details and admin password saved" : "Business details saved");
  // New admin password: Save waits until it is valid; a mismatch is shown only after typing in "Confirm"
  const pw = edit?.adminPassword || "";
  const pw2 = edit?.adminPassword2 || "";
  const passwordError = pw && (pw.length < 8 || pw !== pw2) ? "invalid" : "";
  const passwordHint = !pw
    ? null
    : pw.length < 8
    ? { tone: "text-slate-500", text: `At least 8 characters (${pw.length}/8)` }
    : !pw2
    ? { tone: "text-slate-500", text: "Now type the same password in “Confirm new password”." }
    : pw !== pw2
    ? { tone: "text-red-600", text: "Passwords do not match" }
    : { tone: "text-green-700", text: "✓ Passwords match. The admin must log in with the new password from now on; tell them safely." };

  const changeType = (businessType) =>
    run(
      () => api(`/superadmin/tenants/${id}`, { method: "PATCH", body: { businessType } }),
      businessType === "coaching" ? "Coaching institute: courses and the lead playbook are switched on" : "Switched to general business"
    );
  const changePlan = (planId) =>
    run(() => api(`/superadmin/tenants/${id}`, { method: "PATCH", body: { planId } }), "Plan updated");
  const toggleStatus = () =>
    run(
      () => api(`/superadmin/tenants/${id}`, { method: "PATCH", body: { status: tenant.status === "active" ? "suspended" : "active" } }),
      tenant.status === "active" ? "Business suspended" : "Business activated"
    );
  const renew = () =>
    run(() => api(`/superadmin/tenants/${id}/subscription`, { method: "POST", body: { action: "renew", months } }), "Subscription renewed");
  const resetPassword = () =>
    run(() => api(`/superadmin/tenants/${id}/reset-admin-password`, { method: "POST", body: { password } }), "Admin password reset");
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/superadmin/tenants/${id}`, { method: "DELETE", body: { confirmName } });
      toast.success("Business deleted");
      router.replace("/super-admin/tenants");
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  const sub = tenant.subscription || {};
  const plan = tenant.plan;

  return (
    <PageContainer>
      <Link href="/super-admin/tenants" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Businesses
      </Link>
      <PageHeader
        title={tenant.name}
        description={`Created ${fmtDate(tenant.createdAt)} · ${tenant.email || ""}`}
        actions={
          <>
            <Button variant="secondary" onClick={openEdit}><Pencil className="h-4 w-4" /> Edit</Button>
            <Button variant="secondary" onClick={() => impersonate(id).catch(toast.error)}><LogIn className="h-4 w-4" /> Login as admin</Button>
            <Button variant={tenant.status === "active" ? "secondary" : "primary"} onClick={() => setModal("suspend")}>
              {tenant.status === "active" ? <><Ban className="h-4 w-4" /> Suspend</> : <><CheckCircle2 className="h-4 w-4" /> Activate</>}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-slate-900">Subscription</h2>
            <StatusBadge status={sub.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Period</dt><dd>{fmtDate(sub.currentPeriodStart)} – {fmtDate(sub.currentPeriodEnd)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Monthly price</dt><dd>₹{plan?.priceMonthly ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Account</dt><dd><StatusBadge status={tenant.status} /></dd></div>
          </dl>
          <Field label="Plan" className="mt-4">
            <Select value={plan?._id || ""} onChange={(e) => changePlan(e.target.value)} disabled={busy}>
              {plans.map((p) => <option key={p._id} value={p._id}>{p.name} (₹{p.priceMonthly}/mo){!p.isActive ? " — inactive" : ""}</option>)}
            </Select>
          </Field>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Logo</p>
            <LogoUpload
              value={tenant.logo}
              onError={toast.error}
              onSave={async (logo) => {
                await api(`/superadmin/tenants/${id}/logo`, { method: "PUT", body: { logo } });
                await load();
                toast.success(logo ? "Logo saved" : "Logo removed");
              }}
            />
          </div>
          <Field label="Business type" className="mt-4" hint={tenant.businessType === "coaching" ? "Courses page, Hinglish templates, 19-status playbook" : "Coaching format is hidden for this business"}>
            <Select value={tenant.businessType || "general"} onChange={(e) => changeType(e.target.value)} disabled={busy}>
              {BUSINESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Button className="mt-4 w-full justify-center" onClick={() => setModal("renew")}>
            <RefreshCw className="h-4 w-4" /> Record payment / Renew
          </Button>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-medium text-slate-900">Usage</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Agents</dt><dd>{users.filter((u) => u.role === "agent").length} / {plan?.limits?.agents ?? "∞"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Contacts</dt><dd>{fmtNum(counts.contacts)} / {fmtNum(plan?.limits?.contacts)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Messages ({tenant.usage?.month || "this month"})</dt><dd>{fmtNum(tenant.usage?.messagesSent)} / {fmtNum(plan?.limits?.monthlyMessages)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Conversations</dt><dd>{fmtNum(counts.conversations)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Campaigns / Templates</dt><dd>{counts.campaigns} / {counts.templates}</dd></div>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-medium text-slate-900">WhatsApp number</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Mode</dt><dd>{tenant.whatsapp?.mode === "live" ? <Badge tone="green">Live</Badge> : <Badge tone="yellow">Sandbox</Badge>}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Number</dt><dd>{fmtPhone(tenant.whatsapp?.displayPhoneNumber) || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Connected</dt><dd>{fmtDate(tenant.whatsapp?.connectedAt)}</dd></div>
          </dl>
          <div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" className="w-full justify-center" onClick={() => setModal("password")}><KeyRound className="h-4 w-4" /> Reset admin password</Button>
            <Button variant="ghost" className="w-full justify-center text-red-600 hover:bg-red-50" onClick={() => setModal("delete")}><Trash2 className="h-4 w-4" /> Delete business</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium text-slate-900">Team</h2></div>
        <Table
          columns={[
            { key: "name", label: "Name", render: (u) => <span className="font-medium text-slate-800">{u.name}</span> },
            { key: "email", label: "Email" },
            { key: "role", label: "Role", render: (u) => <Badge tone={u.role === "admin" ? "purple" : "gray"}>{u.role}</Badge> },
            { key: "active", label: "Status", render: (u) => <StatusBadge status={u.isActive ? "active" : "suspended"} /> },
            { key: "login", label: "Last login", render: (u) => fmtDateTime(u.lastLoginAt) },
          ]}
          rows={users}
        />
      </Card>

      <Modal open={modal === "edit"} onClose={() => setModal(null)} title="Edit business" size="md"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button onClick={saveEdit} loading={busy} disabled={!edit || edit.name.trim().length < 2 || (edit.hasAdmin && edit.adminName.trim().length < 2) || !!passwordError}>Save</Button></>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Business name"><Input value={edit.name} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business email"><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            </div>
            {edit.hasAdmin && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-3 text-sm font-medium text-slate-800">Business admin</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Admin name"><Input value={edit.adminName} maxLength={80} onChange={(e) => setEdit({ ...edit, adminName: e.target.value })} /></Field>
                  <Field label="Admin email (login)" hint="The admin logs in with this email.">
                    <Input type="email" value={edit.adminEmail} onChange={(e) => setEdit({ ...edit, adminEmail: e.target.value })} />
                  </Field>
                  <Field label="New password (optional)" hint="Leave empty to keep the current password">
                    <PasswordInput autoComplete="new-password" value={edit.adminPassword} onChange={(e) => setEdit({ ...edit, adminPassword: e.target.value, ...(!e.target.value && { adminPassword2: "" }) })} />
                  </Field>
                  <Field label="Confirm new password">
                    <PasswordInput autoComplete="new-password" value={edit.adminPassword2} disabled={!edit.adminPassword} onChange={(e) => setEdit({ ...edit, adminPassword2: e.target.value })} />
                  </Field>
                </div>
                {passwordHint && <p className={`mt-2 text-xs ${passwordHint.tone}`}>{passwordHint.text}</p>}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={modal === "renew"} onClose={() => setModal(null)} title="Renew subscription" size="sm"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button onClick={renew} loading={busy}>Renew</Button></>}>
        <p className="mb-4 text-sm text-slate-600">Use this after you receive the monthly payment. The period is extended from the current end date (or from today if expired).</p>
        <Field label="Months"><Input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
      </Modal>

      <Modal open={modal === "password"} onClose={() => setModal(null)} title="Reset admin password" size="sm"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button onClick={resetPassword} loading={busy} disabled={password.length < 8}>Reset</Button></>}>
        <Field label="New password" hint="Min 8 characters"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Modal>

      <ConfirmModal
        open={modal === "suspend"}
        onClose={() => setModal(null)}
        onConfirm={toggleStatus}
        loading={busy}
        danger={tenant.status === "active"}
        title={tenant.status === "active" ? "Suspend business?" : "Activate business?"}
        confirmText={tenant.status === "active" ? "Suspend" : "Activate"}
        message={tenant.status === "active" ? "Admin and agents will not be able to log in, and campaigns will pause." : "The business team will be able to log in again."}
      />

      <ConfirmModal
        open={modal === "delete"}
        onClose={() => setModal(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete business permanently?"
        confirmText="Delete forever"
        message="This deletes the business, its team, contacts, chats, templates and campaigns. This can not be undone."
      >
        <Field label={`Type "${tenant.name}" to confirm`} className="mt-4">
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </Field>
      </ConfirmModal>
    </PageContainer>
  );
}
