import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { money, prettyDay, todayKey } from '@/lib/format';
import { C, F, R, S } from '@/theme';
import { DateField } from './date-field';
import { useToast } from './toast';
import { Badge, Button, Card, Field, IconButton, Input, Row, Select, Sheet, T, Toggle, confirm } from './ui';

const STATUS_TONE: Record<string, string> = { paid: 'green', partial: 'yellow', overdue: 'red', due: 'red', upcoming: 'gray' };
const MODES = ['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque', 'EMI partner'];
const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
};
const toDay = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : todayKey());
const fromDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Fee plan, instalments and payments of one student */
export function FeesPanel({ contactId, onChanged }: { contactId: string; onChanged?: () => void }) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [fees, setFees] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [paying, setPaying] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [showPayments, setShowPayments] = useState(false);

  const load = useCallback(() => api(`/fees/contact/${contactId}`).then((r) => setFees(r.fees)).catch(() => {}), [contactId]);
  useEffect(() => {
    load();
  }, [load]);
  if (!fees) return null;
  const hasPlan = fees.total > 0 || fees.installments.length > 0;

  const openPlan = () =>
    setPlan({
      total: fees.total ? String(fees.total) : '',
      discount: fees.discount ? String(fees.discount) : '',
      note: fees.note || '',
      installments: fees.installments.map(({ _id, amount, dueDate }: any) => ({ _id, amount: String(amount), dueDate })),
      count: String(Math.max(1, fees.installments.length || 3)),
      first: fees.installments[0]?.dueDate || todayKey(),
    });
  const payable = plan ? Math.max(0, Number(plan.total || 0) - Number(plan.discount || 0)) : 0;
  const planSum = plan ? plan.installments.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0) : 0;
  const split = () => {
    const n = Math.max(1, Math.min(24, Number(plan.count) || 1));
    const each = Math.floor(payable / n);
    setPlan({ ...plan, installments: Array.from({ length: n }, (_, i) => ({ amount: String(i === n - 1 ? payable - each * (n - 1) : each), dueDate: addMonths(plan.first || todayKey(), i) })) });
  };
  const setInst = (k: number, patch: any) => setPlan({ ...plan, installments: plan.installments.map((x: any, j: number) => (j === k ? { ...x, ...patch } : x)) });

  const savePlan = async () => {
    setBusy(true);
    try {
      const r = await api(`/fees/contact/${contactId}`, {
        method: 'PUT',
        body: { total: Number(plan.total) || 0, discount: Number(plan.discount) || 0, note: plan.note, installments: plan.installments.map((i: any) => ({ ...(i._id && { _id: i._id }), amount: Number(i.amount) || 0, dueDate: i.dueDate })) },
      });
      setFees(r.fees);
      setPlan(null);
      toast.success('Fee plan saved. Reminders go out 3 days before, on the day and after a missed due date.');
      onChanged?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const savePayment = async () => {
    setBusy(true);
    try {
      const r = await api(`/fees/contact/${contactId}/payments`, { method: 'POST', body: { ...paying, amount: Number(paying.amount) } });
      setFees(r.fees);
      setPaying(null);
      toast.success(`Payment of ${money(paying.amount)} saved${r.statusChanged ? ' · lead moved to Converted 🎉' : ''}`);
      onChanged?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const removePayment = async (p: any) => {
    if (!(await confirm('Remove this payment?', `${money(p.amount)} on ${prettyDay(p.date)} will be removed and the balance goes up again.`, { ok: 'Remove', danger: true }))) return;
    try {
      const r = await api(`/fees/contact/${contactId}/payments/${p._id}`, { method: 'DELETE' });
      setFees(r.fees);
      toast.success('Payment removed');
      onChanged?.();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card style={{ gap: S.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h3">💰 Fees</T>
        <Row gap={6}>
          {hasPlan ? <Button size="sm" icon="receipt-outline" title="Payment" onPress={() => setPaying({ amount: String(fees.next?.amount || fees.balance || ''), date: todayKey(), mode: 'UPI', receiptNo: '', note: '', sendReceipt: true })} /> : null}
          <Button size="sm" variant="secondary" title={hasPlan ? 'Edit plan' : 'Set fee plan'} onPress={openPlan} />
        </Row>
      </Row>
      {!hasPlan ? (
        <T v="small">No fee plan yet. Set the total fee and instalments when the student joins — reminders then go out by themselves.</T>
      ) : (
        <>
          <Row gap={S.sm}>
            {[['Fee', money(fees.payable), C.text, C.soft], ['Paid', money(fees.paid), C.brand700, C.green50], ['Balance', fees.balance ? money(fees.balance) : 'Paid 🎉', fees.balance ? C.amber : C.brand700, fees.balance ? C.amber50 : C.green50]].map(([l, v, fg, bg]) => (
              <View key={l} style={{ flex: 1, backgroundColor: bg, borderRadius: R.sm, padding: S.sm, alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: C.muted }}>{l}</Text>
                <Text style={{ fontWeight: '700', color: fg, fontSize: F.md }}>{v}</Text>
              </View>
            ))}
          </Row>
          {fees.next ? (
            <T v="small" style={fees.next.status === 'overdue' ? { color: C.red, fontWeight: '600' } : undefined}>
              {fees.next.status === 'overdue' ? '⚠️ Overdue: ' : 'Next due: '}{money(fees.next.amount)} on {prettyDay(fees.next.dueDate)}
            </T>
          ) : null}
          {fees.installments.map((i: any, k: number) => (
            <Row key={i._id || k} style={{ justifyContent: 'space-between' }}>
              <T v="small">{k + 1}. {prettyDay(i.dueDate)}</T>
              <Row gap={6}>
                <T style={{ fontWeight: '600', color: C.text }}>{money(i.amount)}</T>
                <Badge tone={STATUS_TONE[i.status] || 'gray'}>{i.covered > 0 && i.remaining > 0 ? `${money(i.covered)} paid${i.status === 'overdue' ? ' · overdue' : ''}` : i.status}</Badge>
              </Row>
            </Row>
          ))}
          {fees.payments.length ? (
            <Pressable onPress={() => setShowPayments((s) => !s)}>
              <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>{showPayments ? '▾' : '▸'} Payments ({fees.payments.length})</T>
            </Pressable>
          ) : null}
          {showPayments &&
            fees.payments.map((p: any) => (
              <Row key={p._id} style={{ justifyContent: 'space-between' }}>
                <T v="small" style={{ flex: 1 }}>{prettyDay(p.date)} · <Text style={{ fontWeight: '700' }}>{money(p.amount)}</Text>{p.mode ? ` · ${p.mode}` : ''}{p.receiptNo ? ` · #${p.receiptNo}` : ''}</T>
                {isAdmin ? <IconButton name="trash-outline" size={18} color={C.red} onPress={() => removePayment(p)} label="Remove payment" /> : null}
              </Row>
            ))}
        </>
      )}

      <Sheet open={!!plan} onClose={() => setPlan(null)} title="Fee plan" full footer={<><Button title="Cancel" variant="secondary" onPress={() => setPlan(null)} /><Button title="Save plan" loading={busy} disabled={!Number(plan?.total) || (plan?.installments.length > 0 && Math.abs(planSum - payable) > 1)} onPress={savePlan} /></>}>
        {plan ? (
          <>
            <Row gap={S.sm}>
              <Field label="Total fee (₹)" style={{ flex: 1 }}><Input keyboardType="number-pad" value={plan.total} onChangeText={(total) => setPlan({ ...plan, total })} /></Field>
              <Field label="Discount (₹)" style={{ flex: 1 }}><Input keyboardType="number-pad" value={plan.discount} onChangeText={(discount) => setPlan({ ...plan, discount })} /></Field>
            </Row>
            <T>Fee after discount: <Text style={{ fontWeight: '700' }}>{money(payable)}</Text></T>
            <View style={{ backgroundColor: C.soft, borderRadius: R.md, padding: S.md, gap: S.sm }}>
              <Row gap={S.sm}>
                <Field label="Instalments" style={{ width: 100 }}><Input keyboardType="number-pad" value={plan.count} onChangeText={(count) => setPlan({ ...plan, count })} /></Field>
                <Field label="First due date" style={{ flex: 1 }}><DateField mode="date" value={fromDay(plan.first)} onChange={(d) => setPlan({ ...plan, first: toDay(d) })} /></Field>
              </Row>
              <Button variant="secondary" icon="color-wand-outline" title="Split monthly" disabled={!payable} onPress={split} />
            </View>
            {plan.installments.map((i: any, k: number) => (
              <Row key={k} gap={S.sm}>
                <T v="small" style={{ width: 20 }}>{k + 1}.</T>
                <View style={{ width: 100 }}><Input keyboardType="number-pad" value={i.amount} onChangeText={(amount) => setInst(k, { amount })} /></View>
                <View style={{ flex: 1 }}><DateField mode="date" value={fromDay(i.dueDate)} onChange={(d) => setInst(k, { dueDate: toDay(d) })} /></View>
                <IconButton name="trash-outline" color={C.red} onPress={() => setPlan({ ...plan, installments: plan.installments.filter((_: any, j: number) => j !== k) })} label="Remove instalment" />
              </Row>
            ))}
            <Button size="sm" variant="ghost" icon="add" title="Add instalment" onPress={() => setPlan({ ...plan, installments: [...plan.installments, { amount: String(Math.max(0, payable - planSum) || ''), dueDate: plan.installments.length ? addMonths(plan.installments.at(-1).dueDate, 1) : plan.first }] })} />
            {plan.installments.length > 0 && Math.abs(planSum - payable) > 1 ? <T v="small" style={{ color: C.red }}>Instalments add up to {money(planSum)} — they must equal {money(payable)}.</T> : null}
            <Field label="Note (optional)"><Input value={plan.note} onChangeText={(note) => setPlan({ ...plan, note })} placeholder="e.g. 20% early-bird discount" maxLength={500} /></Field>
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!paying} onClose={() => setPaying(null)} title="Record payment" footer={<><Button title="Cancel" variant="secondary" onPress={() => setPaying(null)} /><Button title="Save payment" loading={busy} disabled={!(Number(paying?.amount) > 0)} onPress={savePayment} /></>}>
        {paying ? (
          <>
            <Row gap={S.sm}>
              <Field label="Amount (₹)" style={{ flex: 1 }}><Input keyboardType="number-pad" value={paying.amount} onChangeText={(amount) => setPaying({ ...paying, amount })} /></Field>
              <Field label="Date" style={{ flex: 1 }}><DateField mode="date" value={fromDay(paying.date)} onChange={(d) => setPaying({ ...paying, date: toDay(d) })} /></Field>
            </Row>
            <Row gap={S.sm}>
              <Field label="Mode" style={{ flex: 1 }}><Select value={paying.mode} onChange={(mode) => setPaying({ ...paying, mode })} options={MODES.map((m) => ({ value: m, label: m }))} title="Payment mode" /></Field>
              <Field label="Receipt no." style={{ flex: 1 }}><Input value={paying.receiptNo} onChangeText={(receiptNo) => setPaying({ ...paying, receiptNo })} maxLength={40} /></Field>
            </Row>
            <Field label="Note (optional)"><Input value={paying.note} onChangeText={(note) => setPaying({ ...paying, note })} maxLength={300} /></Field>
            <Toggle value={paying.sendReceipt} onChange={(sendReceipt) => setPaying({ ...paying, sendReceipt })} label="Send WhatsApp receipt" description="Approved “payment_receipt” template" />
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}
