'use client';

import { useState } from 'react';
import { keccak256 } from 'ethers';
import { uploadFile, type UploadResult } from '@/lib/api';
import { ipfsUrl } from '@/lib/ipfs';
import { short } from '@/lib/format';
import { Spinner } from './ui';

/** Tautan bukti IPFS + verifikasi: unduh file, hitung keccak256, bandingkan dengan hash on-chain. */
export function ProofLink({ cid, hash }: { cid?: string; hash: string }) {
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');
  if (!cid) return <span className="mono text-slate-400">{short(hash, 6)}</span>;
  const verify = async () => {
    setState('checking');
    try {
      const res = await fetch(ipfsUrl(cid));
      const bytes = new Uint8Array(await res.arrayBuffer());
      setState(keccak256(bytes) === hash ? 'ok' : 'bad');
    } catch { setState('bad'); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={ipfsUrl(cid)} target="_blank" rel="noreferrer" className="text-brand-700 underline">Lihat bukti (IPFS)</a>
      {state === 'idle' && <button className="text-xs text-slate-500 underline" onClick={verify}>verifikasi hash</button>}
      {state === 'checking' && <Spinner className="h-3 w-3" />}
      {state === 'ok' && <span className="badge bg-emerald-100 text-emerald-800">✓ hash cocok dengan on-chain</span>}
      {state === 'bad' && <span className="badge bg-rose-100 text-rose-800">✗ hash tidak cocok</span>}
    </span>
  );
}

/** Input file yang langsung mengunggah ke IPFS dan mengembalikan CID + hash. */
export function FileUpload({ value, onChange, label = 'Bukti (JPG/PNG/PDF, maks 5 MB)' }:
  { value: UploadResult | null; onChange: (v: UploadResult | null) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <label className="label">{label}</label>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="input"
        onChange={async e => {
          const f = e.target.files?.[0];
          onChange(null); setError('');
          if (!f) return;
          setBusy(true);
          try { onChange(await uploadFile(f)); } catch (err: any) { setError(err.message); }
          setBusy(false);
        }} />
      {busy && <p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><Spinner className="h-3 w-3" /> Mengunggah ke IPFS…</p>}
      {value && <p className="mt-1 text-xs text-emerald-700">✓ Tersimpan di IPFS: <span className="mono">{value.cid}</span></p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <p className="mt-1 text-xs text-amber-700">IPFS bersifat publik - samarkan data pribadi (NIK, wajah anak, nomor rekening) sebelum mengunggah.</p>
    </div>
  );
}
