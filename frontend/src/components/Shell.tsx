'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatEther } from 'ethers';
import { useConfig, useTx, useWallet } from '@/lib/providers';
import { contracts, readProvider } from '@/lib/chain';
import { rupiah, short } from '@/lib/format';
import { Spinner, TxLink } from './ui';

const LINKS = [
  { href: '/', label: 'Campaign' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/create', label: 'Buat Campaign' },
  { href: '/receipt', label: 'Cek Kuitansi' },
  { href: '/explorer', label: 'Explorer' },
];

export function Navbar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-brand-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">D</span>
          <span className="hidden sm:inline">DonasiTransparan</span>
        </Link>
        <nav className={`${open ? 'flex' : 'hidden'} absolute left-0 top-full w-full flex-col border-b bg-white p-3 md:static md:flex md:w-auto md:flex-row md:border-0 md:bg-transparent md:p-0`}>
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${path === l.href || (l.href !== '/' && path.startsWith(l.href)) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <WalletButton />
          <button className="btn-secondary btn-sm md:hidden" onClick={() => setOpen(o => !o)}>☰</button>
        </div>
      </div>
    </header>
  );
}

function WalletButton() {
  const cfg = useConfig();
  const { account, correctChain, hasMetaMask, connect, switchNetwork, roles, addTokenToWallet } = useWallet();
  const { txs } = useTx();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ eth: string; didr: bigint } | null>(null);
  const [menu, setMenu] = useState(false);
  const lastTx = txs[0]?.status;

  useEffect(() => {
    if (!account) return;
    const load = () => Promise.all([readProvider(cfg).getBalance(account), contracts(cfg).token.balanceOf(account)])
      .then(([eth, didr]) => setInfo({ eth: Number(formatEther(eth)).toFixed(2), didr })).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [account, cfg, lastTx]);

  if (!account) return (
    <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await connect(); } catch {} setBusy(false); }}>
      {busy && <Spinner />} {hasMetaMask ? 'Hubungkan MetaMask' : 'Pasang MetaMask'}
    </button>
  );
  if (!correctChain) return <button className="btn-danger" onClick={() => switchNetwork().catch(() => {})}>Ganti ke DonasiChain</button>;

  const roleList = Object.entries(roles).filter(([, v]) => v).map(([k]) => k);
  return (
    <div className="relative">
      <button className="btn-secondary" onClick={() => setMenu(m => !m)}>
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="mono">{short(account)}</span>
        {info && <span className="hidden text-xs text-slate-500 lg:inline">{rupiah(info.didr)} dIDR</span>}
      </button>
      {menu && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
          <div className="label">Akun</div>
          <div className="mono mb-3">{account}</div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div><div className="label">dIDR</div><b>{info ? rupiah(info.didr) : '…'}</b></div>
            <div><div className="label">ETH (gas)</div><b>{info?.eth ?? '…'}</b></div>
          </div>
          <div className="label">Role on-chain</div>
          <div className="mb-3 flex flex-wrap gap-1">
            {roleList.length ? roleList.map(r => <span key={r} className="badge bg-brand-100 text-brand-800">{r}</span>) : <span className="text-slate-500">donatur / publik</span>}
          </div>
          <button className="btn-secondary btn-sm w-full" onClick={() => addTokenToWallet().catch(() => {})}>Tambahkan dIDR ke MetaMask</button>
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT = { signing: 'Menunggu tanda tangan MetaMask…', pending: 'Menunggu konfirmasi blok…', success: 'Berhasil', failed: 'Gagal' };
const STATUS_COLOR = { signing: 'border-sky-300', pending: 'border-amber-300', success: 'border-emerald-400', failed: 'border-rose-400' };

/** Panel status transaksi (pending / sukses / gagal) - FR-09. */
export function TxToasts() {
  const { txs, dismiss } = useTx();
  const visible = txs.filter(t => t.status === 'signing' || t.status === 'pending' || Date.now() - t.time < 60_000).slice(0, 4);
  useEffect(() => {
    const done = txs.filter(t => t.status === 'success');
    if (!done.length) return;
    const timers = done.map(t => setTimeout(() => dismiss(t.id), 12_000));
    return () => timers.forEach(clearTimeout);
  }, [txs, dismiss]);
  if (!visible.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {visible.map(t => (
        <div key={t.id} className={`rounded-xl border-l-4 bg-white p-3 text-sm shadow-lg ${STATUS_COLOR[t.status]}`}>
          <div className="flex items-start justify-between gap-2">
            <b className="text-slate-900">{t.label}</b>
            <button className="text-slate-400 hover:text-slate-700" onClick={() => dismiss(t.id)}>×</button>
          </div>
          <div className="mt-1 flex items-center gap-2 text-slate-600">
            {(t.status === 'signing' || t.status === 'pending') && <Spinner className="h-3 w-3" />}
            {STATUS_TEXT[t.status]}
          </div>
          {t.hash && <div className="mt-1 text-xs">Tx: <TxLink hash={t.hash} /></div>}
          {t.block !== undefined && <div className="text-xs text-slate-500">Block #{t.block} · gas {t.gasUsed}</div>}
          {t.error && <div className="mt-1 text-xs text-rose-600">{t.error}</div>}
        </div>
      ))}
    </div>
  );
}

export function Footer() {
  const cfg = useConfig();
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    const p = readProvider(cfg);
    const load = () => p.getBlockNumber().then(setBlock).catch(() => setBlock(null));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [cfg]);
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500">
        <span>Private Ethereum (Hyperledger Besu QBFT) · chainId {cfg.chainId} · pembayaran: {cfg.payment.mode}</span>
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${block !== null ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {block !== null ? <Link href="/explorer" className="hover:underline">Block terbaru #{block}</Link> : 'RPC tidak terhubung'}
        </span>
      </div>
    </footer>
  );
}
