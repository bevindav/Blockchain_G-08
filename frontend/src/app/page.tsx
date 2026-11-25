'use client';

import { useEffect, useState } from 'react';
import { useConfig } from '@/lib/providers';
import { loadAllCampaigns } from '@/lib/campaign';
import type { CampaignData } from '@/lib/types';
import { rupiah } from '@/lib/format';
import { CampaignCard } from '@/components/CampaignCard';
import { Empty, Spinner, Stat } from '@/components/ui';

const STEPS = [
  ['1', 'Donasi', 'Bayar rupiah via QRIS/VA (tanpa wallet) atau dIDR via MetaMask. Oracle memverifikasi pembayaran lalu mencatatnya on-chain.'],
  ['2', 'Escrow', 'Dana terkunci di smart contract campaign. Anda menerima kuitansi NFT soulbound yang dapat diverifikasi.'],
  ['3', 'Pencairan', 'NGO mengajukan pencairan per milestone + bukti di IPFS. Harus disetujui N-of-M approver independen.'],
  ['4', 'Penyaluran', 'Dana hanya bisa dikirim ke wallet penerima terdaftar, lalu laporan penyaluran diunggah sebagai bukti akhir.'],
];

export default function Home() {
  const cfg = useConfig();
  const [items, setItems] = useState<CampaignData[] | null>(null);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    loadAllCampaigns(cfg).then(setItems).catch(e => setError(e.message));
  }, [cfg]);

  const totals = (items ?? []).reduce((a, c) => ({
    donated: a.donated + c.summary.totalDonated, paid: a.paid + c.summary.totalPaid, count: a.count + c.summary.donationCount,
  }), { donated: 0n, paid: 0n, count: 0 });
  const shown = (items ?? []).filter(c => filter === 'all' || c.summary.state === filter);

  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-gradient-to-br from-brand-700 to-slate-900 px-6 py-12 text-white md:px-12">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-brand-100">Donasi transparan berbasis smart contract</p>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight md:text-4xl">Lihat sendiri ke mana setiap rupiah donasi Anda mengalir.</h1>
        <p className="mt-4 max-w-2xl text-brand-100">
          Setiap donasi, pencairan, persetujuan, dan bukti penyaluran tercatat permanen di private blockchain yang dijalankan
          bersama oleh platform, NGO, dan auditor - tidak ada satu pihak pun yang bisa mengubahnya diam-diam.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Campaign" value={items?.length ?? '…'} />
        <Stat label="Total donasi" value={items ? rupiah(totals.donated) : '…'} />
        <Stat label="Sudah disalurkan" value={items ? rupiah(totals.paid) : '…'} />
        <Stat label="Transaksi donasi" value={items ? totals.count : '…'} />
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Campaign</h2>
          <div className="flex gap-1 rounded-lg bg-slate-200 p-1 text-sm">
            {([['all', 'Semua'], [1, 'Aktif'], [0, 'Menunggu verifikasi'], [2, 'Selesai'], [3, 'Dibatalkan']] as const).map(([v, l]) => (
              <button key={String(v)} onClick={() => setFilter(v)}
                className={`rounded-md px-3 py-1 ${filter === v ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>
        </div>
        {error && <Empty>Gagal membaca blockchain: {error}</Empty>}
        {!items && !error && <div className="flex justify-center py-12 text-brand-600"><Spinner className="h-8 w-8" /></div>}
        {items && !shown.length && <Empty>Belum ada campaign pada kategori ini.</Empty>}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(c => <CampaignCard key={c.address} c={c} />)}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold text-slate-900">Cara kerja</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {STEPS.map(([n, t, d]) => (
            <div key={n} className="card">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">{n}</div>
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
