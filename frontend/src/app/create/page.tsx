'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from 'ethers';
import { api, uploadFile } from '@/lib/api';
import { ABI, contracts } from '@/lib/chain';
import { rupiah } from '@/lib/format';
import { useConfig, useTx, useWallet } from '@/lib/providers';
import { Notice, Spinner } from '@/components/ui';

type M = { title: string; plan: string; budget: number };

export default function CreatePage() {
  const cfg = useConfig();
  const router = useRouter();
  const { account, roles, connect } = useWallet();
  const { send } = useTx();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Kemanusiaan');
  const [organizer, setOrganizer] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientOk, setRecipientOk] = useState<boolean | null>(null);
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [image, setImage] = useState<File | null>(null);
  const [ms, setMs] = useState<M[]>([{ title: '', plan: '', budget: 1_000_000 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAddress(recipient)) { setRecipientOk(null); return; }
    contracts(cfg).factory.isRecipient(recipient).then(setRecipientOk).catch(() => setRecipientOk(null));
  }, [recipient, cfg]);

  const total = ms.reduce((a, m) => a + (m.budget || 0), 0);
  const valid = title.trim() && recipientOk && ms.every(m => m.title.trim() && m.budget > 0) && new Date(deadline).getTime() > Date.now();

  const submit = async () => {
    setBusy(true); setError('');
    try {
      let imageUri = '';
      if (image) imageUri = (await uploadFile(image)).uri;
      const meta = { title: title.trim(), description, category, organizer, image: imageUri,
        milestones: ms.map(m => ({ title: m.title.trim(), plan: m.plan.trim() })) };
      const { cid } = await api('/ipfs/json', { method: 'POST', json: meta });
      const dl = Math.floor(new Date(deadline + 'T23:59:59').getTime() / 1000);
      const before: string[] = await contracts(cfg).factory.getCampaigns();
      const ok = await send('Buat campaign', { address: cfg.contracts.factory, abi: ABI.Factory }, 'createCampaign', [recipient, dl, cid, ms.map(m => m.budget)]);
      if (ok) {
        const after: string[] = await contracts(cfg).factory.getCampaigns();
        const created = after.find(a => !before.includes(a));
        router.push(created ? `/campaign/${created}` : '/');
      }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  if (!account) return (
    <div className="mx-auto max-w-lg card space-y-3 text-center">
      <h1 className="h2">Buat campaign</h1>
      <p className="text-sm text-slate-600">Hanya NGO terdaftar (memiliki NGO_ROLE on-chain) yang dapat membuat campaign.</p>
      <button className="btn-primary" onClick={() => connect()}>Hubungkan MetaMask</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Buat campaign baru</h1>
        <p className="text-sm text-slate-600">Metadata disimpan di IPFS; target, milestone, deadline, dan wallet penerima dikunci di smart contract.</p>
      </div>
      {!roles.ngo && <Notice kind="warn">Akun ini belum memiliki NGO_ROLE. Transaksi akan ditolak kontrak. Minta admin memberikan role NGO di Dashboard.</Notice>}

      <div className="card space-y-4">
        <div><label className="label">Judul</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Air bersih untuk desa…" /></div>
        <div><label className="label">Deskripsi</label><textarea className="input min-h-28" value={description} onChange={e => setDescription(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label">Kategori</label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              {['Kemanusiaan', 'Bencana Alam', 'Pendidikan', 'Kesehatan', 'Infrastruktur', 'Lingkungan'].map(k => <option key={k}>{k}</option>)}
            </select></div>
          <div><label className="label">Nama penyelenggara</label><input className="input" value={organizer} onChange={e => setOrganizer(e.target.value)} /></div>
          <div><label className="label">Deadline donasi</label><input className="input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
        </div>
        <div>
          <label className="label">Wallet penerima manfaat</label>
          <input className="input mono" value={recipient} onChange={e => setRecipient(e.target.value.trim())} placeholder="0x…" />
          {recipientOk === true && <p className="mt-1 text-xs text-emerald-700">✓ Wallet sudah diverifikasi & terdaftar</p>}
          {recipientOk === false && <p className="mt-1 text-xs text-rose-600">✗ Wallet belum terdaftar. Verifikator harus mendaftarkannya terlebih dahulu (Dashboard → Verifikator).</p>}
        </div>
        <div><label className="label">Gambar sampul (opsional)</label>
          <input type="file" accept="image/*" className="input" onChange={e => setImage(e.target.files?.[0] ?? null)} /></div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="h2">Milestone & rencana penggunaan dana</h2>
          <span className="text-sm">Target: <b>{rupiah(total)}</b></span>
        </div>
        {ms.map((m, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_160px_auto]">
            <input className="input" placeholder={`Milestone ${i + 1}`} value={m.title} onChange={e => setMs(l => l.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
            <input className="input" placeholder="Rencana penggunaan" value={m.plan} onChange={e => setMs(l => l.map((x, j) => j === i ? { ...x, plan: e.target.value } : x))} />
            <input className="input" type="number" min={1} value={m.budget} onChange={e => setMs(l => l.map((x, j) => j === i ? { ...x, budget: Math.floor(Number(e.target.value)) } : x))} />
            <button className="btn-secondary" disabled={ms.length === 1} onClick={() => setMs(l => l.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setMs(l => [...l, { title: '', plan: '', budget: 1_000_000 }])}>+ Tambah milestone</button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn-primary w-full" disabled={!valid || busy} onClick={submit}>{busy && <Spinner />} Unggah metadata ke IPFS & buat campaign</button>
      <p className="text-center text-xs text-slate-500">Campaign berstatus “Menunggu Verifikasi” sampai diaktifkan verifikator.</p>
    </div>
  );
}
