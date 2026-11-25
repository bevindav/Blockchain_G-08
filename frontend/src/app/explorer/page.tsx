'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatEther, type Block, type TransactionReceipt, type TransactionResponse } from 'ethers';
import { decodeLog, ifaces, readProvider } from '@/lib/chain';
import { dateTime } from '@/lib/format';
import { useConfig } from '@/lib/providers';
import { Addr, Notice, Spinner, TxLink } from '@/components/ui';

function fmt(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  return String(v);
}

/** Explorer ringan: blok terbaru, detail transaksi, dan event log ter-decode dengan ABI kontrak platform. */
function Explorer() {
  const cfg = useConfig();
  const router = useRouter();
  const params = useSearchParams();
  const txParam = params.get('tx');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [q, setQ] = useState(txParam ?? '');
  const [tx, setTx] = useState<{ tx: TransactionResponse; rc: TransactionReceipt | null; time: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = readProvider(cfg);
    const load = async () => {
      const n = await p.getBlockNumber();
      const list = await Promise.all(Array.from({ length: 10 }, (_, i) => n - i).filter(x => x >= 0).map(x => p.getBlock(x)));
      setBlocks(list.filter(Boolean) as Block[]);
    };
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [cfg]);

  useEffect(() => {
    if (!txParam) { setTx(null); return; }
    const p = readProvider(cfg);
    setError('');
    (async () => {
      const t = await p.getTransaction(txParam);
      if (!t) throw new Error('Transaksi tidak ditemukan');
      const rc = await p.getTransactionReceipt(txParam);
      const b = rc ? await p.getBlock(rc.blockNumber) : null;
      setTx({ tx: t, rc, time: b?.timestamp ?? 0 });
    })().catch(e => setError(e.message));
  }, [txParam, cfg]);

  let fn: { name: string; args: string[] } | null = null;
  if (tx?.tx.data && tx.tx.data !== '0x') {
    for (const iface of Object.values(ifaces)) {
      try { const d = iface.parseTransaction({ data: tx.tx.data }); if (d) { fn = { name: d.signature, args: d.args.map(fmt) }; break; } } catch { /* */ }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Blockchain explorer</h1>
      <form className="card flex gap-2" onSubmit={e => { e.preventDefault(); router.push(`/explorer?tx=${q.trim()}`); }}>
        <input className="input mono" placeholder="Hash transaksi 0x…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-primary">Cari</button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {tx && (
        <div className="card space-y-3 text-sm">
          <h2 className="h2">Detail transaksi</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><span className="label">Hash</span><span className="mono">{tx.tx.hash}</span></div>
            <div><span className="label">Status</span>{tx.rc ? (tx.rc.status === 1 ? <span className="badge bg-emerald-100 text-emerald-800">Sukses</span> : <span className="badge bg-rose-100 text-rose-800">Gagal (revert)</span>) : <span className="badge bg-amber-100 text-amber-800">Pending</span>}</div>
            <div><span className="label">Block</span>#{tx.rc?.blockNumber ?? '-'} · {tx.time ? dateTime(tx.time) : ''}</div>
            <div><span className="label">Gas terpakai</span>{tx.rc?.gasUsed.toString() ?? '-'} · nilai {formatEther(tx.tx.value)} ETH</div>
            <div><span className="label">Dari</span><Addr a={tx.tx.from} n={10} /></div>
            <div><span className="label">Ke (kontrak)</span><Addr a={tx.tx.to ?? tx.rc?.contractAddress} n={10} /></div>
          </div>
          {fn && <div><span className="label">Fungsi dipanggil</span><span className="mono">{fn.name}</span><div className="mono mt-1 text-slate-500">({fn.args.join(', ')})</div></div>}
          <div>
            <span className="label">Event log ({tx.rc?.logs.length ?? 0})</span>
            <div className="space-y-2">
              {tx.rc?.logs.map(l => {
                const d = decodeLog(l);
                return (
                  <div key={l.index} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex justify-between"><b>{d ? `${d.contract}.${d.parsed.name}` : 'Unknown event'}</b><Addr a={l.address} /></div>
                    {d && <div className="mono mt-1 text-slate-600">{d.parsed.fragment.inputs.map((inp, i) => `${inp.name}=${fmt(d.parsed.args[i])}`).join('  ')}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="card">
        <h2 className="h2 mb-3">Blok terbaru (block time ±2 detik, konsensus QBFT)</h2>
        {!blocks.length ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Block</th><th>Waktu</th><th>Validator (proposer)</th><th>Tx</th><th>Gas</th></tr></thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.number} className="border-t border-slate-100 align-top">
                    <td className="py-2 font-medium">#{b.number}</td>
                    <td>{dateTime(b.timestamp)}</td>
                    <td><Addr a={b.miner} /></td>
                    <td>{b.transactions.length ? b.transactions.map(h => <div key={h}><TxLink hash={h} /></div>) : <span className="text-slate-400">0</span>}</td>
                    <td>{b.gasUsed.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExplorerPage() {
  return <Suspense fallback={<Spinner />}><Explorer /></Suspense>;
}
