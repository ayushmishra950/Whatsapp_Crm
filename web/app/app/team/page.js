"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import {
  Avatar, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, PasswordInput, StatusBadge, Table, Toggle,
} from "@/components/ui";

const empty = { name: "", email: "", phone: "", password: "", isActive: true };

export default function TeamPage() {
  const toast = useToast();
  const { session } = useAuth();
  const [members, setMembers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => api("/team").then(setMembers).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const agents = members?.filter((m) => m.role === "agent") || [];
  const limit = session.tenant.plan?.limits?.agents;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing._id) {
        const body = { name: editing.name, phone: editing.phone, isActive: editing.isActive };
        if (editing.password) body.password = editing.password;
        await api(`/team/${editing._id}`, { method: "PATCH", body });
      } else {
        const added = await api("/team", { method: "POST", body: { name: editing.name, email: editing.email, phone: editing.phone, password: editing.password } });
        if (added.existingLogin) {
          toast.success(`${editing.name} added. They already had a login: this business now shows in their business switcher (same email & password).`);
          setEditing(null);
          load();
          return;
        }
      }
      toast.success(editing._id ? "Agent updated" : "Agent added");
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
      await api(`/team/${deleting._id}`, { method: "DELETE" });
      toast.success("Agent deleted. Their chats moved to unassigned.");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!members) return <PageLoader />;

  return (
    <PageContainer>
      <PageHeader
        title="Team"
        description={`Agents handle chats with your customers. ${limit != null ? `Your plan allows ${limit} agents (${agents.length} used).` : ""}`}
        actions={<Button onClick={() => setEditing({ ...empty })} disabled={limit != null && agents.length >= limit}><Plus className="h-4 w-4" /> Add agent</Button>}
      />
      <Card>
        <Table
          columns={[
            {
              key: "name",
              label: "Member",
              render: (m) => (
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} />
                  <div>
                    <p className="font-medium text-slate-800">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.email}{m.sharedLogin && <Badge tone="purple" className="ml-1" title="This person uses the same login for another business">shared login</Badge>}</p>
                  </div>
                </div>
              ),
            },
            { key: "role", label: "Role", render: (m) => <Badge tone={m.role === "admin" ? "purple" : "gray"}>{m.role}</Badge> },
            { key: "chats", label: "Open chats", render: (m) => m.openChats },
            { key: "status", label: "Status", render: (m) => <StatusBadge status={m.isActive ? "active" : "suspended"} /> },
            { key: "login", label: "Last login", render: (m) => fmtDateTime(m.lastLoginAt) },
            {
              key: "actions",
              label: "",
              className: "text-right",
              render: (m) =>
                m.role === "agent" && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing({ ...m, password: "" })} aria-label="Edit agent"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(m)} aria-label="Delete agent"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ),
            },
          ]}
          rows={members}
          empty={<EmptyState icon={Users} title="No team members" />}
        />
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? "Edit agent" : "Add agent"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="agent-form" loading={saving}>Save</Button></>}
      >
        {editing && (
          <form id="agent-form" onSubmit={save} className="space-y-4">
            <Field label="Name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><Input required type="email" disabled={!!editing._id} value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            {editing.sharedLogin ? (
              <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900">This person uses the same login for another business, so only they can change their password (Settings → Change password).</p>
            ) : (
              <Field label={editing._id ? "New password" : "Password"} hint={editing._id ? "Leave empty to keep the current password" : "Min 8 characters. Leave empty if this email already logs in for another business: they keep their own password."}>
                <PasswordInput minLength={8} value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              </Field>
            )}
            {editing._id && (
              <Toggle checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} label="Active" description="Disabled agents can not log in; their chats go back to unassigned" />
            )}
          </form>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete agent?" confirmText="Delete"
        message={`${deleting?.name} will lose access to this business. Their chats will become unassigned.${deleting?.sharedLogin ? " Their login keeps working for their other business." : ""}`} />
    </PageContainer>
  );
}
