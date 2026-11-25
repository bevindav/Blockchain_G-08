'use client';

import Link from 'next/link';
import type { CampaignData } from '@/lib/types';
import { ipfsUrl } from '@/lib/ipfs';
import { daysLeft, pct, rupiah } from '@/lib/format';
import { CampaignBadge, Progress } from './ui';

export function CampaignCard({ c }: { c: CampaignData }) {
  const s = c.summary;
  const left = daysLeft(s.deadline);
  return (
    <Link href={`/campaign/${c.address}`} className="card group flex flex-col overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="aspect-[2/1] w-full bg-gradient-to-br from-brand-600 to-slate-800">
        {c.meta.image && <img src={ipfsUrl(c.meta.image)} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <CampaignBadge state={s.state} />
          {c.meta.category && <span className="text-xs text-slate-500">{c.meta.category}</span>}
        </div>
        <h3 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-brand-700">{c.meta.title}</h3>
        {c.meta.organizer && <p className="text-xs text-slate-500">oleh {c.meta.organizer}</p>}
        <div className="mt-auto space-y-2">
          <Progress value={s.totalDonated} max={s.totalBudget} />
          <div className="flex justify-between text-sm">
            <span><b className="text-brand-700">{rupiah(s.totalDonated)}</b> <span className="text-slate-500">dari {rupiah(s.totalBudget)}</span></span>
            <span className="text-slate-500">{pct(s.totalDonated, s.totalBudget).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{s.donationCount} donasi · dicairkan {rupiah(s.totalPaid)}</span>
            <span>{left > 0 ? `${left} hari lagi` : 'Berakhir'}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
