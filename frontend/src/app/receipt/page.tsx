'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ZeroHash, id as keccakId } from 'ethers';
import { contracts } from '@/lib/chain';
import { fetchMetadata } from '@/lib/ipfs';
import { dateTime, rupiah, sameAddr } from '@/lib/format';
import { useConfig, useWallet } from '@/lib/providers';
import { Addr, Empty, Notice, Spinner } from '@/components/ui';

type R = { id: string; owner: string; campaign: string; amount: bigint; timestamp: number; orderId: string; image: string; title: string };

function ReceiptView() {
  const cfg = useConfig();
  const router = useRouter();
  const params = useSearchParams();
  const { account } = useWallet();
  const [query, setQuery] = useState(params.get('id') || params.get('order') || '');
  const [r, setR] = useState<R | null>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Mencari kuitansi berdasarkan nomor kuitansi atau Order ID pembayaran rupiah (di-hash keccak256 seperti on-chain). */
  const lookup = async (q: string) => {
    if (!q) return;
    setBusy(true); setError(''); setR(null);
    try {
      const { receipt } = contracts(cfg);
      let tokenId: bigint = /^\d+$/.test(q) ? BigInt(q) : await receipt.receiptOfOrder(keccakId(q.trim()));
      if (tokenId === 0n) throw new Error('Kuitansi tidak ditemukan untuk Order ID tersebut');
      const [owner, data, uri] = await Promise.all([receipt.ownerOf(tokenId), receipt.receipts(tokenId), receipt.tokenURI(tokenId)]);
      const json = JSON.parse(atob(uri.split(',')[1]));
      const s = await contracts(cfg).campaign(data.campaign).summary();
      const meta = await fetchMetadata(s.metadataCID);
      setR({ id: tokenId.toString(), owner, campaign: data.campaign, amount: data.amount, timestamp: Number(data.timestamp), orderId: data.orderId, image: json.image, title: meta.title });
    } catch (e: any) {
      setError(e.message?.includes('ERC721NonexistentToken') || e.shortMessage?.includes('revert') ? 'Kuitansi tidak ditemukan' : (e.shortMessage || e.message));
    }
    setBusy(false);
  };

  useEffect(() => { const q = params.get('id') || params.get('order'); if (q) lookup(q); }, [params]); // eslint-disable-line

  // Kuitansi milik wallet yang terhubung (dari event Transfer mint)
  useEffect(() => {
    if (!account) { setMine(null); return; }
    const { receipt } = contracts(cfg);
    receipt.queryFilter(receipt.filters.Transfer(null, account), cfg.startBlock)
      .then(logs => setMine(logs.map((l: any) => l.args.tokenId.toString()).reverse())).catch(() => setMine([]));
  }, [account, cfg]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Verifikasi kuitansi donasi</h1>
        <p className="text-sm text-slate-600">Kuitansi berupa NFT ERC-721 <i>soulbound</i> (tidak dapat dipindahtangankan) dengan metadata yang dibangkitkan langsung oleh smart contract.</p>
      </div>
      <form className="card flex gap-2" onSubmit={e => { e.preventDefault(); router.replace(`/receipt?${/^\d+$/.test(query) ? 'id' : 'order'}=${encodeURIComponent(query)}`); lookup(query); }}>
        <input className="input" placeholder="Nomor kuitansi (mis. 3) atau Order ID (DON-…)" value={query} onChange={e => setQuery(e.target.value)} />
        <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : 'Cek'}</button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {r && (
        <div className="card grid gap-6 md:grid-cols-2">
          <img src={r.image} alt={`Kuitansi #${r.id}`} className="w-full rounded-xl" />
          <div className="space-y-2 text-sm">
            <Notice kind="success">✓ Kuitansi asli - tercatat di kontrak <span className="mono">{cfg.contracts.receipt.slice(0, 10)}…</span></Notice>
            <div><span className="label">Nominal</span><b className="text-xl">{rupiah(r.amount)}</b></div>
            <div><span className="label">Campaign</span><Link className="text-brand-700 underline" href={`/campaign/${r.campaign}`}>{r.title}</Link></div>
            <div><span className="label">Pemilik</span><Addr a={r.owner} n={8} />{sameAddr(r.owner, cfg.custodyAddress) && <span className="ml-1 text-xs text-slate-500">(kustodian platform untuk donatur tanpa wallet)</span>}</div>
            <div><span className="label">Waktu</span>{dateTime(r.timestamp)}</div>
            <div><span className="label">Kanal</span>{r.orderId === ZeroHash ? 'dIDR via MetaMask' : 'Rupiah via payment gateway'}</div>
            {r.orderId !== ZeroHash && <div><span className="label">Hash order</span><span className="mono">{r.orderId}</span></div>}
          </div>
        </div>
      )}
      {account && (
        <div className="card">
          <h2 className="h2 mb-3">Kuitansi milik wallet Anda</h2>
          {mine === null ? <Spinner /> : mine.length ? (
            <div className="flex flex-wrap gap-2">{mine.map(t => <button key={t} className="btn-secondary btn-sm" onClick={() => { setQuery(t); lookup(t); }}>#{t}</button>)}</div>
          ) : <Empty>Belum ada kuitansi.</Empty>}
        </div>
      )}
    </div>
  );
}

export default function ReceiptPage() {
  return <Suspense fallback={<Spinner />}><ReceiptView /></Suspense>;
}
