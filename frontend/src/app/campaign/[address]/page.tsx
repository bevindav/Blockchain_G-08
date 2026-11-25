'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { isAddress } from 'ethers';
import { useConfig, useWallet } from '@/lib/providers';
import { loadCampaign, loadTimeline, type TimelineItem } from '@/lib/campaign';
import type { CampaignData } from '@/lib/types';
import { ipfsUrl } from '@/lib/ipfs';
import { dateOnly, daysLeft, pct, rupiah, sameAddr } from '@/lib/format';
import { Addr, CampaignBadge, Empty, Progress, Spinner } from '@/components/ui';
import { DonatePanel } from '@/components/DonatePanel';
import { Timeline } from '@/components/Timeline';
import { AdminActions, RefundPanel, RequestWithdrawal, Withdrawals } from '@/components/CampaignActions';

export default function CampaignPage() {
  const { address } = useParams<{ address: string }>();
  const cfg = useConfig();
  const { account, roles } = useWallet();
  const [c, setC] = useState<CampaignData | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'timeline' | 'withdrawals' | 'milestones'>('timeline');

  const reload = useCallback(async () => {
    if (!isAddress(address)) { setError('Alamat campaign tidak valid'); return; }
    try {
      const data = await loadCampaign(cfg, address);
      setC(data);
      setTimeline(await loadTimeline(cfg, address, data.summary.recipient));
    } catch (e: any) { setError(e.shortMessage || e.message); }
  }, [cfg, address]);

  useEffect(() => { reload(); const t = setInterval(reload, 10_000); return () => clearInterval(t); }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!c) return <div className="flex justify-center py-20 text-brand-600"><Spinner className="h-8 w-8" /></div>;
  const s = c.summary;
  const isNgo = sameAddr(account, s.ngo);
  const left = daysLeft(s.deadline);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card overflow-hidden p-0">
          <div className="aspect-[2/1] bg-gradient-to-br from-brand-600 to-slate-800">
            {c.meta.image && <img src={ipfsUrl(c.meta.image)} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <CampaignBadge state={s.state} />
              {c.meta.category && <span className="badge bg-slate-100 text-slate-700">{c.meta.category}</span>}
              <span className="text-xs text-slate-500">{left > 0 ? `Berakhir ${dateOnly(s.deadline)} (${left} hari lagi)` : `Berakhir ${dateOnly(s.deadline)}`}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{c.meta.title}</h1>
            {c.meta.organizer && <p className="text-sm text-slate-500">Penyelenggara: {c.meta.organizer}</p>}
            <p className="whitespace-pre-line text-slate-700">{c.meta.description}</p>
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><span className="label">Smart contract</span><Addr a={c.address} n={8} /></div>
              <div><span className="label">NGO</span><Addr a={s.ngo} n={8} /></div>
              <div><span className="label">Wallet penerima (terdaftar)</span><Addr a={s.recipient} n={8} /></div>
              <div><span className="label">Metadata IPFS</span>
                {s.metadataCID.startsWith('data:') ? <span className="text-xs text-slate-500">inline</span> :
                  <a className="mono text-brand-700 underline" target="_blank" rel="noreferrer" href={ipfsUrl(s.metadataCID)}>{s.metadataCID.slice(0, 20)}…</a>}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([['timeline', 'Jejak dana (on-chain)'], ['withdrawals', `Pencairan (${s.withdrawalCount})`], ['milestones', `Milestone (${s.milestoneCount})`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-md py-1.5 ${tab === k ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>
          {tab === 'timeline' && (timeline ? <Timeline items={timeline} /> : <Spinner />)}
          {tab === 'withdrawals' && <Withdrawals c={c} reload={reload} />}
          {tab === 'milestones' && (
            <div className="space-y-3">
              {c.milestones.map((m, i) => {
                const meta = c.meta.milestones?.[i];
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex justify-between gap-2"><b>{i + 1}. {meta?.title ?? 'Milestone'}</b><span>{rupiah(m.budget)}</span></div>
                    {meta?.plan && <p className="mb-2 text-sm text-slate-600">Rencana: {meta.plan}</p>}
                    <Progress value={m.paid} max={m.budget} reserved={m.reserved} />
                    <div className="mt-1 text-xs text-slate-500">Dicairkan {rupiah(m.paid)} · dicadangkan (menunggu persetujuan) {rupiah(m.reserved)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="card space-y-3">
          <div className="text-3xl font-bold text-brand-700">{rupiah(s.totalDonated)}</div>
          <div className="text-sm text-slate-500">terkumpul dari target {rupiah(s.totalBudget)} ({pct(s.totalDonated, s.totalBudget).toFixed(1)}%)</div>
          <Progress value={s.totalDonated} max={s.totalBudget} />
          <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
            <div><div className="label">Saldo escrow</div><b>{rupiah(s.balance)}</b></div>
            <div><div className="label">Dicairkan</div><b>{rupiah(s.totalPaid)}</b></div>
            <div><div className="label">Dicadangkan</div><b>{rupiah(s.reserved)}</b></div>
            <div><div className="label">Donasi</div><b>{s.donationCount}x</b></div>
          </div>
          <p className="text-xs text-slate-500">Pencairan butuh {s.threshold} dari {s.approverCount} approver independen.</p>
        </div>
        <DonatePanel c={c} onDone={reload} />
        <AdminActions c={c} reload={reload} isVerifier={roles.verifier} isNgo={isNgo} />
        {isNgo && s.state === 1 && <RequestWithdrawal c={c} reload={reload} />}
        <RefundPanel c={c} reload={reload} />
      </div>
    </div>
  );
}
