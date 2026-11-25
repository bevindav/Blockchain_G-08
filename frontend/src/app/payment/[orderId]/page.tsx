'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { rupiah, sameAddr } from '@/lib/format';
import { useConfig } from '@/lib/providers';
import type { Order } from '@/lib/types';
import { Addr, Notice, Spinner, TxLink } from '@/components/ui';

const STEPS = [
  { key: 'CREATED', title: 'Order dibuat', desc: 'Menunggu pembayaran di payment gateway' },
  { key: 'PAID', title: 'Pembayaran terverifikasi', desc: 'Signature SHA512 + Status API + nominal cocok' },
  { key: 'QUEUED', title: 'Antrean oracle', desc: 'Oracle mengirim transaksi ke blockchain (retry otomatis)' },
  { key: 'RECORDED', title: 'Tercatat on-chain', desc: 'Donasi masuk escrow & kuitansi NFT diterbitkan' },
];
const rank = (s: string) => ({ CREATED: 0, PAID: 1, QUEUED: 2, RECORDED: 3 } as Record<string, number>)[s] ?? -1;

/** Pelacakan status pembayaran rupiah -> on-chain secara real-time (polling). */
export default function PaymentStatus() {
  const { orderId } = useParams<{ orderId: string }>();
  const cfg = useConfig();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const data = await api<Order>(`/payments/${orderId}`);
        if (stop) return;
        setO(data);
        if (['RECORDED', 'FAILED', 'EXPIRED', 'DENIED', 'CANCELLED'].includes(data.status)) return;
      } catch (e: any) { if (!stop) setError(e.message); }
      if (!stop) setTimeout(load, 2000);
    };
    load();
    return () => { stop = true; };
  }, [orderId]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!o) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  const r = o.status === 'RECORDED' ? 3 : rank(o.status) === -1 ? -1 : Math.max(rank(o.status), o.paidAt ? 1 : 0);
  const failed = ['FAILED', 'EXPIRED', 'DENIED', 'CANCELLED'].includes(o.status);
  const custodial = sameAddr(o.donorAddress, cfg.custodyAddress);
  const seconds = o.paidAt && o.recordedAt ? ((new Date(o.recordedAt).getTime() - new Date(o.paidAt).getTime()) / 1000).toFixed(1) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="card space-y-1">
        <div className="label">{o.type === 'donation' ? 'Donasi rupiah' : 'Top-up dIDR'}</div>
        <div className="text-3xl font-bold">{rupiah(o.amount)}</div>
        <div className="text-sm text-slate-500">Order ID: <b className="mono text-slate-800">{o.orderId}</b> (simpan untuk verifikasi kuitansi)</div>
      </div>

      <div className="card">
        <ol className="space-y-5">
          {STEPS.map((s, i) => {
            const done = r >= i; const current = r + 1 === i && !failed;
            return (
              <li key={s.key} className="flex gap-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-emerald-500 text-white' : current ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
                  {done ? '✓' : current ? <Spinner className="h-3 w-3" /> : i + 1}
                </span>
                <div><b className={done ? 'text-slate-900' : 'text-slate-500'}>{s.title}</b><p className="text-sm text-slate-500">{s.desc}</p></div>
              </li>
            );
          })}
        </ol>
        {failed && (
          <div className="mt-4"><Notice kind="error">
            Status: <b>{o.status}</b>{o.lastError ? ` - ${o.lastError}` : ''}.
            {o.status === 'FAILED' && ' Pembayaran sudah diterima tetapi tidak dapat dicatat (mis. target campaign sudah penuh). Dana rupiah akan dikembalikan oleh platform.'}
          </Notice></div>
        )}
        {o.status === 'CREATED' && (
          <div className="mt-4 flex gap-2">
            {cfg.payment.mode === 'mock' && <Link className="btn-primary btn-sm" href={`/pay/mock/${o.orderId}`}>Buka simulator pembayaran</Link>}
            <button className="btn-secondary btn-sm" onClick={() => api(`/payments/${o.orderId}/retry`, { method: 'POST' }).then(setO)}>Cek status ke gateway</button>
          </div>
        )}
      </div>

      {o.status === 'RECORDED' && (
        <div className="card space-y-2 text-sm">
          <Notice kind="success">Donasi Anda sudah tercatat permanen di blockchain{seconds ? ` (${seconds} detik setelah pembayaran)` : ''}.</Notice>
          <div>Transaksi: <TxLink hash={o.txHash} /> · block #{o.blockNumber}</div>
          <div>Pencatat (oracle) → penerima kuitansi: <Addr a={o.donorAddress} n={8} /> {custodial && <span className="text-xs text-slate-500">(wallet kustodian platform)</span>}</div>
          <div className="flex flex-wrap gap-2 pt-2">
            {o.receiptId && <Link className="btn-primary btn-sm" href={`/receipt?id=${o.receiptId}`}>Lihat kuitansi #{o.receiptId}</Link>}
            {o.campaign && <Link className="btn-secondary btn-sm" href={`/campaign/${o.campaign}`}>Kembali ke campaign</Link>}
            {o.type === 'topup' && <Link className="btn-secondary btn-sm" href="/dashboard">Ke dashboard</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
