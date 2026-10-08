"use client";

import { useCallback, useEffect, useState } from "react";
import { IndianRupee, Plus, Receipt, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "./toast";
import { Badge, Button, ConfirmModal, Field, Input, Modal, Select, cx } from "./ui";

export const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const prettyDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d || "—";
};
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addMonths = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
};
const STATUS_TONE = { paid: "green", partial: "yellow", overdue: "red", due: "red", upcoming: "gray" };
const MODES = ["Cash", "UPI", "Bank transfer", "Card", "Cheque", "EMI partner"];

/** Fee plan, instalments and payments of one student */
export function FeesPanel({ contactId, compact }) {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session?.user.role === "admin";
  const [fees, setFees] = useState(null);
  const [editing, setEditing] = useState(null); // plan form
  const [paying, setPaying] = useState(null); // payment form
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/fees/contact/${contactId}`).then((r) => setFees(r.fees)).catch(() => {}), [contactId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!fees) return null;
  const hasPlan = fees.total > 0 || fees.installments.length > 0;

  const openPlan = () =>
    setEditing({
      total: fees.total || "",
      discount: fees.discount || "",
      note: fees.note || "",
      installments: fees.installments.map(({ _id, amount, dueDate }) => ({ _id, amount, dueDate })),
      count: Math.max(1, fees.installments.length || 3),
      first: fees.installments[0]?.dueDate || todayStr(),
    });
  // Split the fee after discount into N equal monthly instalments (last one takes the rounding)
  const split = () => {
    const payable = Math.max(0, Number(editing.total || 0) - Number(editing.discount || 0));
    const n = Math.max(1, Math.min(24, Number(editing.count) || 1));
    const each = Math.floor(payable / n);
    setEditing({ ...editing, installments: Array.from({ length: n }, (_, i) => ({ amount: i === n - 1 ? payable - each * (n - 1) : each, dueDate: addMonths(editing.first || todayStr(), i) })) });
  };
  const savePlan = async () => {
    setBusy(true);
    try {
      const r = await api(`/fees/contact/${contactId}`, {
        method: "PUT",
        body: { total: Number(editing.total) || 0, discount: Number(editing.discount) || 0, note: editing.note, installments: editing.installments.map((i) => ({ ...(i._id && { _id: i._id }), amount: Number(i.amount) || 0, dueDate: i.dueDate })) },
      });
      setFees(r.fees);
      setEditing(null);
      toast.success("Fee plan saved. Reminders go out 3 days before, on the day and after a missed due date.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const savePayment = async () => {
    setBusy(true);
    try {
      const r = await api(`/fees/contact/${contactId}/payments`, { method: "POST", body: { ...paying, amount: Number(paying.amount) } });
      setFees(r.fees);
      setPaying(null);
      toast.success(`Payment of ${money(paying.amount)} saved${r.statusChanged ? " · lead moved to Converted – Enrolled 🎉" : ""}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const removePayment = async () => {
    try {
      const r = await api(`/fees/contact/${contactId}/payments/${removing._id}`, { method: "DELETE" });
      setFees(r.fees);
      setRemoving(null);
      toast.success("Payment removed");
    } catch (err) {
      toast.error(err);
    }
  };
  const planSum = editing ? editing.installments.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0;
  const payable = editing ? Math.max(0, Number(editing.total || 0) - Number(editing.discount || 0)) : 0;

  return (
    <div className={cx("space-y-2 rounded-md border border-slate-200 p-3", compact && "text-sm")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><IndianRupee className="h-3.5 w-3.5" /> Fees</p>
        <div className="flex gap-1">
          {hasPlan && <Button size="sm" className="!h-7 !px-2 text-xs" onClick={() => setPaying({ amount: fees.next?.amount || fees.balance || "", date: todayStr(), mode: "UPI", receiptNo: "", note: "", sendReceipt: true })}><Receipt className="h-3.5 w-3.5" /> Record payment</Button>}
          <Button size="sm" variant="secondary" className="!h-7 !px-2 text-xs" onClick={openPlan}>{hasPlan ? "Edit plan" : <><Plus className="h-3.5 w-3.5" /> Set fee plan</>}</Button>
        </div>
      </div>
      {!hasPlan ? (
        <p className="text-xs text-slate-400">No fee plan yet. Set the total fee and instalments when the student joins — reminders then go out by themselves.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-slate-50 p-1.5"><p className="text-[11px] text-slate-500">Fee</p><p className="font-semibold">{money(fees.payable)}</p></div>
            <div className="rounded bg-green-50 p-1.5"><p className="text-[11px] text-green-700">Paid</p><p className="font-semibold text-green-700">{money(fees.paid)}</p></div>
            <div className={cx("rounded p-1.5", fees.balance ? "bg-amber-50" : "bg-green-50")}><p className="text-[11px] text-slate-500">Balance</p><p className={cx("font-semibold", fees.balance ? "text-amber-700" : "text-green-700")}>{fees.balance ? money(fees.balance) : "Paid 🎉"}</p></div>
          </div>
          {fees.next && (
            <p className={cx("text-xs", fees.next.status === "overdue" ? "font-medium text-red-600" : "text-slate-600")}>
              {fees.next.status === "overdue" ? "⚠️ Overdue: " : "Next due: "}<b>{money(fees.next.amount)}</b> on {prettyDay(fees.next.dueDate)}
            </p>
          )}
          <ul className="space-y-1">
            {fees.installments.map((i, k) => (
              <li key={i._id || k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">{k + 1}. {prettyDay(i.dueDate)}</span>
                <span className="flex items-center gap-1.5"><b>{money(i.amount)}</b> <Badge tone={STATUS_TONE[i.status]}>{i.covered > 0 && i.remaining > 0 ? `${money(i.covered)} paid${i.status === "overdue" ? " · overdue" : ""}` : i.status}</Badge></span>
              </li>
            ))}
          </ul>
          {fees.payments.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500">Payments ({fees.payments.length})</summary>
              <ul className="mt-1 space-y-1">
                {fees.payments.map((p) => (
                  <li key={p._id} className="flex items-center justify-between gap-2">
                    <span>{prettyDay(p.date)} · <b>{money(p.amount)}</b>{p.mode && ` · ${p.mode}`}{p.receiptNo && ` · #${p.receiptNo}`}</span>
                    {isAdmin && <button type="button" onClick={() => setRemoving(p)} className="text-slate-300 hover:text-red-600" aria-label="Remove payment"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Fee plan" size="md"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={savePlan} loading={busy} disabled={!Number(editing?.total) || (editing?.installments.length > 0 && Math.abs(planSum - payable) > 1)}>Save plan</Button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total fee (₹)"><Input type="number" min={0} value={editing.total} onChange={(e) => setEditing({ ...editing, total: e.target.value })} /></Field>
              <Field label="Discount (₹)"><Input type="number" min={0} value={editing.discount} onChange={(e) => setEditing({ ...editing, discount: e.target.value })} /></Field>
            </div>
            <p className="text-sm">Fee after discount: <b>{money(payable)}</b></p>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md bg-slate-50 p-2">
              <Field label="Instalments"><Input type="number" min={1} max={24} value={editing.count} onChange={(e) => setEditing({ ...editing, count: e.target.value })} /></Field>
              <Field label="First due date"><Input type="date" value={editing.first} onChange={(e) => setEditing({ ...editing, first: e.target.value })} /></Field>
              <Button variant="secondary" onClick={split} disabled={!payable}><Wand2 className="h-4 w-4" /> Split monthly</Button>
            </div>
            {editing.installments.map((i, k) => (
              <div key={k} className="grid grid-cols-[2rem_1fr_1fr_auto] items-center gap-2">
                <span className="text-sm text-slate-500">{k + 1}.</span>
                <Input type="number" min={1} value={i.amount} onChange={(e) => setEditing({ ...editing, installments: editing.installments.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)) })} aria-label="Amount" />
                <Input type="date" value={i.dueDate} onChange={(e) => setEditing({ ...editing, installments: editing.installments.map((x, j) => (j === k ? { ...x, dueDate: e.target.value } : x)) })} aria-label="Due date" />
                <Button size="icon" variant="ghost" onClick={() => setEditing({ ...editing, installments: editing.installments.filter((_, j) => j !== k) })} aria-label="Remove instalment"><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...editing, installments: [...editing.installments, { amount: Math.max(0, payable - planSum) || "", dueDate: editing.installments.length ? addMonths(editing.installments.at(-1).dueDate, 1) : editing.first }] })}><Plus className="h-3.5 w-3.5" /> Add instalment</Button>
            {editing.installments.length > 0 && Math.abs(planSum - payable) > 1 && (
              <p className="text-xs text-red-600">Instalments add up to {money(planSum)} — they must equal {money(payable)}.</p>
            )}
            <Field label="Note (optional)"><Input maxLength={500} value={editing.note} placeholder="e.g. 20% early-bird discount, EMI via partner" onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!paying} onClose={() => setPaying(null)} title="Record payment" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPaying(null)}>Cancel</Button><Button onClick={savePayment} loading={busy} disabled={!(Number(paying?.amount) > 0)}>Save payment</Button></>}>
        {paying && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹)"><Input type="number" min={1} value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} /></Field>
              <Field label="Date"><Input type="date" value={paying.date} onChange={(e) => setPaying({ ...paying, date: e.target.value })} /></Field>
              <Field label="Mode">
                <Select value={paying.mode} onChange={(e) => setPaying({ ...paying, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</Select>
              </Field>
              <Field label="Receipt no."><Input maxLength={40} value={paying.receiptNo} onChange={(e) => setPaying({ ...paying, receiptNo: e.target.value })} /></Field>
            </div>
            <Field label="Note (optional)"><Input maxLength={300} value={paying.note} onChange={(e) => setPaying({ ...paying, note: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={paying.sendReceipt} onChange={(e) => setPaying({ ...paying, sendReceipt: e.target.checked })} /> Send the WhatsApp receipt (approved “payment_receipt” template)</label>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={removePayment} danger title="Remove this payment?" confirmText="Remove"
        message={`${money(removing?.amount)} on ${prettyDay(removing?.date)} will be removed and the balance goes up again. Use this only for a wrong entry.`} />
    </div>
  );
}
