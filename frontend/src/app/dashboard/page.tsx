'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from 'ethers';
import { api } from '@/lib/api';
import { ABI, contracts } from '@/lib/chain';
import { loadAllCampaigns } from '@/lib/campaign';
import { dateTime, rupiah, sameAddr } from '@/lib/format';
import { useConfig, useTx, useWallet } from '@/lib/providers';
import type { CampaignData, Order } from '@/lib/types';
import { Addr, CampaignBadge, Empty, Notice, Spinner, TxLink } from '@/components/ui';
import { openPayment } from '@/components/DonatePanel';

function Section({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-2"><h2 className="h2">{title}</h2>{badge && <span className="badge bg-brand-100 text-brand-800">{badge}</span>}</div>
      {children}
    </section>
  );
}

const ORDER_COLORS: Record<string, string> = { RECORDED: 'bg-emerald-100 text-emerald-800', CREATED: 'bg-slate-100 text-slate-700', QUEUED: 'bg-amber-100 text-amber-800', FAILED: 'bg-rose-100 text-rose-800' };

function DonorSection({ account }: { account: string }) {
  const cfg = useConfig();
  const router = useRouter();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [amount, setAmount] = useState(100_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => {
      contracts(cfg).token.balanceOf(account).then(setBalance).catch(() => {});
      api<Order[]>(`/payments?address=${account}`).then(setOrders).catch(() => setOrders([]));
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [account, cfg]);
  const topUp = async () => {
    setBusy(true); setError('');
    try { await openPayment(cfg, await api('/payments/create', { method: 'POST', json: { type: 'topup', amount, donorAddress: account } }), router.push); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Section title="Donatur" badge="publik">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-slate-50 p-4">
          <div className="label">Saldo dIDR</div>
          <div className="text-2xl font-bold">{balance === null ? '…' : rupiah(balance)}</div>
          <p className="text-xs text-slate-500">1 dIDR = Rp1. Top-up rupiah → dIDR dicetak oracle setelah pembayaran terverifikasi.</p>
          <div className="flex gap-2">
            <input className="input" type="number" min={1000} step={1000} value={amount} onChange={e => setAmount(Math.floor(Number(e.target.value)))} />
            <button className="btn-primary whitespace-nowrap" disabled={busy || amount < 1000} onClick={topUp}>{busy && <Spinner />} Top-up</button>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="space-y-2">
          <div className="label">Riwayat pembayaran rupiah</div>
          {orders === null ? <Spinner /> : !orders.length ? <Empty>Belum ada pembayaran.</Empty> : (
            <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {orders.map(o => (
                <Link key={o.orderId} href={`/payment/${o.orderId}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <span><span className="mono">{o.orderId}</span> <span className="text-xs text-slate-500">{o.type}</span></span>
                  <span className="flex items-center gap-2">{rupiah(o.amount)} <span className={`badge ${ORDER_COLORS[o.status] ?? 'bg-slate-100'}`}>{o.status}</span></span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/receipt" className="text-sm text-brand-700 underline">Lihat kuitansi NFT saya →</Link>
        </div>
      </div>
    </Section>
  );
}

function RecipientSection({ account }: { account: string }) {
  const cfg = useConfig();
  const { send } = useTx();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ amount: 0, bankName: 'BCA', accountNumber: '', accountName: '' });
  const [error, setError] = useState('');
  const load = useCallback(() => {
    contracts(cfg).token.balanceOf(account).then(setBalance).catch(() => {});
    api<any[]>(`/redemptions?account=${account}`).then(setList).catch(() => {});
  }, [account, cfg]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  const redeem = async () => {
    setError('');
    try {
      const { bankRef } = await api('/redemptions/intent', { method: 'POST', json: { account, ...form } });
      if (await send(`Tukar ${rupiah(form.amount)} dIDR ke rekening`, { address: cfg.contracts.token, abi: ABI.Token }, 'redeem', [form.amount, bankRef])) load();
    } catch (e: any) { setError(e.message); }
  };
  return (
    <Section title="Penerima manfaat" badge="recipient">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div><div className="label">Saldo dIDR diterima</div><div className="text-2xl font-bold">{balance === null ? '…' : rupiah(balance)}</div></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Nominal</label><input className="input" type="number" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: Math.floor(Number(e.target.value)) }))} /></div>
            <div><label className="label">Bank</label><select className="input" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}>{['BCA', 'BNI', 'BRI', 'Mandiri', 'BSI'].map(b => <option key={b}>{b}</option>)}</select></div>
            <div><label className="label">No. rekening</label><input className="input" value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))} /></div>
            <div><label className="label">Atas nama</label><input className="input" value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} /></div>
          </div>
          <button className="btn-primary w-full" disabled={!form.amount || balance === null || BigInt(form.amount) > balance || !form.accountNumber || !form.accountName} onClick={redeem}>Tukar dIDR ke rupiah</button>
          <p className="text-xs text-slate-500">Data rekening disimpan off-chain; on-chain hanya hash referensinya. dIDR dibakar lalu oracle off-ramp mentransfer rupiah dan mengonfirmasi on-chain.</p>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div>
          <div className="label">Riwayat penukaran</div>
          {!list.length ? <Empty>Belum ada penukaran.</Empty> : list.map(r => (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
              <span>#{r.id} · {rupiah(r.amount)} → {r.bank_name} {r.account_masked}</span>
              <span className="flex items-center gap-2">
                <span className={`badge ${r.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status}</span>
                {r.confirm_tx && <TxLink hash={r.confirm_tx} label="tx" />}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function VerifierSection({ campaigns }: { campaigns: CampaignData[] }) {
  const cfg = useConfig();
  const { send } = useTx();
  const [addr, setAddr] = useState('');
  const [status, setStatus] = useState<boolean | null>(null);
  useEffect(() => { if (isAddress(addr)) contracts(cfg).factory.isRecipient(addr).then(setStatus); else setStatus(null); }, [addr, cfg]);
  const pending = campaigns.filter(c => c.summary.state === 0);
  const register = async (v: boolean) => {
    if (await send(v ? 'Daftarkan penerima' : 'Cabut penerima', { address: cfg.contracts.factory, abi: ABI.Factory }, 'registerRecipient', [addr, v])) setStatus(v);
  };
  return (
    <Section title="Verifikator" badge="verifier">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Campaign menunggu verifikasi ({pending.length})</div>
          {!pending.length ? <Empty>Tidak ada.</Empty> : pending.map(c => (
            <Link key={c.address} href={`/campaign/${c.address}`} className="flex justify-between rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
              <span>{c.meta.title}</span><span className="text-brand-700">Periksa →</span>
            </Link>
          ))}
        </div>
        <div className="space-y-2">
          <div className="label">Registri wallet penerima manfaat</div>
          <input className="input mono" placeholder="0x… wallet penerima" value={addr} onChange={e => setAddr(e.target.value.trim())} />
          {status !== null && <p className="text-xs">{status ? '✓ Terdaftar' : '✗ Belum terdaftar'}</p>}
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" disabled={!isAddress(addr) || status === true} onClick={() => register(true)}>Daftarkan</button>
            <button className="btn-secondary btn-sm" disabled={!isAddress(addr) || status !== true} onClick={() => register(false)}>Cabut</button>
          </div>
          <p className="text-xs text-slate-500">Mencegah satu penerima didaftarkan ganda oleh banyak NGO; pencairan hanya bisa ke wallet terdaftar.</p>
        </div>
      </div>
    </Section>
  );
}

function ApproverSection({ campaigns, account }: { campaigns: CampaignData[]; account: string }) {
  const cfg = useConfig();
  const [items, setItems] = useState<{ c: CampaignData; id: number; amount: bigint; approvals: number }[] | null>(null);
  useEffect(() => {
    (async () => {
      const out: any[] = [];
      for (const c of campaigns) {
        if (c.summary.state !== 1 || !c.approvers.some(a => sameAddr(a, account))) continue;
        for (const w of c.withdrawals) {
          if (w.status !== 0) continue;
          const v = await contracts(cfg).campaign(c.address).votes(w.id, account);
          if (Number(v) === 0) out.push({ c, id: w.id, amount: w.amount, approvals: w.approvals });
        }
      }
      setItems(out);
    })();
  }, [campaigns, account, cfg]);
  return (
    <Section title="Approver pencairan" badge="approver">
      {items === null ? <Spinner /> : !items.length ? <Empty>Tidak ada pengajuan yang menunggu suara Anda.</Empty> : items.map(i => (
        <Link key={`${i.c.address}-${i.id}`} href={`/campaign/${i.c.address}`} className="flex justify-between rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
          <span>{i.c.meta.title} · pengajuan #{i.id} · {rupiah(i.amount)}</span>
          <span className="text-brand-700">{i.approvals}/{i.c.summary.threshold} · Tinjau →</span>
        </Link>
      ))}
    </Section>
  );
}

function NgoSection({ campaigns, account }: { campaigns: CampaignData[]; account: string }) {
  const mine = campaigns.filter(c => sameAddr(c.summary.ngo, account));
  return (
    <Section title="NGO" badge="ngo">
      <div className="flex justify-between"><span className="text-sm text-slate-600">{mine.length} campaign milik Anda</span><Link href="/create" className="btn-primary btn-sm">+ Campaign baru</Link></div>
      {mine.map(c => (
        <Link key={c.address} href={`/campaign/${c.address}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
          <span className="flex items-center gap-2"><CampaignBadge state={c.summary.state} /> {c.meta.title}</span>
          <span className="text-slate-500">{rupiah(c.summary.totalDonated)} / {rupiah(c.summary.totalBudget)} · escrow {rupiah(c.summary.balance)}</span>
        </Link>
      ))}
    </Section>
  );
}

function AdminSection() {
  const cfg = useConfig();
  const { send } = useTx();
  const [ngo, setNgo] = useState('');
  const [paused, setPaused] = useState<boolean | null>(null);
  const [cap, setCap] = useState('');
  const load = useCallback(() => {
    const { token, factory } = contracts(cfg);
    token.paused().then(setPaused);
    factory.fiatCap().then((c: bigint) => setCap(c.toString()));
  }, [cfg]);
  useEffect(load, [load]);
  const F = { address: cfg.contracts.factory, abi: ABI.Factory };
  const T = { address: cfg.contracts.token, abi: ABI.Token };
  return (
    <Section title="Admin platform" badge="admin">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <div className="label">Beri NGO_ROLE</div>
          <input className="input mono" placeholder="0x… wallet NGO" value={ngo} onChange={e => setNgo(e.target.value.trim())} />
          <button className="btn-primary btn-sm" disabled={!isAddress(ngo)} onClick={async () => {
            const role = await contracts(cfg).factory.NGO_ROLE();
            await send('Beri NGO_ROLE', F, 'grantRole', [role, ngo]);
          }}>Grant</button>
        </div>
        <div className="space-y-2">
          <div className="label">Batas donasi fiat per transaksi</div>
          <input className="input" type="number" value={cap} onChange={e => setCap(e.target.value)} />
          <button className="btn-secondary btn-sm" onClick={async () => { if (await send('Ubah fiat cap', F, 'setFiatCap', [BigInt(cap || '0')])) load(); }}>Simpan</button>
        </div>
        <div className="space-y-2">
          <div className="label">Circuit breaker dIDR</div>
          <p className="text-sm">Status: {paused === null ? '…' : paused ? <b className="text-rose-600">PAUSED</b> : <b className="text-emerald-600">berjalan</b>}</p>
          <button className={paused ? 'btn-primary btn-sm' : 'btn-danger btn-sm'} onClick={async () => { if (await send(paused ? 'Unpause token' : 'Pause token', T, paused ? 'unpause' : 'pause', [])) load(); }}>
            {paused ? 'Unpause' : 'Pause darurat'}
          </button>
        </div>
      </div>
    </Section>
  );
}

function SystemSection() {
  const [health, setHealth] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [recon, setRecon] = useState<any>(null);
  useEffect(() => {
    const load = () => {
      fetch('/api/health').then(r => r.json()).then(setHealth).catch(() => {});
      api<any[]>('/payments/logs/webhook').then(setLogs).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Section title="Status sistem & oracle" badge="transparansi">
      {health && (
        <div className="grid gap-2 text-sm md:grid-cols-4">
          {health.rpc.map((r: any) => <div key={r.url} className="rounded-lg bg-slate-50 p-2"><div className="label">RPC {new URL(r.url).hostname}</div>{r.ok ? `✓ block #${r.block}` : '✗ mati'}</div>)}
          <div className="rounded-lg bg-slate-50 p-2"><div className="label">DB / Redis / IPFS</div>{health.db ? '✓' : '✗'} / {health.redis ? '✓' : '✗'} / {health.ipfs ? '✓' : '✗'}</div>
          <div className="rounded-lg bg-slate-50 p-2"><div className="label">Antrean oracle</div>{health.queue ? `${health.queue.waiting + health.queue.active + health.queue.delayed} aktif · ${health.queue.failed} gagal` : '-'}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button className="btn-secondary btn-sm" onClick={() => api('/admin/reconciliation').then(setRecon)}>Jalankan rekonsiliasi DB ↔ blockchain</button>
        {recon && <span className="text-sm">{recon.checked} order dicek · {recon.mismatches.length ? <b className="text-rose-600">{recon.mismatches.length} tidak cocok</b> : <b className="text-emerald-600">semua konsisten</b>}</span>}
      </div>
      <div>
        <div className="label">Log notifikasi pembayaran (webhook / reconciler / simulator)</div>
        <div className="max-h-72 overflow-y-auto text-xs">
          <table className="w-full text-left">
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2 text-slate-500">{dateTime(new Date(l.created_at).getTime() / 1000)}</td>
                  <td className="pr-2">{l.source}</td>
                  <td className="mono pr-2">{l.order_id}</td>
                  <td className="pr-2">{l.signature_valid ? '✓ sig' : '✗ sig'}</td>
                  <td className={l.verdict.startsWith('REJECTED') ? 'text-rose-600' : l.verdict.startsWith('ACCEPTED') ? 'text-emerald-700' : ''}>{l.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

export default function Dashboard() {
  const cfg = useConfig();
  const { account, roles, connect } = useWallet();
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  useEffect(() => { loadAllCampaigns(cfg).then(setCampaigns).catch(() => {}); }, [cfg]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">Bagian yang tampil menyesuaikan role on-chain wallet Anda.</p>
      </div>
      {!account ? (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">Hubungkan MetaMask untuk melihat saldo, kuitansi, dan aksi sesuai role.</span>
          <button className="btn-primary" onClick={() => connect()}>Hubungkan MetaMask</button>
        </div>
      ) : (
        <>
          <div className="card text-sm">Wallet: <Addr a={account} n={10} /> · Role: {Object.entries(roles).filter(([, v]) => v).map(([k]) => k).join(', ') || 'donatur'}</div>
          {roles.admin && <AdminSection />}
          {roles.verifier && <VerifierSection campaigns={campaigns} />}
          {roles.approver && <ApproverSection campaigns={campaigns} account={account} />}
          {roles.ngo && <NgoSection campaigns={campaigns} account={account} />}
          {(roles.recipient || campaigns.some(c => sameAddr(c.summary.recipient, account))) && <RecipientSection account={account} />}
          <DonorSection account={account} />
        </>
      )}
      <SystemSection />
    </div>
  );
}
