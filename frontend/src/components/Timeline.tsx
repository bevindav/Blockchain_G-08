'use client';

import Link from 'next/link';
import { ZeroHash } from 'ethers';
import type { TimelineItem } from '@/lib/campaign';
import { dateTime, rupiah } from '@/lib/format';
import { Addr, TxLink } from './ui';
import { ProofLink } from './Proof';

const STYLE: Record<string, { icon: string; color: string; title: string }> = {
  CampaignCreated: { icon: '✦', color: 'bg-slate-500', title: 'Campaign dibuat oleh NGO' },
  Activated: { icon: '✓', color: 'bg-sky-500', title: 'Diverifikasi & diaktifkan verifikator' },
  DonationRecorded: { icon: '♥', color: 'bg-brand-600', title: 'Donasi masuk escrow' },
  WithdrawalRequested: { icon: '↗', color: 'bg-amber-500', title: 'Pengajuan pencairan + bukti' },
  WithdrawalApproved: { icon: '✓', color: 'bg-sky-500', title: 'Disetujui approver' },
  WithdrawalRejected: { icon: '✗', color: 'bg-rose-500', title: 'Ditolak approver' },
  WithdrawalClosed: { icon: '■', color: 'bg-slate-400', title: 'Status pengajuan berubah' },
  WithdrawalExecuted: { icon: '→', color: 'bg-emerald-600', title: 'Dana dikirim ke penerima' },
  ReportSubmitted: { icon: '📎', color: 'bg-violet-500', title: 'Laporan / bukti penyaluran' },
  RedemptionRequested: { icon: '⇩', color: 'bg-indigo-500', title: 'Penerima menukar dIDR ke rupiah' },
  RedemptionPaid: { icon: '🏦', color: 'bg-indigo-700', title: 'Transfer bank ke penerima selesai' },
  Refunded: { icon: '↩', color: 'bg-orange-500', title: 'Refund ke donatur' },
  Cancelled: { icon: '⊘', color: 'bg-rose-600', title: 'Campaign dibatalkan' },
  Completed: { icon: '★', color: 'bg-emerald-700', title: 'Seluruh milestone tersalurkan' },
};
const CLOSED = ['Menunggu', 'Disetujui (kuorum tercapai)', 'Dicairkan', 'Ditolak (kuorum tidak mungkin tercapai)', 'Dibatalkan NGO'];

function Detail({ e }: { e: TimelineItem }) {
  const a = e.args;
  switch (e.kind) {
    case 'CampaignCreated': return <>Target {rupiah(a.target)} · penerima <Addr a={a.recipient} /></>;
    case 'Activated': return <>oleh <Addr a={a.verifier} /></>;
    case 'DonationRecorded': return (
      <>{rupiah(a.amount)} dari <Addr a={a.donor} /> · {a.orderId === ZeroHash ? 'dIDR via MetaMask' : 'rupiah via payment gateway'} ·{' '}
        <Link className="text-brand-700 underline" href={`/receipt?id=${a.receiptId}`}>kuitansi #{a.receiptId.toString()}</Link></>);
    case 'WithdrawalRequested': return <>#{a.id.toString()} · milestone {Number(a.milestone) + 1} · {rupiah(a.amount)} · <ProofLink cid={a.proofCID} hash={a.proofHash} /></>;
    case 'WithdrawalApproved': return <>pengajuan #{a.id.toString()} oleh <Addr a={a.approver} /></>;
    case 'WithdrawalRejected': return <>pengajuan #{a.id.toString()} oleh <Addr a={a.approver} /> · alasan: “{a.reason}”</>;
    case 'WithdrawalClosed': return <>pengajuan #{a.id.toString()} → {CLOSED[Number(a.status)]}</>;
    case 'WithdrawalExecuted': return <>#{a.id.toString()} · {rupiah(a.amount)} → <Addr a={a.recipient} /></>;
    case 'ReportSubmitted': return <>untuk pencairan #{a.withdrawalId.toString()} oleh <Addr a={a.by} /> · <ProofLink cid={a.proofCID} hash={a.proofHash} /></>;
    case 'RedemptionRequested': return <>{rupiah(a.amount)} dibakar (redeem #{a.id.toString()})</>;
    case 'RedemptionPaid': return <>{rupiah(a.amount)} · ref payout <span className="mono">{String(a.payoutRef).slice(0, 12)}…</span></>;
    case 'Refunded': return <>{rupiah(a.amount)} → <Addr a={a.donor} /></>;
    case 'Cancelled': return <>oleh <Addr a={a.by} /> · “{a.reason}” · dana refund {rupiah(a.refundPool)}</>;
    default: return null;
  }
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
      {items.map(e => {
        const s = STYLE[e.kind] ?? { icon: '•', color: 'bg-slate-400', title: e.kind };
        return (
          <li key={e.key} className="relative">
            <span className={`absolute -left-[34px] flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${s.color}`}>{s.icon}</span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <b className="text-sm text-slate-900">{s.title}</b>
              <span className="text-xs text-slate-500">{dateTime(e.time)} · block #{e.block} · <TxLink hash={e.txHash} /></span>
            </div>
            <div className="text-sm text-slate-600"><Detail e={e} /></div>
          </li>
        );
      })}
    </ol>
  );
}
