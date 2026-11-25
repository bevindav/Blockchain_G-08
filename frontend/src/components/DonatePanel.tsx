'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ABI, contracts } from '@/lib/chain';
import { rupiah } from '@/lib/format';
import { useConfig, useTx, useWallet } from '@/lib/providers';
import type { CampaignData } from '@/lib/types';
import { Notice, Spinner } from './ui';

const PRESETS = [25_000, 50_000, 100_000, 250_000];

export function loadSnap(src: string, clientKey: string): Promise<any> {
  if (window.snap) return Promise.resolve(window.snap);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.setAttribute('data-client-key', clientKey);
    s.onload = () => resolve(window.snap); s.onerror = () => reject(new Error('Gagal memuat Midtrans Snap'));
    document.body.appendChild(s);
  });
}

/** Buka pembayaran Midtrans Snap (sandbox) atau simulator (mock), lalu arahkan ke halaman pelacakan status. */
export async function openPayment(cfg: ReturnType<typeof useConfig>, r: { orderId: string; snapToken: string; mode: string }, push: (u: string) => void) {
  const track = () => push(`/payment/${encodeURIComponent(r.orderId)}`);
  if (r.mode === 'mock') return push(`/pay/mock/${encodeURIComponent(r.orderId)}`);
  const snap = await loadSnap(cfg.payment.snapJs, cfg.payment.clientKey);
  snap.pay(r.snapToken, { onSuccess: track, onPending: track, onError: track, onClose: track });
}

export function DonatePanel({ c, onDone }: { c: CampaignData; onDone: () => void }) {
  const cfg = useConfig();
  const router = useRouter();
  const { account, connect } = useWallet();
  const { send } = useTx();
  const [tab, setTab] = useState<'fiat' | 'token'>('fiat');
  const [amount, setAmount] = useState(50_000);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [toWallet, setToWallet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);

  const remaining = c.summary.totalBudget - c.summary.totalDonated;
  const active = c.summary.state === 1 && c.summary.deadline * 1000 > Date.now();

  useEffect(() => {
    if (account) contracts(cfg).token.balanceOf(account).then(setBalance).catch(() => {});
  }, [account, cfg, busy]);

  if (!active) return <div className="card"><Notice kind="warn">Campaign ini tidak sedang menerima donasi.</Notice></div>;

  const payFiat = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/payments/create', { method: 'POST', json: {
        type: 'donation', campaign: c.address, amount, donorName: name || undefined, donorEmail: email || undefined,
        donorAddress: toWallet && account ? account : undefined } });
      await openPayment(cfg, r, router.push);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const payToken = async () => {
    if (!account) return connect();
    setBusy(true); setError('');
    const token = contracts(cfg).token;
    const allowance: bigint = await token.allowance(account, c.address);
    if (allowance < BigInt(amount)) {
      const ok = await send(`Izinkan ${rupiah(amount)} dIDR`, { address: cfg.contracts.token, abi: ABI.Token }, 'approve', [c.address, amount]);
      if (!ok) { setBusy(false); return; }
    }
    const ok = await send(`Donasi ${rupiah(amount)} dIDR`, { address: c.address, abi: ABI.Campaign }, 'donate', [amount]);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <div className="card space-y-4">
      <h2 className="h2">Berdonasi</h2>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button onClick={() => setTab('fiat')} className={`rounded-md py-1.5 ${tab === 'fiat' ? 'bg-white font-medium shadow-sm' : ''}`}>Rupiah (QRIS / VA)</button>
        <button onClick={() => setTab('token')} className={`rounded-md py-1.5 ${tab === 'token' ? 'bg-white font-medium shadow-sm' : ''}`}>dIDR (MetaMask)</button>
      </div>

      <div>
        <label className="label">Nominal (sisa kebutuhan {rupiah(remaining)})</label>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {PRESETS.map(p => (
            <button key={p} onClick={() => setAmount(p)} disabled={BigInt(p) > remaining}
              className={`rounded-md border px-1 py-1 text-xs ${amount === p ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200'}`}>
              {rupiah(p).replace('Rp', '')}
            </button>
          ))}
        </div>
        <input className="input" type="number" min={1} step={1000} value={amount} onChange={e => setAmount(Math.max(0, Math.floor(Number(e.target.value))))} />
      </div>

      {tab === 'fiat' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Nama (opsional)</label><input className="input" placeholder="Hamba Allah" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Email (opsional)</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          </div>
          {account ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={toWallet} onChange={e => setToWallet(e.target.checked)} />
              Kirim kuitansi NFT ke wallet saya ({account.slice(0, 8)}…)
            </label>
          ) : (
            <p className="text-xs text-slate-500">Tidak punya wallet? Tidak masalah. Kuitansi disimpan oleh wallet kustodian platform dan dapat Anda verifikasi dengan <b>Order ID</b>.</p>
          )}
          <button className="btn-primary w-full" disabled={busy || amount <= 0 || BigInt(amount) > remaining} onClick={payFiat}>
            {busy && <Spinner />} Bayar {rupiah(amount)}
          </button>
          <p className="text-center text-xs text-slate-500">
            {cfg.payment.mode === 'mock' ? 'Mode simulasi payment gateway (tanpa uang sungguhan).' : 'Diproses oleh Midtrans Sandbox.'}
          </p>
        </>
      ) : (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Saldo dIDR Anda</span>
            <b>{account ? (balance === null ? '…' : rupiah(balance)) : '-'}</b>
          </div>
          {account && balance !== null && balance < BigInt(amount) && (
            <Notice kind="warn">Saldo dIDR kurang. Top-up dIDR dengan rupiah di <a className="underline" href="/dashboard">Dashboard</a>.</Notice>
          )}
          <button className="btn-primary w-full" disabled={busy || amount <= 0 || BigInt(amount) > remaining || (balance !== null && balance < BigInt(amount))} onClick={payToken}>
            {busy && <Spinner />} {account ? `Donasi ${rupiah(amount)} dIDR` : 'Hubungkan MetaMask'}
          </button>
          <p className="text-center text-xs text-slate-500">Dua transaksi: approve allowance lalu donate.</p>
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
