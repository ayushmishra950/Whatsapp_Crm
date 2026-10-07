"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Minus, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader, Stat, Table } from "@/components/ui";

/**
 * Refer & earn: who referred how many friends, how many joined, and fee discounts given / still due.
 * Codes are created automatically (template variable "Referral code / link", or a contact's Referral box).
 */
export default function ReferralsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const load = () => api("/referrals").then(setData).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setGiven = async (row, given) => {
    setBusy(row.contactId);
    try {
      await api(`/referrals/contact/${row.contactId}/rewards`, { method: "PATCH", body: { given } });
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  if (!data) return <PageLoader />;
  const s = data.settings || {};
  const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

  return (
    <PageContainer>
      <PageHeader
        title="Refer & earn"
        description={`Old students share their code; for every friend who joins (Converted) they get: ${s.rewardText || "a fee discount"}${s.rewardAmount ? ` (${money(s.rewardAmount)})` : ""}.`}
        actions={<Link href="/app/settings"><Button variant="secondary">Referral settings</Button></Link>}
      />
      {s.enabled === false && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Refer &amp; earn is turned off in Settings, new referral codes in messages are not being matched.</p>}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Friends referred" value={data.totals.referred} />
        <Stat label="Joined (Converted)" value={data.totals.converted} />
        <Stat label="Discounts still to give" value={data.totals.pending} sub={s.rewardAmount ? money(data.totals.pending * s.rewardAmount) : undefined} />
      </div>
      <Card>
        <Table
          rowKey="contactId"
          columns={[
            { key: "who", label: "Referrer", render: (r) => <div><p className="font-medium text-slate-900">{r.name || "Unknown"}</p><p className="text-xs text-slate-500">{fmtPhone(r.phone)}</p></div> },
            { key: "code", label: "Code", render: (r) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.code}</code> },
            { key: "referred", label: "Referred", render: (r) => r.referred },
            { key: "converted", label: "Joined", render: (r) => r.converted },
            {
              key: "rewards",
              label: "Discounts given",
              render: (r) => (
                <div className="flex items-center gap-1.5">
                  <Button size="icon" variant="ghost" className="!h-7 !w-7" disabled={busy === r.contactId || r.rewardsGiven <= 0} onClick={() => setGiven(r, r.rewardsGiven - 1)} aria-label="One less"><Minus className="h-3.5 w-3.5" /></Button>
                  <span className="w-6 text-center font-medium">{r.rewardsGiven}</span>
                  <Button size="icon" variant="ghost" className="!h-7 !w-7" disabled={busy === r.contactId || r.rewardsGiven >= r.rewardsEarned} onClick={() => setGiven(r, r.rewardsGiven + 1)} aria-label="Mark one more given"><Plus className="h-3.5 w-3.5" /></Button>
                  {r.rewardsPending > 0 && <Badge tone="yellow">{r.rewardsPending} due{s.rewardAmount ? ` · ${money(r.pendingValue)}` : ""}</Badge>}
                </div>
              ),
            },
            { key: "last", label: "Last referral", className: "whitespace-nowrap", render: (r) => (r.lastAt ? fmtDateTime(r.lastAt) : "—") },
          ]}
          rows={data.items}
          empty={<EmptyState icon={Gift} title="No referrals yet" description="Send old students their referral code with a drip (Drips → Refer & earn idea). When a friend messages you with the code, it shows up here." />}
        />
      </Card>
    </PageContainer>
  );
}
