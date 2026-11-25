'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { Order } from '@/lib/types';
import { Notice, Spinner } from '@/components/ui';

/**
 * Simulator payment gateway (mode mock). Menyerupai halaman QRIS Midtrans; tombol "bayar"
 * membuat backend mengirim notifikasi bertanda tangan SHA512 ke pipeline verifikasi oracle yang sama.
 */
export default function MockPay() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [o, setO] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<Order>(`/payments/${orderId}`).then(setO).catch(e => setError(e.message)); }, [orderId]);

  const act = async (outcome: 'pay' | 'deny') => {
    setBusy(true);
    try { await api(`/payments/mock/${orderId}/${outcome}`, { method: 'POST' }); router.push(`/payment/${orderId}`); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-sm">
      <div className="card space-y-4 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Simulator Payment Gateway</div>
        {o ? (
          <>
            <div className="text-sm text-slate-500">Order {o.orderId}</div>
            <div className="text-3xl font-bold">{rupiah(o.amount)}</div>
            <div className="mx-auto grid h-48 w-48 grid-cols-8 gap-0.5 rounded-lg border-8 border-white bg-white p-1 shadow-inner">
              {Array.from({ length: 64 }, (_, i) => {
                const h = (o.orderHash.charCodeAt(2 + (i % 60)) + i * 7) % 3;
                return <div key={i} className={h ? 'bg-slate-900' : 'bg-white'} />;
              })}
            </div>
            <p className="text-xs text-slate-500">QRIS tiruan - pindai tidak akan berfungsi. Gunakan tombol di bawah.</p>
            {o.status !== 'CREATED' ? <Notice kind="info">Order sudah berstatus {o.status}.</Notice> : (
              <div className="grid gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => act('pay')}>{busy && <Spinner />} Simulasikan pembayaran berhasil</button>
                <button className="btn-secondary" disabled={busy} onClick={() => act('deny')}>Simulasikan pembayaran ditolak</button>
              </div>
            )}
          </>
        ) : error ? <Notice kind="error">{error}</Notice> : <Spinner className="mx-auto h-6 w-6" />}
      </div>
    </div>
  );
}
